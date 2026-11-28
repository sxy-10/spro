import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { getRedis, isRedisReady, redisKey } from '../db/redis.js';
import { expireUnpaidOrders } from './stock.js';
import { warmUpMissingSeckillStock } from './stockCache.js';
import { ApiError, reply, run } from './core.js';
import { logger } from '../lib/logger.js';

export const internalRouter = Router();
const TIMER_NAMES = ['expire-orders', 'refresh-stock', 'seckill-toggle', 'dashboard-preagg'] as const;
type TimerName = (typeof TIMER_NAMES)[number];
const INTERNAL_WINDOW_MS = 5 * 60 * 1000;
const NONCE_TTL_SECONDS = 5 * 60;

const isPrivateAddress = (address: string): boolean => {
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return false;
};

function requestSignature(method: string, path: string, timestamp: string, nonce: string, body: unknown, secret: string): string {
  const bodyHash = createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
  const payload = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export const signInternalRequest = requestSignature;

function isValidHexDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authenticateInternal(req: Request, res: Response, next: NextFunction): Promise<void> {
  const remoteAddress = req.socket.remoteAddress ?? '';
  const configured = (process.env.INTERNAL_ALLOWED_IPS ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  const normalizedRemote = remoteAddress.startsWith('::ffff:') ? remoteAddress.slice(7) : remoteAddress;
  const normalizedAllowlist = configured.map((ip) => ip.startsWith('::ffff:') ? ip.slice(7) : ip);
  if (
    !isPrivateAddress(remoteAddress) ||
    normalizedAllowlist.length === 0 ||
    !normalizedAllowlist.includes(normalizedRemote)
  ) {
    res.status(404).end();
    return;
  }

  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 32) {
    next(new ApiError(503, 50001, '内部接口尚未配置'));
    return;
  }

  const timestamp = req.get('X-Timestamp') ?? '';
  const nonce = req.get('X-Nonce') ?? '';
  const signature = req.get('X-Internal-Key') ?? '';
  const timestampValue = Number(timestamp);
  if (
    !/^\d{13}$/.test(timestamp) ||
    !Number.isSafeInteger(timestampValue) ||
    Math.abs(Date.now() - timestampValue) > INTERNAL_WINDOW_MS ||
    !/^[A-Za-z0-9-]{16,128}$/.test(nonce) ||
    !isValidHexDigest(signature)
  ) {
    next(new ApiError(401, 20012, '内部请求认证失败'));
    return;
  }

  const path = req.originalUrl.split('?')[0];
  const expected = requestSignature(req.method, path, timestamp, nonce, req.body, secret);
  if (!secureEqual(signature, expected)) {
    next(new ApiError(401, 20012, '内部请求认证失败'));
    return;
  }

  const redis = getRedis();
  if (!redis || !isRedisReady()) {
    next(new ApiError(503, 50001, '内部接口暂不可用'));
    return;
  }
  try {
    const result = await redis.set(redisKey(`internal:nonce:${nonce}`), '1', 'EX', NONCE_TTL_SECONDS, 'NX');
    if (result !== 'OK') {
      next(new ApiError(401, 20012, '内部请求认证失败'));
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

internalRouter.use(authenticateInternal);

async function runTimer(task: TimerName): Promise<Record<string, unknown>> {
  if (task === 'expire-orders') {
    let processed = 0;
    for (let batch = 0; batch < 10; batch += 1) {
      const count = await expireUnpaidOrders();
      processed += count;
      if (count < 100) break;
    }
    return { task, processed };
  }
  if (task === 'refresh-stock') {
    return { task, ...(await warmUpMissingSeckillStock()) };
  }
  if (task === 'seckill-toggle') {
    const [result] = await pool.query(
      `UPDATE route_stock
          SET seckill_enabled = (
            seckill_total_seats > seckill_sold_seats AND
            (seckill_start_at IS NULL OR seckill_start_at <= UTC_TIMESTAMP()) AND
            (seckill_end_at IS NULL OR seckill_end_at >= UTC_TIMESTAMP())
          )
        WHERE seckill_total_seats > 0`
    );
    return { task, changed: (result as { affectedRows: number }).affectedRows };
  }

  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM tour_order WHERE DATE(created_at)=UTC_DATE()) AS today_orders,
      (SELECT COUNT(*) FROM tour_order WHERE status IN ('PENDING','PAID')) AS pending_confirms,
      (SELECT COALESCE(SUM(total_amount),0) FROM tour_order
        WHERE DATE(created_at)=UTC_DATE() AND status IN ('PAID','CONFIRMED','COMPLETED')) AS today_revenue,
      (SELECT COUNT(*) FROM travel_product WHERE status='ON_SALE') AS active_routes,
      (SELECT COUNT(*) FROM sys_user WHERE status='ACTIVE') AS active_users
  `);
  const snapshot = {
    today_orders: Number(rows[0].today_orders),
    pending_confirms: Number(rows[0].pending_confirms),
    today_revenue: String(rows[0].today_revenue),
    active_routes: Number(rows[0].active_routes),
    active_users: Number(rows[0].active_users),
    generated_at: new Date().toISOString()
  };
  const redis = getRedis();
  if (!redis || !isRedisReady()) throw new ApiError(503, 50001, '预聚合结果暂不可用');
  await redis.set(redisKey('dashboard:preagg'), JSON.stringify(snapshot), 'EX', 7200);
  return { task, ...snapshot };
}

/**
 * 只读预聚合快照（S4 新增，配合 T4 的 dashboard-preagg 任务）。
 *
 * 为什么放在 /internal 而不是 /v1：快照里是全平台口径的经营数字，不是某个机构的数据，
 * 不该经用户态接口暴露。它只由 BFF 用内部签名读取，公网来源照旧空 404。
 *
 * 语义三态：key 存在 → 200 + 快照（generated_at 即"这批数字是什么时候算的"）；
 * key 不存在 → 404/20016（BFF 据此显示"预聚合尚未生成"）；Redis 不可用 → 503。
 */
internalRouter.get('/dashboard/preagg', run(async (_req, res) => {
  const redis = getRedis();
  if (!redis || !isRedisReady()) throw new ApiError(503, 50001, '预聚合结果暂不可用');
  const cached = await redis.get(redisKey('dashboard:preagg'));
  if (!cached) throw new ApiError(404, 20016, '预聚合结果尚未生成，等待 dashboard-preagg 任务');
  reply(res, JSON.parse(cached));
}));

internalRouter.post('/timers/:task', run(async (req, res) => {
  const task = req.params.task as TimerName;
  if (!TIMER_NAMES.includes(task)) throw new ApiError(404, 20016, '接口不存在');
  const redis = getRedis();
  if (!redis || !isRedisReady()) throw new ApiError(503, 50001, '内部接口暂不可用');

  const bucket = Math.floor(Date.now() / 60_000);
  const resultKey = redisKey(`internal:timer:result:${task}:${bucket}`);
  const lockKey = redisKey(`internal:timer:lock:${task}:${bucket}`);
  const cached = await redis.get(resultKey);
  if (cached) {
    reply(res, JSON.parse(cached));
    return;
  }

  const lockToken = randomUUID();
  const acquired = await redis.set(lockKey, lockToken, 'EX', 600, 'NX');
  if (acquired !== 'OK') {
    const completed = await redis.get(resultKey);
    if (completed) {
      reply(res, JSON.parse(completed));
      return;
    }
    throw new ApiError(409, 20015, '该定时任务正在执行');
  }

  try {
    logger.info({ event: 'internal.timer.started', task });
    const result = await runTimer(task);
    const encoded = JSON.stringify(result);
    await redis.set(resultKey, encoded, 'EX', 600);
    logger.info({ event: 'internal.timer.completed', task, result });
    reply(res, result);
  } catch (error) {
    logger.error({
      event: 'internal.timer.failed',
      task,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    await redis.eval(
      `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`,
      1,
      lockKey,
      lockToken
    );
  }
}));
