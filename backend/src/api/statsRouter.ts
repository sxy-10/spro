import { Router } from 'express';
import { authenticateJwt } from '../auth/passport.js';
import { requireAction } from '../auth/rbac.js';
import { pool } from '../db/connection.js';
import { getRedis, isRedisReady, redisKey } from '../db/redis.js';
import { run } from './core.js';
import { RowDataPacket } from 'mysql2/promise';
import { onlineConnectionGauge, onlineUserCount } from '../im/presence.js';
import { hub } from '../im/hub.js';
import { logEvent } from '../im/protocol.js';
import { getQueueStats } from '../mq/consumer.js';

export const statsRouter = Router();
statsRouter.use(authenticateJwt);

/**
 * 实时大屏 SSE（第 2 棒 · 组员1 接手第 1 棒的骨架，填真数据）
 *
 * 四个数字（对应分工文档 2.7 与老师的「Redis + 消息队列」检查项）：
 *   online_count      在线人数    → Redis `im:online:set` 的 SCARD（WS 真实在线，去重）
 *   online_conn       在线连接数  → Redis `im:stat:conn`（多端在线，connection 级别）
 *   today_order_count 今日订单    → MySQL tour_order 当天计数
 *   message_count     消息吞吐    → Redis `im:stat:msg`（第 3 棒每发一条 INCR），拿不到回退 MySQL 当日计数
 *   seckill_qps       秒杀 QPS    → 最近 10s 下单数 / 10（下单速率口径，见下方注释）
 *
 * 三条工程约束：
 *   ① **每 5s 一次、一条聚合 SQL**，绝不 per-connection 打库（大屏开 10 个窗口也只打一次）
 *   ② **任何一路拿不到都不能让流断**：逐项降级并把降级项写进 `degraded`，前端据此做灰色/红闪
 *   ③ 客户端断开要清定时器，否则进程里会攒下一堆空转的 interval
 *
 * 为什么秒杀 QPS 用"最近 10s 下单数/10"：
 *   秒杀的真实 QPS（被限流拦下的请求数）需要 Redis 计数器，属于第 6 棒的性能工作；
 *   这一棒先用"实际成交速率"作为可视指标，口径写在文档里，避免答辩时说不清数据来源。
 *
 * 第 5 棒扩展字段（gmv_today / agent / order_status / hourly_messages /
 * recent_orders / mq）：与核心五项共用同一拍输出，采集仍走"一条聚合 SQL +
 * 少量独立查询 + Redis Stream 观测"，任何一路失败只标 degraded、不断流。
 */

const INTERVAL_MS = Number(process.env.STATS_INTERVAL_MS ?? 5000);
/** 计算 QPS 的滑动窗口（秒） */
const QPS_WINDOW_SECONDS = 10;

interface LiveSnapshot {
  online_count: number;
  online_conn: number;
  today_order_count: number;
  message_count: number;
  seckill_qps: number;
  ts: number;
  /** 哪些指标是降级值（Redis 不可用 / 计数缺失） */
  degraded: string[];
  /** —— 以下为第 5 棒大屏扩展字段 —— */
  /** 今日成交金额（元）：当天创建且已支付/已完成的订单总额 */
  gmv_today: number;
  /** 客服接待域监控（第 5 棒 im_conversation / im_rating） */
  agent: {
    /** 待接入：ACTIVE 且无 assignee（全项目唯一口径） */
    pending: number;
    /** 接待中：ACTIVE 且有 assignee */
    serving: number;
    /** 今日新建会话数 */
    today_conversations: number;
    /** 满意度均分（1..5，无评价时为 null） */
    avg_rating: number | null;
    /** 累计评价条数 */
    rating_count: number;
  };
  /** 订单状态分布（全部订单，环形图用）。CONFIRMED 为种子数据存在的历史状态，防御性统计 */
  order_status: { pending: number; paid: number; confirmed: number; completed: number; cancelled: number; refunded: number };
  /** 最近 24 小时逐小时消息量（旧→新，24 桶，柱状图用） */
  hourly_messages: number[];
  /** 最新 5 条订单（跑马灯用） */
  recent_orders: Array<{ order_no: string; title: string; amount: number; status: string; created_at: string }>;
  /** MQ 消费积压（Redis Stream：队列长度 / PEL 待 ACK / 死信） */
  mq: { backlog: number | null; pending: number | null; dlq: number | null; redis: 'ok' | 'unavailable' };
}

/** 取一个字符串计数器；Redis 不可用或 key 不存在时返回 null */
async function readCounter(name: string): Promise<number | null> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return null;
  try {
    const raw = await redis.get(redisKey(name));
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 聚合一次快照。
 * 先并行拿 Redis（在线数/连接数/消息计数），再一条 SQL 兜住与 MySQL 相关的三项。
 * 任何一项抛错都不向外抛，统一转成降级项。
 */
async function collectSnapshot(): Promise<LiveSnapshot> {
  const degraded: string[] = [];

  const [presenceCount, connGauge, msgCounter] = await Promise.all([
    onlineUserCount(),
    onlineConnectionGauge(),
    readCounter('im:stat:msg')
  ]);

  let onlineUsersFallback = 0;
  let todayOrders = 0;
  let todayMessages = 0;
  let recentOrders = 0;
  let gmvToday = 0;
  let convPending = 0;
  let convServing = 0;
  let convToday = 0;
  let avgRating: number | null = null;
  let ratingCount = 0;
  const orderStatus = { pending: 0, paid: 0, confirmed: 0, completed: 0, cancelled: 0, refunded: 0 };

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(DISTINCT s.user_id)
            FROM api_session s
           WHERE s.is_revoked = 0 AND s.expires_at > UTC_TIMESTAMP()) AS online_users,
         (SELECT COUNT(*)
            FROM tour_order o
           WHERE DATE(o.created_at) = UTC_DATE()) AS today_orders,
         (SELECT COUNT(*)
            FROM im_message m
           WHERE DATE(m.created_at) = UTC_DATE()) AS today_messages,
         (SELECT COUNT(*)
            FROM tour_order o
           WHERE o.created_at >= UTC_TIMESTAMP(3) - INTERVAL ? SECOND) AS recent_orders,
         (SELECT COALESCE(SUM(o.total_amount), 0)
            FROM tour_order o
           WHERE o.status IN ('PAID', 'COMPLETED') AND DATE(o.created_at) = UTC_DATE()) AS gmv_today,
         (SELECT COUNT(*) FROM im_conversation c
           WHERE c.status = 'ACTIVE' AND c.assignee_id IS NULL) AS conv_pending,
         (SELECT COUNT(*) FROM im_conversation c
           WHERE c.status = 'ACTIVE' AND c.assignee_id IS NOT NULL) AS conv_serving,
         (SELECT COUNT(*) FROM im_conversation c
           WHERE DATE(c.created_at) = UTC_DATE()) AS conv_today,
         (SELECT ROUND(AVG(r.score), 2) FROM im_rating r) AS avg_rating,
         (SELECT COUNT(*) FROM im_rating r) AS rating_count,
         (SELECT COUNT(*) FROM tour_order o WHERE o.status = 'PENDING')   AS ord_pending,
         (SELECT COUNT(*) FROM tour_order o WHERE o.status = 'PAID')      AS ord_paid,
         (SELECT COUNT(*) FROM tour_order o WHERE o.status = 'CONFIRMED') AS ord_confirmed,
         (SELECT COUNT(*) FROM tour_order o WHERE o.status = 'COMPLETED') AS ord_completed,
         (SELECT COUNT(*) FROM tour_order o WHERE o.status = 'CANCELLED') AS ord_cancelled,
         (SELECT COUNT(*) FROM tour_order o WHERE o.status = 'REFUNDED')  AS ord_refunded`,
      [QPS_WINDOW_SECONDS]
    );
    const row = rows[0] ?? {};
    onlineUsersFallback = Number(row.online_users ?? 0);
    todayOrders = Number(row.today_orders ?? 0);
    todayMessages = Number(row.today_messages ?? 0);
    recentOrders = Number(row.recent_orders ?? 0);
    gmvToday = Number(row.gmv_today ?? 0);
    convPending = Number(row.conv_pending ?? 0);
    convServing = Number(row.conv_serving ?? 0);
    convToday = Number(row.conv_today ?? 0);
    avgRating = row.avg_rating === null || row.avg_rating === undefined ? null : Number(row.avg_rating);
    ratingCount = Number(row.rating_count ?? 0);
    orderStatus.pending = Number(row.ord_pending ?? 0);
    orderStatus.paid = Number(row.ord_paid ?? 0);
    orderStatus.confirmed = Number(row.ord_confirmed ?? 0);
    orderStatus.completed = Number(row.ord_completed ?? 0);
    orderStatus.cancelled = Number(row.ord_cancelled ?? 0);
    orderStatus.refunded = Number(row.ord_refunded ?? 0);
  } catch (error: any) {
    degraded.push('mysql');
    logEvent('stats.live.db_failed', { message: error?.message ?? String(error) });
  }

  // 最近 24 小时逐小时消息量（hours_ago: 0=本小时 .. 23=24 小时前；旧→新输出）
  const hourlyMessages = new Array<number>(24).fill(0);
  try {
    const [hourlyRows] = await pool.query<RowDataPacket[]>(
      `SELECT FLOOR(TIMESTAMPDIFF(HOUR, m.created_at, UTC_TIMESTAMP())) AS hours_ago, COUNT(*) AS c
         FROM im_message m
        WHERE m.created_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR
        GROUP BY hours_ago`
    );
    for (const r of hourlyRows) {
      const ago = Number(r.hours_ago);
      if (Number.isFinite(ago) && ago >= 0 && ago <= 23) hourlyMessages[23 - ago] = Number(r.c);
    }
  } catch (error: any) {
    degraded.push('hourly_messages');
    logEvent('stats.live.hourly_failed', { message: error?.message ?? String(error) });
  }

  // 最新 5 条订单（跑马灯）
  let recentOrderList: LiveSnapshot['recent_orders'] = [];
  try {
    const [orderRows] = await pool.query<RowDataPacket[]>(
      `SELECT o.order_no, COALESCE(p.title, '自由行定制') AS title,
              o.total_amount, o.status, o.created_at
         FROM tour_order o
         LEFT JOIN travel_product p ON p.id = o.product_id
        ORDER BY o.id DESC
        LIMIT 5`
    );
    recentOrderList = orderRows.map((r) => ({
      order_no: String(r.order_no),
      title: String(r.title),
      amount: Number(r.total_amount),
      status: String(r.status),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
    }));
  } catch (error: any) {
    degraded.push('recent_orders');
    logEvent('stats.live.recent_orders_failed', { message: error?.message ?? String(error) });
  }

  // MQ 消费积压（stream 长度 / PEL / 死信）。拿不到不算致命，标 degraded 即可
  let mq: LiveSnapshot['mq'] = { backlog: null, pending: null, dlq: null, redis: 'unavailable' };
  try {
    const queue = await getQueueStats();
    mq = { backlog: queue.streamLength, pending: queue.pending, dlq: queue.dlqLength, redis: queue.redis };
    if (queue.redis !== 'ok') degraded.push('mq');
  } catch (error: any) {
    degraded.push('mq');
    logEvent('stats.live.mq_failed', { message: error?.message ?? String(error) });
  }

  if (presenceCount === null) degraded.push('online_count');
  if (connGauge === null) degraded.push('online_conn');
  if (msgCounter === null) degraded.push('message_count');

  return {
    // WS 在线人数拿不到时，退回"有效会话数"口径（口径不同，标记在 degraded 里）
    online_count: presenceCount ?? onlineUsersFallback,
    // 连接数拿不到时用进程内视角（单实例部署下等价）
    online_conn: connGauge ?? hub.connectionCount(),
    today_order_count: todayOrders,
    message_count: msgCounter ?? todayMessages,
    seckill_qps: Math.round((recentOrders / QPS_WINDOW_SECONDS) * 100) / 100,
    ts: Date.now(),
    degraded,
    gmv_today: gmvToday,
    agent: {
      pending: convPending,
      serving: convServing,
      today_conversations: convToday,
      avg_rating: avgRating,
      rating_count: ratingCount
    },
    order_status: orderStatus,
    hourly_messages: hourlyMessages,
    recent_orders: recentOrderList,
    mq
  };
}

statsRouter.get('/stats/live', requireAction('analytics:live', 'query'), run(async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Nginx 反代时必须关缓冲，否则 SSE 会被攒成一坨再吐
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);
  res.flushHeaders?.();

  // 首行注释 + retry：让浏览器的 EventSource 断线 3s 后自己重连
  res.write(': connected\n');
  res.write(`retry: 3000\n\n`);

  let sequence = 0;
  let closed = false;

  const push = async (): Promise<void> => {
    if (closed || res.writableEnded) return;
    try {
      const snapshot = await collectSnapshot();
      if (closed || res.writableEnded) return;
      sequence += 1;
      res.write(`id: ${sequence}\n`);
      res.write('event: stats\n');
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    } catch (error: any) {
      // 单次失败不断流：推一条 error 事件，下一拍继续
      logEvent('stats.live.push_failed', { message: error?.message ?? String(error) });
      if (!closed && !res.writableEnded) {
        res.write('event: error\n');
        res.write(`data: ${JSON.stringify({ message: '统计采集失败，稍后重试' })}\n\n`);
      }
    }
  };

  void push();
  const timer = setInterval(() => void push(), INTERVAL_MS);
  timer.unref?.();

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}));
