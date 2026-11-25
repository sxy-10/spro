/**
 * 秒杀与推荐事件写 Kafka；IM 离线通知继续使用 Redis Stream。
 */
import { getRedis, redisKey } from '../db/redis.js';
import {
  publishKafka,
  RECOMMENDATION_EVENTS_TOPIC,
  SECKILL_DLT_TOPIC,
  SECKILL_RETRY_TOPIC,
  SECKILL_TOPIC
} from './kafka.js';

export interface SeckillMessage {
  reqId: string;
  userId: number;
  routeId: number;
  date: string;       // travel_date, YYYY-MM-DD
  people: number;
}

/** Kafka 不可用时抛出，调用方必须回补 Redis 预扣库存。 */
export async function publishSeckill(msg: SeckillMessage): Promise<string> {
  await publishKafka(SECKILL_TOPIC, [{
    key: msg.reqId,
    value: JSON.stringify(msg),
    headers: { attempt: '0' }
  }]);
  return msg.reqId;
}

/** 把处理失败的消息放入 Kafka 死信 topic；失败会继续向上传递，避免提前提交 offset。 */
export async function publishToDlq(msg: SeckillMessage, error: string, attempts = 0): Promise<void> {
  await publishKafka(SECKILL_DLT_TOPIC, [{
    key: msg.reqId,
    value: JSON.stringify({ ...msg, error: error.slice(0, 500), attempts, failedAt: new Date().toISOString() })
  }]);
}

export async function publishSeckillRetry(msg: SeckillMessage, attempt: number, error: string): Promise<void> {
  await publishKafka(SECKILL_RETRY_TOPIC, [{
    key: msg.reqId,
    value: JSON.stringify(msg),
    headers: { attempt: String(attempt), lastError: error.slice(0, 500) }
  }]);
}

export async function publishRecommendationEvents(
  events: Array<{ userId: string; value: string }>
): Promise<void> {
  if (events.length === 0) return;
  await publishKafka(RECOMMENDATION_EVENTS_TOPIC, events.map((event) => ({
    key: event.userId,
    value: event.value
  })));
}

/* ---------------- IM 离线通知（组员3 · 第 3 棒） ---------------- */

export const IM_STREAM = 'im:notify';
const STREAM_MAXLEN = Number(process.env.IM_NOTIFY_STREAM_MAXLEN ?? 10000);

export interface ImNotifyMessage {
  convId: number;
  seq: number;
  preview: string;
}

/** 会话全员离线时投递一条离线通知，消费端按参与者逐个 INCR 离线计数。
 *  边界：只写 im:notify，秒杀和埋点使用 Kafka。 */
export async function publishImNotify(msg: ImNotifyMessage): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error('redis_unavailable');
  const messageId = await redis.xadd(
    redisKey(IM_STREAM),
    'MAXLEN', '~', STREAM_MAXLEN,
    '*',
    'convId', String(msg.convId),
    'seq', String(msg.seq),
    'preview', msg.preview.slice(0, 100)
  );
  if (!messageId) throw new Error('xadd_failed');
  return messageId;
}
