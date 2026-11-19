/**
 * 库存预热（组员3 · 阶段二；阶段六加固）
 *
 * 把 route_stock.seckill_total_seats - seckill_sold_seats 刷进 Redis：
 *   stock:{routeId}:{date}  =  剩余可秒杀名额
 *
 * Lua 脚本（deduct_stock.lua）直接读这个 key 做原子扣减。
 * 不预热 = key 不存在 = Lua 返回 not_warmed = 一律抢不到。
 *
 * 阶段六修复：
 * ① **惰性预热**：原来只在进程启动时预热一次，Redis 重启 / 被清空 / 新加场次之后，
 *    所有秒杀都会变成"售罄"且没人知道原因。现在 seckillRouter 发现 key 不存在会调
 *    warmUpStock() 回填后重试。
 * ② **对账重刷**：reconcileSeckillStock() 以 MySQL 为真相，把 Redis 里漂移的剩余数纠正回来
 *    （只在队列完全空闲时执行，见 server.ts 的定时任务）。
 * ③ **TTL 兜底**：key 的过期时间 = 活动结束 + 1 天，正常情况下不会失效，
 *    但也不会永久占内存。
 */
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { getRedis, isRedisReady, redisKey } from '../db/redis.js';

const stockKeyOf = (routeId: number | string, date: string) => `stock:${routeId}:${date}`;

/** 活动日期 → key 的存活时间（秒）：活动结束后再留 1 天 */
function ttlForDate(date: string): number {
  const end = new Date(`${date}T23:59:59Z`).getTime();
  return Math.max(3600, Math.ceil((end - Date.now()) / 1000) + 86400);
}

/** 预热单条：指定路线 + 日期。返回 false 表示没有这行库存记录 / Redis 不可用 */
export async function warmUpStock(routeId: number | string, date: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT seckill_total_seats, seckill_sold_seats FROM route_stock
     WHERE route_id = ? AND travel_date = ?`,
    [routeId, date]
  );
  if (!rows.length) {
    console.log(JSON.stringify({ event: 'seckill.warmup.skip', routeId, date, reason: 'no_stock_row' }));
    return false;
  }
  const total = Number(rows[0].seckill_total_seats);
  const sold = Number(rows[0].seckill_sold_seats);
  const available = Math.max(0, total - sold);

  const redis = getRedis();
  if (!redis || !isRedisReady()) {
    console.log(JSON.stringify({ event: 'seckill.warmup.no_redis', routeId, date }));
    return false;
  }
  const ttlSeconds = ttlForDate(date);
  await redis.set(redisKey(stockKeyOf(routeId, date)), String(available), 'EX', ttlSeconds);
  console.log(JSON.stringify({ event: 'seckill.warmup.ok', routeId, date, available, ttlSeconds }));
  return true;
}

/** 启动时预热所有有秒杀名额的路线 */
export async function warmUpAllSeckillStock(): Promise<void> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT route_id, travel_date FROM route_stock WHERE seckill_total_seats > 0'
    );
    for (const row of rows) {
      const dateStr = new Date(row.travel_date as string).toISOString().slice(0, 10);
      await warmUpStock(Number(row.route_id), dateStr);
    }
    console.log(JSON.stringify({ event: 'seckill.warmup.all_done', count: rows.length }));
  } catch (error: any) {
    console.log(JSON.stringify({ event: 'seckill.warmup.all_failed', message: error?.message }));
  }
}

/**
 * 对账：以 MySQL 为真相，重刷所有秒杀库存 key。
 *
 * 为什么需要它：Redis 预扣成功但落库失败（死信、进程崩溃）时，Redis 的剩余数会比 DB 小；
 * 反之如果 Redis 被清空/淘汰，又会比 DB 大。长时间跑下来两者必然漂移。
 *
 * 调用约束（见 server.ts）：只在 pending === 0 且 Stream 空时执行，
 * 否则"在途消息"还要再扣一次，重刷会把它们要扣的量补回来，造成超卖。
 */
export async function reconcileSeckillStock(): Promise<{ checked: number; refreshed: number }> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return { checked: 0, refreshed: 0 };

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT route_id, travel_date, seckill_total_seats, seckill_sold_seats
       FROM route_stock WHERE seckill_total_seats > 0`
  );

  let refreshed = 0;
  for (const row of rows) {
    const dateStr = new Date(row.travel_date as string).toISOString().slice(0, 10);
    const key = redisKey(stockKeyOf(Number(row.route_id), dateStr));
    const dbAvailable = Math.max(0, Number(row.seckill_total_seats) - Number(row.seckill_sold_seats));
    const current = await redis.get(key);
    if (current !== null && Number(current) === dbAvailable) continue;
    await redis.set(key, String(dbAvailable), 'EX', ttlForDate(dateStr));
    refreshed += 1;
    console.log(JSON.stringify({
      event: 'seckill.reconcile.fix',
      routeId: row.route_id,
      date: dateStr,
      redisWas: current,
      dbIs: dbAvailable
    }));
  }
  return { checked: rows.length, refreshed };
}
