/**
 * 秒杀路由（组员3 · 阶段二）
 *
 * POST /v1/seckill/:routeId          抢购：Lua 预扣 Redis → 发 MQ → 返回 queued
 * GET  /v1/seckill/result/:reqId     查结果：前端 1s×10 轮询
 *
 * 注意：本路由需要登录，组员2（阶段三）会在这里加 order:seckill 权限守卫。
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db/connection.js';
import { RowDataPacket } from 'mysql2/promise';
import { getRedis, redisKey, preDeductStock } from '../db/redis.js';
import { authenticate, reply, run, ApiError } from './core.js';
import { publishSeckill } from '../mq/producer.js';

export const seckillRouter = Router();

// 请求体校验
const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  people: z.coerce.number().int().min(1).max(5).default(1)
}).strict();

/** POST /v1/seckill/:routeId */
seckillRouter.post('/seckill/:routeId', authenticate, run(async (req, res) => {
  const routeId = Number(req.params.routeId);
  if (!Number.isInteger(routeId) || routeId <= 0) throw new ApiError(400, 10001, '路线ID不合法');

  const { date, people } = bodySchema.parse(req.body);
  const userId = Number((res.locals.user as RowDataPacket).id);

  // 1. Lua 原子预扣 Redis
  const stockKey = `stock:${routeId}:${date}`;
  const result = await preDeductStock(stockKey, people);

  if (!result.ok) {
    if (result.reason === 'sold_out') {
      reply(res, { status: 'sold_out' });
      return;
    }
    // redis_unavailable：直接拒绝，不兜底打数据库
    throw new ApiError(503, 50001, '秒杀服务暂时不可用，请稍后重试');
  }

  // 2. 预扣成功 → 发 MQ（发失败要回补 Redis 库存）
  const reqId = randomUUID();
  try {
    await publishSeckill({ reqId, userId, routeId, date, people });
  } catch (error: any) {
    // 回补库存：INCRBY 加回去
    const redis = getRedis();
    if (redis) await redis.incrby(redisKey(stockKey), people);
    throw new ApiError(500, 50000, '下单失败，请重试');
  }

  // 3. 立即返回排队中
  reply(res, { status: 'queued', req_id: reqId }, 202);
}));

/** GET /v1/seckill/result/:reqId */
seckillRouter.get('/seckill/result/:reqId', authenticate, run(async (req, res) => {
  const reqId = String(req.params.reqId);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(reqId)) throw new ApiError(400, 10001, 'reqId不合法');

  const redis = getRedis();
  if (!redis) throw new ApiError(503, 50001, '服务暂时不可用');

  const raw = await redis.get(redisKey(`seckill:result:${reqId}`));
  if (!raw) {
    reply(res, { status: 'pending' });
    return;
  }
  reply(res, JSON.parse(String(raw)));
}));
