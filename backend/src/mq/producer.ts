/**
 * MQ 生产者（组员3 · 阶段二）
 *
 * 用 Redis Stream 做消息队列：
 *   XADD seckill:stream MAXLEN ~ 10000 * reqId xxx userId xxx routeId xxx ...
 *
 * 不引入 RabbitMQ，直接复用组员1的 ioredis 连接。
 *
 * 阶段六修复：**加上 MAXLEN**。
 *   原来 XADD 不带长度上限，压测几轮就是几万条常驻内存，Redis 只涨不降。
 *   开 MAXLEN ~ 10000 后，Stream 自己会裁剪老消息（`~` 表示按整块粗略裁剪，开销比精确裁剪小）。
 *   注意：已经 ACK 的消息本来就不需要保留，所以裁剪不会丢"待处理"的消息——
 *   还没 ACK 的消息在 PEL（pending 列表）里，不受 MAXLEN 影响。
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
export const SECKILL_DLQ = 'seckill:stream:dlq';

/** Stream 保留的最大条数（可用 SECKILL_STREAM_MAXLEN 调整） */
const STREAM_MAXLEN = Number(process.env.SECKILL_STREAM_MAXLEN ?? 10000);
/** 死信队列保留条数（死信要留够时间排查，但也不能无限涨） */
const DLQ_MAXLEN = Number(process.env.SECKILL_DLQ_MAXLEN ?? 2000);

/** 发消息到 Stream，返回消息 ID；失败抛异常（调用方负责回补 Redis 库存） */
export async function publishSeckill(msg: SeckillMessage): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error('redis_unavailable');

  const messageId = await redis.xadd(
    redisKey(SECKILL_STREAM),
    'MAXLEN', '~', STREAM_MAXLEN,
    '*',
    'reqId', msg.reqId,
    'userId', String(msg.userId),
    'routeId', String(msg.routeId),
    'date', msg.date,
    'people', String(msg.people)
  );
  if (!messageId) throw new Error('xadd_failed');
  console.log(JSON.stringify({ event: 'seckill.msg.published', reqId: msg.reqId, id: messageId }));
  return messageId;
}

/** 把处理失败的消息丢进死信队列（带重试次数与原因，方便事后重放/排查） */
export async function publishToDlq(msg: SeckillMessage, error: string, attempts = 0): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.xadd(
      redisKey(SECKILL_DLQ),
      'MAXLEN', '~', DLQ_MAXLEN,
      '*',
      'reqId', msg.reqId,
      'userId', String(msg.userId),
      'routeId', String(msg.routeId),
      'date', msg.date,
      'people', String(msg.people),
      'attempts', String(attempts),
      'error', error.slice(0, 500),
      'at', new Date().toISOString()
    );
  } catch (dlqError: any) {
    // 连死信都写不进去只能落日志，不能影响主流程
    console.log(JSON.stringify({ event: 'seckill.dlq.failed', reqId: msg.reqId, message: dlqError?.message }));
  }
}
