import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { authenticateJwt } from '../auth/passport.js';
import { publishRecommendationEvents } from '../mq/producer.js';
import { logger } from '../lib/logger.js';
import { ApiError, rateLimit, reply, run } from './core.js';

const eventTypes = ['impression', 'click', 'dwell', 'like', 'favorite', 'share', 'order'] as const;
const userIdSchema = z.union([
  z.string().regex(/^[1-9]\d{0,19}$/),
  z.number().int().positive().safe()
]).transform(String);

const eventSchema = z.object({
  userId: userIdSchema,
  itemType: z.string().trim().min(1).max(40),
  itemId: z.union([z.string().trim().min(1).max(64), z.number().int().positive().safe()]).transform(String),
  eventType: z.enum(eventTypes),
  ts: z.string().datetime({ offset: true }),
  sessionId: z.string().trim().min(1).max(128),
  extra: z.record(z.string(), z.unknown()).optional()
}).strict();
const optionalAuthenticate: RequestHandler = (req, res, next) => {
  if (!req.get('Authorization')) {
    next();
    return;
  }
  authenticateJwt(req, res, next);
};
const forbiddenExtraKey = /(password|token|authorization|signature|secret|phone|mobile|email)/i;

function assertSafeExtra(value: unknown): void {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, nested] of Object.entries(current)) {
      if (forbiddenExtraKey.test(key)) throw new ApiError(400, 10001, 'extra 不得包含敏感字段');
      pending.push(nested);
    }
  }
}

export const eventsRouter = Router();

eventsRouter.post('/events', (req, _res, next) => {
  rateLimit(`ip:${req.ip}`, 120).then(() => next(), next);
}, optionalAuthenticate, run(async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];
  if (payload.length < 1 || payload.length > 50) {
    throw new ApiError(400, 10001, '每次最多提交50条埋点');
  }
  const events = z.array(eventSchema).length(payload.length).parse(payload);
  const authenticatedUserId = res.locals.user ? String(res.locals.user.id) : null;
  if (authenticatedUserId && events.some((event) => event.userId !== authenticatedUserId)) {
    throw new ApiError(403, 20013, '埋点用户与登录用户不一致');
  }
  for (const event of events) {
    if (event.extra) {
      assertSafeExtra(event.extra);
      if (Buffer.byteLength(JSON.stringify(event.extra), 'utf8') > 4096) {
        throw new ApiError(400, 10001, '单条埋点 extra 不得超过4KB');
      }
    }
  }

  const messages = events.map((event) => ({
    userId: event.userId,
    value: JSON.stringify(event)
  }));
  void publishRecommendationEvents(messages).catch((error: unknown) => {
    logger.error({
      event: 'recommendation.events.publish_failed',
      count: messages.length,
      userId: authenticatedUserId ?? 'anonymous',
      message: error instanceof Error ? error.message : String(error)
    });
  });

  reply(res, { accepted: events.length }, 202);
}));
