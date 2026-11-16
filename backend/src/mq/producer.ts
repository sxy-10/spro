/**
 * MQ 生产者（组员3 · 阶段二）
 *
 * 用 Redis Stream 做消息队列：
 *   XADD seckill:stream '*' reqId xxx userId xxx routeId xxx ...
 *
 * 不引入 RabbitMQ，直接复用组员1的 ioredis 连接。
 */
import { getRedis, redisKey } from '../db/redis.js';

export interface SeckillMessage {
  reqId: string;
  userId: number;
  routeId: number;
  date: string;       // travel_date, YYYY-MM-DD
  people: number;
}

export const SECKILL_STREAM = 'seckill:stream';
export const SECKILL_DLQ    = 'seckill:stream:dlq';

/** 发消息到 Stream，返回消息 ID；失败抛异常 */
export async function publishSeckill(msg: SeckillMessage): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error('redis_unavailable');

  const messageId = await redis.xadd(
    redisKey(SECKILL_STREAM),
    '*',
    'reqId',   msg.reqId,
    'userId',  String(msg.userId),
    'routeId', String(msg.routeId),
    'date',    msg.date,
    'people',  String(msg.people)
  );
  if (!messageId) throw new Error('xadd_failed');
  console.log(JSON.stringify({ event: 'seckill.msg.published', reqId: msg.reqId, id: messageId }));
  return messageId;
}

/** 把处理失败的消息丢进死信队列 */
export async function publishToDlq(msg: SeckillMessage, error: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.xadd(
    redisKey(SECKILL_DLQ),
    '*',
    'reqId',   msg.reqId,
    'userId',  String(msg.userId),
    'routeId', String(msg.routeId),
    'date',    msg.date,
    'people',  String(msg.people),
    'error',   error.slice(0, 500)
  );
}
