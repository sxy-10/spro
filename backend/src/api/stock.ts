import { z } from 'zod';
import { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { ApiError } from './core.js';

export const travelDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  value => !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value);

export async function lockSeats(conn: PoolConnection, routeId: string, date: string, people: number) {
  // Conditional UPDATE takes an InnoDB row lock and rechecks the condition after waiting.
  const [result] = await conn.query<ResultSetHeader>(`UPDATE route_stock SET locked_seats=locked_seats+?
    WHERE route_id=? AND travel_date=? AND total_seats-locked_seats-sold_seats>=?`, [people,routeId,date,people]);
  if (result.affectedRows !== 1) throw new ApiError(409,20010,'该日期余位不足');
}

export async function releaseSeats(conn: PoolConnection, order: RowDataPacket, sold = false) {
  if (!order.is_stock_locked) return; // Historical orders never acquired inventory.
  const [result] = await conn.query<ResultSetHeader>(`UPDATE route_stock
    SET locked_seats=locked_seats-?,sold_seats=sold_seats+?
    WHERE route_id=? AND travel_date=? AND locked_seats>=?`,
    [order.traveler_count,sold ? order.traveler_count : 0,order.product_id,order.travel_date,order.traveler_count]);
  if (result.affectedRows !== 1) throw new Error('Stock invariant violation');
}

// Internal entry point for a verified payment provider callback; never trust a client "paid" flag.
export async function settlePaidOrder(orderId: string): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT *,expires_at<=UTC_TIMESTAMP() AS is_expired
      FROM tour_order WHERE id=? FOR UPDATE`,[orderId]);
    const order=rows[0];
    if (!order) throw new ApiError(404,20012,'订单不存在');
    if (order.status === 'PAID') { await conn.commit(); return; }
    if (order.status !== 'PENDING' || !order.is_stock_locked || order.is_expired) throw new ApiError(409,20011,'订单当前状态不允许支付');
    await releaseSeats(conn,order,true);
    await conn.query(`UPDATE tour_order SET status='PAID',paid_at=UTC_TIMESTAMP(),is_stock_locked=0 WHERE id=?`,[orderId]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

export async function expireUnpaidOrders(): Promise<void> {
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Bounded batches; SKIP LOCKED lets multiple server instances run safely.
    const [rows]=await conn.query<RowDataPacket[]>(`SELECT * FROM tour_order
      WHERE status='PENDING' AND is_stock_locked=1 AND expires_at<=UTC_TIMESTAMP()
      ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`);
    for (const order of rows) {
      await releaseSeats(conn,order);
      await conn.query(`UPDATE tour_order SET status='CANCELLED',cancelled_at=UTC_TIMESTAMP(),is_stock_locked=0 WHERE id=?`,[order.id]);
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

export function startStockExpiryJob() {
  let running=false;
  const tick=async()=>{
    if(running) return;
    running=true;
    try { await expireUnpaidOrders(); }
    catch { console.error(JSON.stringify({code:'STOCK_EXPIRY_FAILED'})); }
    finally {running=false;}
  };
  void tick();
  const timer=setInterval(()=>void tick(),10000);
  timer.unref();
  return ()=>clearInterval(timer);
}
