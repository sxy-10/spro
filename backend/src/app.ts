import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { randomUUID } from 'node:crypto';
import { api } from './api/router.js';
import { seckillRouter } from './api/seckillRouter.js';
import { ApiError, errors, reply, run } from './api/core.js';
import { getQueueStats } from './mq/consumer.js';
import { redisStats } from './db/redis.js';
import passport from './auth/passport.js';
import { imRouter } from './api/imRouter.js';
import { imAgentRouter } from './api/imAgentRouter.js';
import { statsRouter } from './api/statsRouter.js';
import { internalRouter } from './api/internalRouter.js';
import { eventsRouter } from './api/eventsRouter.js';
import { auditRouter } from './api/auditRouter.js';
import { requestLoggingMiddleware } from './api/requestLogging.js';

export const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.locals.traceId = randomUUID();
  res.setHeader('X-Trace-Id', res.locals.traceId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!req.secure) {
      const origin = process.env.PUBLIC_API_ORIGIN;
      if (!origin?.startsWith('https://')) { next(new ApiError(503, 50001, '服务暂不可用')); return; }
      res.redirect(308, `${origin}${req.originalUrl}`); return;
    }
  }
  next();
});
const whitelist = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',');
// 开发环境放行本机任意端口来源（localhost / 127.0.0.1），便于 IDE 预览等场景
const devLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || whitelist.includes(origin) || (process.env.NODE_ENV !== 'production' && devLocalOrigin.test(origin))) {
      cb(null, true); return;
    }
    cb(null, false);
  },
  exposedHeaders: ['X-Trace-Id', 'Retry-After'],
}));
app.use(compression());
app.use(express.json({ limit: '64kb', strict: true }));
app.use((req, _res, next) => {
  if (['POST','PUT','PATCH'].includes(req.method) && !req.is('application/json')) {
    next(new ApiError(400,10001,'请求必须使用 application/json')); return;
  }
  if (Object.keys(req.query).some(k => /token|api[_-]?key/i.test(k))) {
    next(new ApiError(400,10001,'认证凭据只能放在请求头')); return;
  }
  next();
});
app.use(passport.initialize());
app.use(requestLoggingMiddleware);
/**
 * 阶段六新增：队列与 Redis 的可观测性接口。
 *
 * 为什么放在 /v1 下而不是 /health：/health 被 api.test.ts 断言为 {status:'ok'}，
 * 这里单开一条路径，既能给答辩现场演示"积压多少、死信多少"，也不会破坏既有契约。
 *
 * 只暴露聚合数字，不含任何业务数据，所以不需要登录（内网/本机演示用）。
 */
app.get('/v1/health/queue', run(async (_req, res) => {
  const [queue, redis] = await Promise.all([getQueueStats(), redisStats()]);
  reply(res, { queue, redis });
}));

app.get('/v1/health', (_req, res) => res.status(200).json({
  code: 0,
  message: 'ok',
  data: { status: 'ok' },
  trace_id: res.locals.traceId
}));
app.use('/v1', eventsRouter);
app.use('/v1', api);
app.use('/v1', seckillRouter);
app.use('/v1', imRouter);
app.use('/v1', imAgentRouter);
app.use('/v1', statsRouter);
app.use('/v1', auditRouter);
app.use('/internal', internalRouter);
app.use((_req, _res, next) => next(new ApiError(404,20016,'接口不存在')));
app.use(errors);
