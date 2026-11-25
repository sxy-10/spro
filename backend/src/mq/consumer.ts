import { hostname } from 'node:os';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { getRedis, isRedisReady, redisKey } from '../db/redis.js';
import { SeckillMessage, publishSeckillRetry, publishToDlq } from './producer.js';
import {
  createKafkaAdmin,
  createKafkaConsumer,
  publishKafka,
  SECKILL_DLT_TOPIC,
  SECKILL_GROUP,
  SECKILL_RETRY_TOPIC,
  SECKILL_TOPIC
} from './kafka.js';

const CONSUMER_NAME = `${hostname()}-${process.pid}`;
const RESULT_TTL_SECONDS = Number(process.env.SECKILL_RESULT_TTL_SECONDS ?? 1800);
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 5000, 30000];
const REFUND_ONCE_SCRIPT = `
  if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
  local value = redis.call('INCRBY', KEYS[1], ARGV[1])
  redis.call('SET', KEYS[2], '1', 'EX', 604800)
  return value
`;

class PoisonMessageError extends Error {}

const stats = {
  received: 0,
  succeeded: 0,
  duplicated: 0,
  failed: 0,
  dlq: 0,
  lastError: '',
  lastEventAt: 0
};

export const getConsumerStats = () => ({
  ...stats,
  consumer: CONSUMER_NAME,
  group: SECKILL_GROUP
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stockKeyOf = (msg: SeckillMessage) => `stock:${msg.routeId}:${msg.date}`;

async function writeResult(reqId: string, status: 'pending' | 'success' | 'failed', orderId?: number): Promise<void> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) throw new Error('redis_unavailable_while_recording_seckill_result');
  await redis.set(
    redisKey(`seckill:result:${reqId}`),
    JSON.stringify({ status, order_id: orderId ?? null, req_id: reqId }),
    'EX',
    RESULT_TTL_SECONDS
  );
}

async function refundStock(msg: SeckillMessage): Promise<void> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) {
    throw new Error(`redis_stock_refund_failed:${msg.reqId}`);
  }
  await redis.eval(
    REFUND_ONCE_SCRIPT,
    2,
    redisKey(stockKeyOf(msg)),
    redisKey(`seckill:refund:${msg.reqId}`),
    String(msg.people)
  );
}

async function createOrder(msg: SeckillMessage): Promise<{ ok: boolean; retryable: boolean; orderId?: number; error?: string }> {
  const [existing] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM tour_order WHERE req_id = ? LIMIT 1', [msg.reqId]
  );
  if (existing.length) {
    stats.duplicated += 1;
    return { ok: true, retryable: false, orderId: Number(existing[0].id) };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [stockRows] = await conn.query<RowDataPacket[]>(
      `SELECT seckill_total_seats, seckill_sold_seats, version
         FROM route_stock WHERE route_id = ? AND travel_date = ? FOR UPDATE`,
      [msg.routeId, msg.date]
    );
    if (!stockRows.length) {
      await conn.rollback();
      return { ok: false, retryable: false, error: 'stock_row_not_found' };
    }

    const total = Number(stockRows[0].seckill_total_seats);
    const sold = Number(stockRows[0].seckill_sold_seats);
    const version = Number(stockRows[0].version);
    if (sold + msg.people > total) {
      await conn.rollback();
      return { ok: false, retryable: false, error: 'seckill_sold_out' };
    }

    const [updated] = await conn.query<ResultSetHeader>(
      `UPDATE route_stock
          SET seckill_sold_seats = seckill_sold_seats + ?, version = version + 1
        WHERE route_id = ? AND travel_date = ? AND version = ?`,
      [msg.people, msg.routeId, msg.date, version]
    );
    if (updated.affectedRows !== 1) {
      await conn.rollback();
      return { ok: false, retryable: true, error: 'version_conflict' };
    }

    const [products] = await conn.query<RowDataPacket[]>(
      'SELECT base_price_rmb FROM travel_product WHERE id = ?', [msg.routeId]
    );
    const price = products.length ? Number(products[0].base_price_rmb) : 0;
    const orderNo = `SK${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const [inserted] = await conn.query<ResultSetHeader>(
      `INSERT INTO tour_order
        (order_no, user_id, product_id, travel_date, traveler_count, total_amount, status, req_id, is_stock_locked)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, 0)`,
      [orderNo, msg.userId, msg.routeId, msg.date, msg.people, price * msg.people, msg.reqId]
    );
    await conn.commit();
    return { ok: true, retryable: false, orderId: inserted.insertId };
  } catch (error: unknown) {
    try { await conn.rollback(); } catch { /* The connection may already be closed. */ }
    if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM tour_order WHERE req_id = ? LIMIT 1', [msg.reqId]
      );
      if (rows.length) {
        stats.duplicated += 1;
        return { ok: true, retryable: false, orderId: Number(rows[0].id) };
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, retryable: true, error: message };
  } finally {
    conn.release();
  }
}

function decodeMessage(value: Buffer | null): SeckillMessage {
  if (!value) throw new PoisonMessageError('empty_seckill_message');
  let parsed: Partial<SeckillMessage>;
  try {
    parsed = JSON.parse(value.toString()) as Partial<SeckillMessage>;
  } catch {
    throw new PoisonMessageError('invalid_seckill_json');
  }
  if (
    typeof parsed.reqId !== 'string' || parsed.reqId.length < 8 || parsed.reqId.length > 64 ||
    !Number.isSafeInteger(parsed.userId) || Number(parsed.userId) <= 0 ||
    !Number.isSafeInteger(parsed.routeId) || Number(parsed.routeId) <= 0 ||
    typeof parsed.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ||
    !Number.isSafeInteger(parsed.people) || Number(parsed.people) < 1 || Number(parsed.people) > 5
  ) {
    throw new PoisonMessageError('invalid_seckill_message');
  }
  return parsed as SeckillMessage;
}

async function handleKafkaMessage(
  topic: string,
  value: Buffer | null,
  attemptHeader: Buffer | string | (Buffer | string)[] | undefined
): Promise<void> {
  stats.received += 1;
  const msg = decodeMessage(value);
  const rawAttempt = Array.isArray(attemptHeader) ? attemptHeader[0] : attemptHeader;
  const attempt = Number(rawAttempt?.toString() ?? '0');
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > MAX_RETRIES) {
    throw new PoisonMessageError(`invalid_seckill_retry_count:${msg.reqId}`);
  }
  if (topic === SECKILL_RETRY_TOPIC && attempt > 0) {
    await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }

  const result = await createOrder(msg);
  if (result.ok) {
    await writeResult(msg.reqId, 'success', result.orderId);
    stats.succeeded += 1;
    stats.lastEventAt = Date.now();
    return;
  }

  const error = result.error ?? 'seckill_order_failed';
  if (result.retryable && attempt < MAX_RETRIES) {
    await publishSeckillRetry(msg, attempt + 1, error);
    return;
  }

  await refundStock(msg);
  await writeResult(msg.reqId, 'failed');
  await publishToDlq(msg, error, attempt);
  stats.failed += 1;
  stats.dlq += 1;
  stats.lastEventAt = Date.now();
}

let activeConsumer: Awaited<ReturnType<typeof createKafkaConsumer>> | null = null;

export function startSeckillConsumer(): () => void {
  let running = true;
  void (async () => {
    while (running) {
      let consumer: Awaited<ReturnType<typeof createKafkaConsumer>> | null = null;
      try {
        consumer = await createKafkaConsumer(SECKILL_GROUP);
        if (!running) {
          await consumer.disconnect();
          return;
        }
        activeConsumer = consumer;
        await consumer.subscribe({ topics: [SECKILL_TOPIC, SECKILL_RETRY_TOPIC], fromBeginning: true });
        await consumer.run({
          autoCommit: false,
          eachMessage: async ({ topic, partition, message }) => {
            try {
              await handleKafkaMessage(topic, message.value, message.headers?.attempt);
              await consumer?.commitOffsets([{
                topic,
                partition,
                offset: (BigInt(message.offset) + 1n).toString()
              }]);
            } catch (error: unknown) {
              stats.lastError = error instanceof Error ? error.message : String(error);
              console.error(JSON.stringify({ event: 'seckill.consumer.message_failed', topic, message: stats.lastError }));
              if (error instanceof PoisonMessageError) {
                await publishKafka(SECKILL_DLT_TOPIC, [{
                  key: message.key?.toString() ?? `invalid-${topic}-${partition}-${message.offset}`,
                  value: JSON.stringify({
                    raw: message.value?.toString() ?? null,
                    error: error.message,
                    failedAt: new Date().toISOString()
                  })
                }]);
                stats.failed += 1;
                stats.dlq += 1;
                await consumer?.commitOffsets([{
                  topic,
                  partition,
                  offset: (BigInt(message.offset) + 1n).toString()
                }]);
                return;
              }
              await sleep(1000);
              throw error;
            }
          }
        });
        break;
      } catch (error: unknown) {
        if (consumer) {
          activeConsumer = null;
          await consumer.disconnect().catch(() => undefined);
        }
        if (!running) break;
        stats.lastError = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({ event: 'seckill.consumer.start_failed', message: stats.lastError }));
        await sleep(5000);
      }
    }
  })().catch((error: unknown) => {
    stats.lastError = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: 'seckill.consumer.start_failed', message: stats.lastError }));
  });

  return () => {
    running = false;
    const consumer = activeConsumer;
    activeConsumer = null;
    if (consumer) {
      void consumer.stop().then(() => consumer.disconnect()).catch((error: unknown) => {
        console.error(JSON.stringify({
          event: 'seckill.consumer.stop_failed',
          message: error instanceof Error ? error.message : String(error)
        }));
      });
    }
  };
}

export async function getQueueStats(): Promise<{
  kafka: 'ok' | 'unavailable';
  lag: number | null;
  dltLength: number | null;
  consumer: string;
  group: string;
  counters: ReturnType<typeof getConsumerStats>;
}> {
  const counters = getConsumerStats();
  const admin = createKafkaAdmin();
  try {
    await admin.connect();
    const [mainOffsets, retryOffsets, dltOffsets] = await Promise.all([
      admin.fetchTopicOffsets(SECKILL_TOPIC),
      admin.fetchTopicOffsets(SECKILL_RETRY_TOPIC),
      admin.fetchTopicOffsets(SECKILL_DLT_TOPIC)
    ]);
    const [mainCommitted, retryCommitted] = await Promise.all([
      admin.fetchOffsets({ groupId: SECKILL_GROUP, topics: [SECKILL_TOPIC] }),
      admin.fetchOffsets({ groupId: SECKILL_GROUP, topics: [SECKILL_RETRY_TOPIC] })
    ]);
    const committedFor = (topic: string, values: typeof mainCommitted) =>
      values.find((entry) => entry.topic === topic)?.partitions
        .reduce((sum, item) => sum + Math.max(0, Number(item.offset)), 0) ?? 0;
    const lag = [...mainOffsets, ...retryOffsets].reduce((sum, item) => sum + Number(item.offset), 0)
      - committedFor(SECKILL_TOPIC, mainCommitted)
      - committedFor(SECKILL_RETRY_TOPIC, retryCommitted);
    const dltLength = dltOffsets.reduce((sum, item) => sum + Number(item.offset), 0);
    return { kafka: 'ok', lag: Math.max(0, lag), dltLength, consumer: CONSUMER_NAME, group: SECKILL_GROUP, counters };
  } catch (error: unknown) {
    return {
      kafka: 'unavailable',
      lag: null,
      dltLength: null,
      consumer: CONSUMER_NAME,
      group: SECKILL_GROUP,
      counters: { ...counters, lastError: error instanceof Error ? error.message : String(error) }
    };
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}
