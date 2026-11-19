/**
 * MQ 消费者（组员3 · 阶段二；阶段六加固）
 *
 * 从 Redis Stream 读秒杀消息，在数据库事务里：
 *   1. 按 req_id 查重（幂等，重复消息直接 ACK 跳过）
 *   2. SELECT route_stock ... FOR UPDATE 行锁
 *   3. 乐观锁 UPDATE：seckill_sold_seats+1, version+1 WHERE version=?
 *   4. INSERT tour_order
 *   5. 写 Redis 结果 + XACK
 *
 * 失败重试 3 次仍失败 → 回补 Redis 库存 + 写 result:failed + 进死信队列 + XACK。
 *
 * ============================ 阶段六修复说明 ============================
 *
 * 原来的实现踩了 Redis Stream 的五个经典坑，任何一个都会让"队列削峰"变成"订单黑洞"：
 *
 * ① **消费者不重连**
 *    `retryStrategy: () => null` + `enableOfflineQueue:false` = 连上过一次之后，
 *    Redis 断一次这条消费者就永远死了：Stream 一直涨，前端一直 pending，日志里什么都没有。
 *    → 改成指数退避重连（永不放弃），并把每次异常写进 stats.lastError。
 *
 * ② **没有 PEL 回收（最致命）**
 *    XREADGROUP 之后、XACK 之前进程崩溃/被杀 → 消息永久留在 pending 列表里，
 *    既不会被重投也不会被删除。用户钱付了，订单没有，而且系统看起来"一切正常"。
 *    → 加了 XAUTOCLAIM 循环：每 30 秒把"空闲超过 60 秒"的消息认领回来重新处理。
 *
 * ③ **消费者名写死 'consumer-1'**
 *    多开一个实例时两个进程同名，共享同一个 PEL：A 的消息被 B 认领、B 的 XACK 记到 A 名下（等于没 ACK）。
 *    → 改成 `${hostname}-${pid}`，多实例天然隔离。
 *
 * ④ **setInterval(1s) 套 BLOCK 2000ms**
 *    周期比阻塞时间短，多个消费循环会叠起来并发跑；加上失败重试是串行 sleep，一条坏消息能卡住整条队列。
 *    → 改成 while 循环 + 批量并发（默认 4）+ 指数退避重试 + 非重试型错误立刻走死信。
 *
 * ⑤ **死信不回补库存 / 结果记录只有 10 分钟**
 *    Redis 预扣成功但落库失败 → 名额被扣掉却卖不出去（库存泄漏）；
 *    结果 key 600 秒就过期，用户过 11 分钟回来查还是"排队中"。
 *    → 进死信前先 INCRBY 回补库存；结果 TTL 拉到 30 分钟，过期后由接口回查 MySQL 兜底。
 * ====================================================================
 */
import { hostname } from 'node:os';
import Redis from 'ioredis';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { getRedis, incrBy, isRedisReady, redisKey, waitForRedis } from '../db/redis.js';
import { SeckillMessage, SECKILL_STREAM, SECKILL_DLQ, publishToDlq } from './producer.js';

const GROUP_NAME = process.env.SECKILL_GROUP ?? 'seckill-group';
/** 消费者名必须每个进程不同，否则多实例会共享 PEL（见文件头 ③） */
const CONSUMER_NAME = `${hostname()}-${process.pid}`;

const RESULT_TTL_SECONDS = Number(process.env.SECKILL_RESULT_TTL_SECONDS ?? 1800);
const BATCH_SIZE = Number(process.env.SECKILL_CONSUMER_BATCH ?? 20);
const CONCURRENCY = Math.max(1, Number(process.env.SECKILL_CONSUMER_CONCURRENCY ?? 4));
const BLOCK_MS = 2000;
/** 一条消息被认领前允许"无人认领"的空闲时间 */
const CLAIM_IDLE_MS = Number(process.env.SECKILL_CLAIM_IDLE_MS ?? 60000);
const RECLAIM_INTERVAL_MS = Number(process.env.SECKILL_RECLAIM_INTERVAL_MS ?? 30000);
const MAX_ATTEMPTS = Math.max(1, Number(process.env.SECKILL_MAX_ATTEMPTS ?? 3));
const EMPTY_STREAM_POLL_MS = 200;

/** 运行指标：给 /v1/health/queue 和日志用 */
const stats = {
  received: 0,
  succeeded: 0,
  duplicated: 0,
  failed: 0,
  dlq: 0,
  reclaimed: 0,
  lastError: '',
  lastEventAt: 0
};

export const getConsumerStats = () => ({ ...stats, consumer: CONSUMER_NAME, group: GROUP_NAME });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 消费者使用独立连接：BLOCK 读会把连接占住 2 秒，混用业务连接会拖慢所有接口。
 * 重连策略与 db/redis.ts 一致（指数退避、永不放弃）。
 */
function createConsumerRedis(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 1000),
    retryStrategy: (times: number) => Math.min(200 * 2 ** Math.min(times - 1, 4), 3000),
    reconnectOnError: (error: Error) => /READONLY|LOADING|MASTERDOWN|TRYAGAIN/.test(error.message)
  });
}

/**
 * 创建消费组。
 * 用 '0' 而不是 '$'：'$' 会让"建组之前已经进队列的消息"被永久忽略，
 * 而 '0' 表示从头消费，建组之后的所有消息都不会漏。（组已存在时抛 BUSYGROUP，忽略）
 */
async function ensureGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup('CREATE', redisKey(SECKILL_STREAM), GROUP_NAME, '0', 'MKSTREAM');
    console.log(JSON.stringify({ event: 'seckill.group.created', group: GROUP_NAME }));
  } catch (error: any) {
    if (!String(error?.message ?? '').includes('BUSYGROUP')) {
      console.log(JSON.stringify({ event: 'seckill.group.create_failed', message: error?.message }));
      throw error;
    }
  }
}

/** 把 Stream 消息数组 [id, [f1,v1,f2,v2...]] 解析成 SeckillMessage */
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

const stockKeyOf = (msg: SeckillMessage) => `stock:${msg.routeId}:${msg.date}`;

/** 写秒杀结果到 Redis，前端轮询读 */
async function writeResult(reqId: string, status: 'pending' | 'success' | 'failed', orderId?: number): Promise<void> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return;
  try {
    await redis.set(
      redisKey(`seckill:result:${reqId}`),
      JSON.stringify({ status, order_id: orderId ?? null, req_id: reqId }),
      'EX',
      RESULT_TTL_SECONDS
    );
  } catch (error: any) {
    console.log(JSON.stringify({ event: 'seckill.result.write_failed', reqId, message: error?.message }));
  }
}

/** 回补预扣掉的库存（死信 / 落库失败时必须调用，否则名额被吞掉） */
async function refundStock(msg: SeckillMessage): Promise<void> {
  const left = await incrBy(stockKeyOf(msg), msg.people);
  console.log(JSON.stringify({ event: 'seckill.stock.refunded', reqId: msg.reqId, people: msg.people, left }));
}

interface HandleResult {
  ok: boolean;
  /** false = 这个错误重试也没用（如库存不足），直接进死信 */
  retryable: boolean;
  error?: string;
}

/**
 * 处理单条消息。整个"查重 → 锁行 → 乐观锁扣减 → 建单"在一个数据库事务里，
 * 任何一步失败都 rollback，不会出现"扣了名额没建单"。
 */
async function handleMessage(msg: SeckillMessage): Promise<HandleResult> {
  // ① 幂等：先查这个 req_id 是否已建过单（uk_order_req 唯一键是最后一道防线）
  const [existing] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM tour_order WHERE req_id = ?', [msg.reqId]
  );
  if (existing.length) {
    stats.duplicated += 1;
    console.log(JSON.stringify({ event: 'seckill.dup.skip', reqId: msg.reqId, orderId: existing[0].id }));
    await writeResult(msg.reqId, 'success', Number(existing[0].id));
    return { ok: true, retryable: false };
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

    // ③ 乐观锁扣减：WHERE version = 读到的版本号
    const [upd] = await conn.query<ResultSetHeader>(
      `UPDATE route_stock
       SET seckill_sold_seats = seckill_sold_seats + ?, version = version + 1
       WHERE route_id = ? AND travel_date = ? AND version = ?`,
      [msg.people, msg.routeId, msg.date, version]
    );
    if (upd.affectedRows !== 1) {
      await conn.rollback();
      return { ok: false, retryable: true, error: 'version_conflict' };
    }

    // ④ 查产品价格
    const [prodRows] = await conn.query<RowDataPacket[]>(
      'SELECT base_price_rmb FROM travel_product WHERE id = ?', [msg.routeId]
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
    stats.succeeded += 1;
    console.log(JSON.stringify({ event: 'seckill.order.created', reqId: msg.reqId, orderId }));
    await writeResult(msg.reqId, 'success', orderId);
    return { ok: true, retryable: false };
  } catch (error: any) {
    try { await conn.rollback(); } catch { /* 连接已断时忽略 */ }
    // 唯一键冲突 = 并发重投，说明已经建过单了，按成功处理
    if (error?.code === 'ER_DUP_ENTRY') {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM tour_order WHERE req_id = ?', [msg.reqId]);
      if (rows.length) {
        await writeResult(msg.reqId, 'success', Number(rows[0].id));
        return { ok: true, retryable: false };
      }
    }
    console.log(JSON.stringify({ event: 'seckill.order.failed', reqId: msg.reqId, error: error?.message }));
    return { ok: false, retryable: true, error: String(error?.message ?? error) };
  } finally {
    conn.release();
  }
}

/** 带重试 + 死信 + 回补库存的完整处理流程（一条消息走完就 ACK） */
async function processMessage(redis: Redis, id: string, raw: [string, string[]]): Promise<void> {
  const { msg } = parseMessage(raw);
  stats.received += 1;
  let lastError = '';
  let ok = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await handleMessage(msg);
    if (result.ok) { ok = true; break; }
    lastError = result.error ?? 'unknown';
    if (!result.retryable) break;
    // 指数退避：200ms → 400ms → 800ms，避免"撞一下就好"的临时错误立刻进死信
    await sleep(200 * 2 ** (attempt - 1));
  }

  try {
    if (ok) {
      await redis.xack(redisKey(SECKILL_STREAM), GROUP_NAME, id);
      stats.lastEventAt = Date.now();
      return;
    }

    stats.failed += 1;
    // 落库彻底失败：先把预扣的库存还回去，再写失败结果、进死信、最后 ACK
    await refundStock(msg);
    await writeResult(msg.reqId, 'failed');
    await publishToDlq(msg, lastError, MAX_ATTEMPTS);
    await redis.xack(redisKey(SECKILL_STREAM), GROUP_NAME, id);
    stats.dlq += 1;
    stats.lastEventAt = Date.now();
    console.log(JSON.stringify({ event: 'seckill.msg.dlq', reqId: msg.reqId, reason: lastError }));
  } catch (error: any) {
    // ACK 失败没关系：消息还在 PEL 里，会被 XAUTOCLAIM 再捞回来（依靠 req_id 幂等）
    stats.lastError = String(error?.message ?? error);
    console.log(JSON.stringify({ event: 'seckill.ack_failed', reqId: msg.reqId, message: stats.lastError }));
  }
}

/** 一批消息按并发度处理（同一条 Stream 内不保证顺序，但同一 reqId 幂等） */
async function runBatch(redis: Redis, messages: Array<[string, string[]]>): Promise<void> {
  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    const slice = messages.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(([id, fields]) => processMessage(redis, id, [id, fields])));
  }
}

/** 主消费循环：XREADGROUP 阻塞读（用 while 而不是 setInterval，避免循环重叠） */
async function readLoop(redis: Redis, isRunning: () => boolean): Promise<void> {
  while (isRunning()) {
    try {
      const response = (await redis.call(
        'XREADGROUP', 'GROUP', GROUP_NAME, CONSUMER_NAME,
        'COUNT', BATCH_SIZE, 'BLOCK', BLOCK_MS,
        'STREAMS', redisKey(SECKILL_STREAM), '>'
      )) as Array<[string, Array<[string, string[]]>]> | null;

      if (!response) { await sleep(EMPTY_STREAM_POLL_MS); continue; }
      for (const [, messages] of response) await runBatch(redis, messages);
    } catch (error: any) {
      stats.lastError = String(error?.message ?? error);
      console.log(JSON.stringify({ event: 'seckill.consumer.error', message: stats.lastError }));
      await sleep(1000); // 连接抖动时别空转打满 CPU
    }
  }
}

/**
 * PEL 回收循环：把"投递出去但迟迟没 ACK"的消息认领回来重新处理。
 * 这是 Redis Stream 唯一的"至少一次"保障 —— 没有它，进程崩溃就等于丢单。
 */
async function reclaimLoop(redis: Redis, isRunning: () => boolean): Promise<void> {
  while (isRunning()) {
    try {
      let cursor = '0-0';
      do {
        const reply = (await redis.call(
          'XAUTOCLAIM', redisKey(SECKILL_STREAM), GROUP_NAME, CONSUMER_NAME,
          CLAIM_IDLE_MS, cursor, 'COUNT', BATCH_SIZE
        )) as [string, Array<[string, string[]]>, string[]] | null;

        if (!reply) break;
        const [nextCursor, claimed] = reply;
        cursor = nextCursor ?? '0-0';
        if (claimed?.length) {
          stats.reclaimed += claimed.length;
          console.log(JSON.stringify({ event: 'seckill.msg.reclaimed', count: claimed.length }));
          await runBatch(redis, claimed);
        }
      } while (cursor !== '0-0' && isRunning());
    } catch (error: any) {
      stats.lastError = String(error?.message ?? error);
      console.log(JSON.stringify({ event: 'seckill.reclaim.error', message: stats.lastError }));
    }
    await sleep(RECLAIM_INTERVAL_MS);
  }
}

/** 消费者主入口：返回 stop()，server 关闭时调用 */
export function startSeckillConsumer(): () => void {
  const redis = createConsumerRedis();
  let running = true;
  const isRunning = () => running;

  redis.on('error', (error: Error) => {
    stats.lastError = error.message;
    console.log(JSON.stringify({ event: 'seckill.consumer.redis_error', message: error.message }));
  });

  void (async () => {
    // Redis 可能比 Node 晚起来：先等一等，再建组，否则组会一直建不上
    const ready = await waitForRedis(15000);
    if (!ready) console.log(JSON.stringify({ event: 'seckill.consumer.redis_not_ready' }));

    // 每 5 秒重试一次建组，直到成功（Redis 挂了也能自愈）
    while (running) {
      try { await ensureGroup(redis); break; } catch { await sleep(5000); }
    }
    if (!running) { redis.disconnect(); return; }

    await Promise.all([readLoop(redis, isRunning), reclaimLoop(redis, isRunning)]);
  })().catch((error: any) => {
    stats.lastError = String(error?.message ?? error);
    console.log(JSON.stringify({ event: 'seckill.consumer.fatal', message: stats.lastError }));
  });

  return () => {
    running = false;
    try { redis.disconnect(); } catch { /* 忽略 */ }
  };
}

/** 队列可观测性：积压多少、多少条在 PEL、死信多少 —— 答辩时要能当场查 */
export async function getQueueStats(): Promise<{
  redis: 'ok' | 'unavailable';
  streamLength: number | null;
  pending: number | null;
  dlqLength: number | null;
  streamMaxLength: number;
  consumer: string;
  group: string;
  counters: ReturnType<typeof getConsumerStats>;
}> {
  const counters = getConsumerStats();
  const redis = getRedis();
  if (!redis || !isRedisReady()) {
    return { redis: 'unavailable', streamLength: null, pending: null, dlqLength: null, streamMaxLength: 0, consumer: CONSUMER_NAME, group: GROUP_NAME, counters };
  }
  try {
    const [streamLength, dlqLength, pendingReply] = await Promise.all([
      redis.xlen(redisKey(SECKILL_STREAM)),
      redis.xlen(redisKey(SECKILL_DLQ)),
      (redis.call('XPENDING', redisKey(SECKILL_STREAM), GROUP_NAME) as Promise<unknown[]>).catch(() => null)
    ]);
    const pending = Array.isArray(pendingReply) ? Number(pendingReply[0]) : null;
    return {
      redis: 'ok',
      streamLength,
      pending,
      dlqLength,
      streamMaxLength: Number(process.env.SECKILL_STREAM_MAXLEN ?? 10000),
      consumer: CONSUMER_NAME,
      group: GROUP_NAME,
      counters
    };
  } catch {
    return { redis: 'unavailable', streamLength: null, pending: null, dlqLength: null, streamMaxLength: 0, consumer: CONSUMER_NAME, group: GROUP_NAME, counters };
  }
}
