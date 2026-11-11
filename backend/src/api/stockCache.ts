/**
 * 库存预热（组员3 · 阶段二）
 *
 * 把 route_stock.seckill_total_seats - seckill_sold_seats 刷进 Redis：
 *   stock:{routeId}:{date}  =  剩余可秒杀名额
 *
 * Lua 脚本（组员1写的 deduct_stock.lua）直接读这个 key 做原子扣减。
 * 不预热 = key 不存在 = Lua 返回 0 = 一律 sold_out。
 */
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { getRedis, redisKey } from '../db/redis.js';

/** 预热单条：指定路线 + 日期 */
export async function warmUpStock(routeId: number, date: string): Promise<boolean> {
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
  if (!redis) {
    console.log(JSON.stringify({ event: 'seckill.warmup.no_redis', routeId, date }));
    return false;
  }
  // TTL 设到活动日期之后一天，防止 key 永不过期
  const ttlSeconds = Math.max(60, Math.floor((new Date(date).getTime() - Date.now()) / 1000) + 86400);
  await redis.set(redisKey(`stock:${routeId}:${date}`), String(available), 'EX', ttlSeconds);
  console.log(JSON.stringify({ event: 'seckill.warmup.ok', routeId, date, available, ttlSeconds }));
  return true;
}

/** 启动时预热所有有秒杀名额的路线 */
export async function warmUpAllSeckillStock(): Promise<void> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT route_id, travel_date FROM route_stock WHERE seckill_total_seats > 0`
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
