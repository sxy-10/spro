/**
 * 秒杀路由（组员3 · 阶段二；阶段六加固）
 *
 * POST /v1/seckill/:routeId          抢购：活动窗口校验 → 幂等锁 → Lua 预扣 → 发 MQ → 返回 queued
 * GET  /v1/seckill/result/:reqId     查结果：前端 1s×10 轮询（Redis 丢失时回查 MySQL）
 *
 * 阶段六修复的四个问题：
 * ① **认证走了 Redis 缓存**。原来用 core.ts 的 `authenticate`，每个抢购请求都要
 *    `api_session JOIN sys_user` 查一次库 —— 秒杀最热的那条路径反而完全没吃到
 *    组员1 做的登录态缓存。现在换成 passport 的 `authenticateJwt`（命中缓存 0 次 SQL），
 *    并且顺带吃到了 `router.ts` 里那层 120 次/分钟的全局限流。
 * ② **补上幂等**。原来 `Idempotency-Key` 前端每个写请求都发，但这条路由根本没读，
 *    reqId 每次随机生成 —— 用户连点 3 次就是 3 个 reqId、3 个订单、多扣 3 次库存。
 *    现在：带 Idempotency-Key 时 reqId 由 (userId + key) 哈希得到，重放会直接返回首次结果；
 *    不带时用 Redis `SET NX` 给「同一用户同一场次」加 10 秒互斥锁。
 * ③ **补上活动时间窗口**。`route_stock.seckill_start_at / seckill_end_at` 建了字段却没人用，
 *    活动没开始也能抢。现在到点才放行。
 * ④ **库存 key 丢了能自愈**。原来只在进程启动时预热一次，Redis 重启 / 被清空后
 *    所有秒杀一律 `sold_out`。现在 Lua 返回 `not_warmed` 会从 MySQL 回填后重试一次。
 *
 * 依赖的 Redis key：
 *   stock:{routeId}:{date}        剩余名额（Lua 原子预扣）
 *   lock:seckill:{uid}:{rid}:{date} 单用户 10 秒互斥锁
 *   seckill:result:{reqId}        排队结果（消费者写入，TTL 30 分钟）
 */
import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { cacheDel, getRedis, incrBy, isRedisReady, preDeductStock, readStock, redisKey, setNx } from '../db/redis.js';
import { warmUpStock } from './stockCache.js';
import { requirePermission } from '../auth/rbac.js';
import { publishSeckill } from '../mq/producer.js';
import { authenticateJwt } from '../auth/passport.js';
import type { AuthenticatedUserPayload } from '../auth/passport.js';
import { reply, run, ApiError } from './core.js';

export const seckillRouter = Router();

/** 结果记录 TTL：前端轮询 10 秒，但用户可能过一会儿才回来看，30 分钟足够 */
const RESULT_TTL_SECONDS = Number(process.env.SECKILL_RESULT_TTL_SECONDS ?? 1800);

/** 同一用户同一场次的提交互斥时长（秒） */
const LOCK_TTL_SECONDS = Number(process.env.SECKILL_LOCK_TTL_SECONDS ?? 10);

// 请求体校验
const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  people: z.coerce.number().int().min(1).max(5).default(1)
}).strict();

const stockKeyOf = (routeId: number, date: string) => `stock:${routeId}:${date}`;
const resultKeyOf = (reqId: string) => `seckill:result:${reqId}`;

/**
 * reqId 的两种来源：
 *   - 客户端带了 Idempotency-Key：用 (userId + key) 哈希，重放一定落到同一个 reqId，
 *     消费者那边 `tour_order.uk_order_req` 唯一键会直接判重 → 不会重复建单。
 *   - 没带：随机 UUID（前端 http.ts 其实总会带，这里只是兜底）。
 */
function resolveReqId(idempotencyKey: string | undefined, userId: number): string {
  if (!idempotencyKey) return randomUUID();
  return createHash('sha256').update(`seckill:${userId}:${idempotencyKey}`).digest('hex').slice(0, 32);
}

/** POST /v1/seckill/:routeId */
seckillRouter.post('/seckill/:routeId', authenticateJwt, requirePermission('order:seckill'), run(async (req, res) => {
  const routeId = Number(req.params.routeId);
  if (!Number.isInteger(routeId) || routeId <= 0) throw new ApiError(400, 10001, '路线ID不合法');

  const { date, people } = bodySchema.parse(req.body);
  const user = res.locals.user as AuthenticatedUserPayload;
  const userId = Number(user.id);

  const redis = getRedis();
  if (!redis || !isRedisReady()) throw new ApiError(503, 50001, '秒杀服务暂时不可用，请稍后重试');

  // ① 场次存在性 + 活动时间窗口（字段早就建好了，之前一直没用）
  const [stockRows] = await pool.query<RowDataPacket[]>(
    `SELECT seckill_total_seats, seckill_start_at, seckill_end_at
       FROM route_stock WHERE route_id = ? AND travel_date = ?`,
    [routeId, date]
  );
  if (!stockRows.length) throw new ApiError(404, 20016, '该日期没有秒杀场次');
  if (Number(stockRows[0].seckill_total_seats) <= 0) {
    reply(res, { status: 'sold_out', remaining: 0 });
    return;
  }
  const now = Date.now();
  const startsAt = stockRows[0].seckill_start_at ? new Date(stockRows[0].seckill_start_at).getTime() : null;
  const endsAt = stockRows[0].seckill_end_at ? new Date(stockRows[0].seckill_end_at).getTime() : null;
  if (startsAt !== null && now < startsAt) throw new ApiError(409, 20011, '秒杀活动尚未开始');
  if (endsAt !== null && now > endsAt) throw new ApiError(409, 20011, '秒杀活动已结束');

  // ② 幂等：同一个 Idempotency-Key 重放 → 直接返回上次的结果
  const reqId = resolveReqId(req.get('Idempotency-Key') ?? undefined, userId);
  const existingResult = await redis.get(redisKey(resultKeyOf(reqId)));
  if (existingResult) {
    reply(res, JSON.parse(String(existingResult)));
    return;
  }

  // ③ 同一用户同一场次 10 秒内只允许一笔（防连点 / 脚本），SET NX 本身就是原子的
  const lockKey = `lock:seckill:${userId}:${routeId}:${date}`;
  const acquired = await setNx(lockKey, reqId, LOCK_TTL_SECONDS);
  if (!acquired) throw new ApiError(409, 20015, '请勿重复提交，稍后可在「我的订单」查看结果');

  // ④ 库存 key 不存在说明没预热（Redis 重启 / 新加场次）→ 从 MySQL 回填，别把"没预热"当成"卖完了"
  const stockKey = stockKeyOf(routeId, date);
  if ((await readStock(stockKey)) === null) {
    const warmed = await warmUpStock(routeId, date);
    if (!warmed) {
      await cacheDel(lockKey);
      throw new ApiError(409, 20011, '秒杀场次库存未就绪，请稍后重试');
    }
  }

  // ⑤ Lua 原子预扣
  const result = await preDeductStock(stockKey, people);
  if (!result.ok) {
    await cacheDel(lockKey); // 锁要立刻释放，让用户能重试
    if (result.reason === 'sold_out') {
      reply(res, { status: 'sold_out', remaining: result.remaining ?? 0 });
      return;
    }
    if (result.reason === 'not_warmed') {
      throw new ApiError(409, 20011, '秒杀场次库存未就绪，请稍后重试');
    }
    // redis_unavailable：直接拒绝，不降级打数据库（否则失去"用 Redis 挡流量"的意义）
    throw new ApiError(503, 50001, '秒杀服务暂时不可用，请稍后重试');
  }

  // ⑥ 预扣成功 → 发 MQ；发失败必须回补库存，否则这份名额永远卖不掉（库存泄漏）
  try {
    await publishSeckill({ reqId, userId, routeId, date, people });
  } catch {
    await incrBy(stockKey, people); // 回补：不加回去这份名额就永远卖不掉了
    await cacheDel(lockKey);
    throw new ApiError(500, 50000, '下单失败，请重试');
  }

  // ⑦ 先写一条 pending，避免前端轮询在消费者还没处理时读到"记录不存在"。
  //    payload 里带上 req_id：客户端用同一个 Idempotency-Key 重放时能直接复用，
  //    否则重放只能拿到 status，前端拿不到排队凭据号。
  await redis.set(redisKey(resultKeyOf(reqId)), JSON.stringify({ status: 'pending', order_id: null, req_id: reqId }), 'EX', RESULT_TTL_SECONDS);

  // 立即返回排队中（用户感知毫秒级）
  reply(res, { status: 'queued', req_id: reqId, remaining: result.remaining }, 202);
}));

/** GET /v1/seckill/result/:reqId */
seckillRouter.get('/seckill/result/:reqId', authenticateJwt, run(async (req, res) => {
  const reqId = String(req.params.reqId);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(reqId)) throw new ApiError(400, 10001, 'reqId不合法');

  const redis = getRedis();
  if (redis && isRedisReady()) {
    const raw = await redis.get(redisKey(resultKeyOf(reqId)));
    if (raw) {
      reply(res, JSON.parse(String(raw)));
      return;
    }
  }

  // 兜底：结果记录过期 / Redis 被清空时回查 MySQL。
  // 旧逻辑这里永远返回 pending，前端分不清"还在处理"和"记录已丢"，会把用户永远吊在转圈页。
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, status FROM tour_order WHERE req_id = ? LIMIT 1', [reqId]
  );
  if (rows.length) {
    reply(res, { status: 'success', order_id: Number(rows[0].id), order_status: rows[0].status });
    return;
  }
  reply(res, { status: 'pending', hint: '处理中或记录已过期，请稍后在「我的订单」查看' });
}));
