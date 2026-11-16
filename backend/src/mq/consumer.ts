/**
 * MQ 消费者（组员3 · 阶段二）
 *
 * 从 Redis Stream 读秒杀消息，在数据库事务里：
 *   1. 按 req_id 查重（幂等，重复消息直接 ACK 跳过）
 *   2. SELECT route_stock ... FOR UPDATE 行锁
 *   3. 乐观锁 UPDATE：seckill_sold_seats+1, version+1 WHERE version=?
 *   4. INSERT tour_order
 *   5. 写 Redis 结果 + XACK
 *
 * 失败重试 3 次仍失败 → 丢死信队列 + 写 result:failed
 */
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import Redis from 'ioredis';
import { pool } from '../db/connection.js';
import { getRedis, redisKey } from '../db/redis.js';
import { SeckillMessage, SECKILL_STREAM, SECKILL_DLQ } from './producer.js';

const GROUP_NAME = 'seckill-group';
const CONSUMER_NAME = 'consumer-1';
const MAX_RETRIES = 3;

/** 消费者用独立 Redis 连接，避免 BLOCK 读占用业务连接 */
function createConsumerRedis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    enableOfflineQueue: false
  });
}

/** 启动时确保消费组存在（已内联到 startSeckillConsumer，保留备用） */
async function ensureGroup(redis: Redis) {
  try {
    await redis.xgroup('CREATE', redisKey(SECKILL_STREAM), GROUP_NAME, '$', 'MKSTREAM');
  } catch (error: any) {
    // BUSYGROUP = 组已存在，忽略
    if (!String(error?.message).includes('BUSYGROUP')) {
      console.log(JSON.stringify({ event: 'seckill.group.create_failed', message: error?.message }));
    }
  }
}

/** 把 Stream 消息数组解析成 SeckillMessage */
function parseMessage(raw: [string, string[]]): { id: string; msg: SeckillMessage } {
  const [id, fields] = raw;
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
  return {
    id,
    msg: {
      reqId: obj.reqId,
      userId: Number(obj.userId),
      routeId: Number(obj.routeId),
      date: obj.date,
      people: Number(obj.people)
    }
  };
}

/** 写秒杀结果到 Redis，前端轮询读 */
async function writeResult(reqId: string, status: 'pending' | 'success' | 'failed', orderId?: number) {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(
    redisKey(`seckill:result:${reqId}`),
    JSON.stringify({ status, order_id: orderId ?? null }),
    'EX',
    600
  );
}

/** 处理单条消息：返回是否成功 */
async function handleMessage(msg: SeckillMessage): Promise<boolean> {
  // ① 幂等：先查这个 req_id 是否已建过单
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM tour_order WHERE req_id = ?`, [msg.reqId]
  );
  if (existing.length) {
    console.log(JSON.stringify({ event: 'seckill.dup.skip', reqId: msg.reqId, orderId: existing[0].id }));
    await writeResult(msg.reqId, 'success', Number(existing[0].id));
    return true;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ② 锁库存行
    const [stockRows] = await conn.query<RowDataPacket[]>(
      `SELECT seckill_total_seats, seckill_sold_seats, version
       FROM route_stock WHERE route_id = ? AND travel_date = ? FOR UPDATE`,
      [msg.routeId, msg.date]
    );
    if (!stockRows.length) throw new Error('stock_row_not_found');

    const total = Number(stockRows[0].seckill_total_seats);
    const sold  = Number(stockRows[0].seckill_sold_seats);
    const version = Number(stockRows[0].version);
    if (sold + msg.people > total) throw new Error('seckill_sold_out');

    // ③ 乐观锁扣减：WHERE version = 读到的版本号
    const [upd] = await conn.query<ResultSetHeader>(
      `UPDATE route_stock
       SET seckill_sold_seats = seckill_sold_seats + ?, version = version + 1
       WHERE route_id = ? AND travel_date = ? AND version = ?`,
      [msg.people, msg.routeId, msg.date, version]
    );
    if (upd.affectedRows !== 1) throw new Error('version_conflict');

    // ④ 查产品价格
    const [prodRows] = await conn.query<RowDataPacket[]>(
      `SELECT base_price_rmb FROM travel_product WHERE id = ?`, [msg.routeId]
    );
    const price = prodRows.length ? Number(prodRows[0].base_price_rmb) : 0;
    const orderNo = 'SK' + Date.now() + Math.floor(Math.random() * 10000);

    // ⑤ 建订单
    const [ins] = await conn.query<ResultSetHeader>(
      `INSERT INTO tour_order
        (order_no, user_id, product_id, travel_date, traveler_count, total_amount, status, req_id, is_stock_locked)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, 0)`,
      [orderNo, msg.userId, msg.routeId, msg.date, msg.people, price * msg.people, msg.reqId]
    );

    await conn.commit();
    const orderId = ins.insertId;
    console.log(JSON.stringify({ event: 'seckill.order.created', reqId: msg.reqId, orderId }));
    await writeResult(msg.reqId, 'success', orderId);
    return true;
  } catch (error: any) {
    await conn.rollback();
    console.log(JSON.stringify({ event: 'seckill.order.failed', reqId: msg.reqId, error: error?.message }));
    await writeResult(msg.reqId, 'failed');
    return false;
  } finally {
    conn.release();
  }
}

/** 消费者主循环：XREADGROUP 阻塞读 */
export function startSeckillConsumer() {
  const redis = createConsumerRedis();
  redis.connect().catch(() => {});

  let running = true;
  let groupReady = false;
  const timer = setInterval(async () => {
    if (!running) return;
    try {
      if (!groupReady) {
        try {
          await redis.xgroup('CREATE', redisKey(SECKILL_STREAM), GROUP_NAME, '$', 'MKSTREAM');
        } catch (e: any) {
          if (!String(e?.message).includes('BUSYGROUP')) {
            console.log(JSON.stringify({ event: 'seckill.group.create_failed', message: e?.message }));
          }
        }
        groupReady = true;
      }
      // 从消费组读新消息（> 表示从未投递过的）
      const res = await (redis as any).call(
        'XREADGROUP',
        'GROUP', GROUP_NAME, CONSUMER_NAME,
        'COUNT', 5, 'BLOCK', 2000,
        'STREAMS', redisKey(SECKILL_STREAM), '>'
      ) as [string, [string, string[]][]][] | null;
      if (!res) return;
      for (const [_stream, messages] of res) {
        for (const raw of messages) {
          const { id, msg } = parseMessage(raw);
          let ok = await handleMessage(msg);
          let tries = 1;
          while (!ok && tries < MAX_RETRIES) {
            tries++;
            await new Promise(r => setTimeout(r, 500 * tries));
            ok = await handleMessage(msg);
          }
          if (ok) {
            await redis.xack(redisKey(SECKILL_STREAM), GROUP_NAME, id);
          } else {
            await redis.xack(redisKey(SECKILL_STREAM), GROUP_NAME, id);
            await redis.xadd(redisKey(SECKILL_DLQ), '*', 'reqId', msg.reqId, 'error', 'max_retries_exceeded');
            console.log(JSON.stringify({ event: 'seckill.msg.dlq', reqId: msg.reqId }));
          }
        }
      }
    } catch (error: any) {
      console.log(JSON.stringify({ event: 'seckill.consumer.error', message: error?.message }));
    }
  }, 1000);

  timer.unref();
  return () => { running = false; clearInterval(timer); redis.disconnect(); };
}
