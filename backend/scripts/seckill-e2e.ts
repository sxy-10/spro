/**
 * 秒杀全链路 E2E 验收脚本（阶段六新增）
 *
 * 覆盖链路：登录态 → POST /v1/seckill → Redis Lua 预扣 → Stream → 消费者落库
 *          → 轮询结果 → MySQL 订单与库存核对 → 幂等 / 互斥锁
 *
 * 用法（先 `npm run build && node dist/server.js` 或 `npm run dev` 起服务）：
 *   npx tsx scripts/seckill-e2e.ts                 # 自动建场次、跑完清理
 *   npx tsx scripts/seckill-e2e.ts --keep          # 保留测试数据便于手工核对
 *   set E2E_BASE=http://127.0.0.1:3001              # 指定服务地址
 *
 * 为什么不复用演示场次（2026-12-01）：验收脚本要能反复跑，
 * 所以自己插入一条 route_stock 临时场次，跑完删掉，绝不动老师的演示数据。
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../src/db/connection.js';
import { getRedis, redisKey, waitForRedis } from '../src/db/redis.js';
import { warmUpStock } from '../src/api/stockCache.js';

const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
const ROUTE_ID = Number(process.env.E2E_ROUTE ?? 1);
const DATE = process.env.E2E_DATE ?? '2026-12-02';
const PEOPLE = Number(process.env.E2E_PEOPLE ?? 1);
const SEATS = 3;
const KEEP = process.argv.includes('--keep');
const E2E_USER_ID = Number(process.env.E2E_USER_ID ?? 2);

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  console.error('JWT_SECRET 缺失或不足 32 位，无法签发测试 token');
  process.exit(1);
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name} —— ${detail}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as any) } });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, headers: response.headers };
}

/** 建一条临时场次（已存在则复用），并把剩余名额预热进 Redis */
async function setupCampaign() {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const end = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    `INSERT INTO route_stock (route_id, travel_date, total_seats, locked_seats, sold_seats, version,
                              seckill_total_seats, seckill_sold_seats, seckill_start_at, seckill_end_at)
     VALUES (?, ?, 50, 0, 0, 0, ?, 0, ?, ?)
     ON DUPLICATE KEY UPDATE seckill_total_seats = VALUES(seckill_total_seats),
                             seckill_sold_seats = 0, version = 0,
                             seckill_start_at = VALUES(seckill_start_at),
                             seckill_end_at = VALUES(seckill_end_at)`,
    [ROUTE_ID, DATE, SEATS, start, end]
  );
  const warmed = await warmUpStock(ROUTE_ID, DATE);
  record('准备临时秒杀场次', warmed, `route=${ROUTE_ID} date=${DATE} 名额=${SEATS} 预热=${warmed}`);
}

/** 直接写一条 api_session，绕过演示账号密码（不改任何用户数据） */
async function setupSession(): Promise<{ token: string; sessionId: string }> {
  const sessionId = randomUUID();
  await pool.query(
    'INSERT INTO api_session (session_id, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY))',
    [sessionId, E2E_USER_ID]
  );
  const token = jwt.sign({}, secret as string, {
    algorithm: 'HS256',
    subject: String(E2E_USER_ID),
    jwtid: sessionId,
    expiresIn: '10m',
    issuer: 'travel-agent',
    audience: 'travel-client'
  });
  return { token, sessionId };
}

async function main() {
  // 脚本自己的 Redis 连接是懒加载的，预热前先等它 ready，否则 warmUpStock 会以为 Redis 不可用
  await waitForRedis(5000);
  await setupCampaign();
  const { token, sessionId } = await setupSession();

  // 1) 认证链路（Redis 缓存未命中 → 查库 → 回填缓存）
  const me = await api('/v1/users/me', { token });
  record('认证（authenticateJwt 快路径）', me.status === 200, `GET /v1/users/me -> ${me.status}`);

  // 2) 抢购
  const idempotencyKey = randomUUID();
  const first = await api(`/v1/seckill/${ROUTE_ID}`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ date: DATE, people: PEOPLE })
  });
  record('POST /v1/seckill 返回排队中', first.status === 202 && first.body?.data?.status === 'queued',
    `status=${first.status} body=${JSON.stringify(first.body?.data)}`);

  const reqId = first.body?.data?.req_id as string | undefined;

  // 3) 同一 Idempotency-Key 重放：必须落到同一个 reqId（不重复扣库存）
  const replay = await api(`/v1/seckill/${ROUTE_ID}`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ date: DATE, people: PEOPLE })
  });
  const replayReqId = replay.body?.data?.req_id;
  record('幂等重放命中同一 reqId', Boolean(reqId) && replayReqId === reqId,
    `首次=${reqId} 重放=${replayReqId ?? replay.body?.status}`);

  // 4) 换一个 Idempotency-Key 立刻再点：应被 10 秒互斥锁挡住
  const second = await api(`/v1/seckill/${ROUTE_ID}`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ date: DATE, people: PEOPLE })
  });
  record('同人连点被互斥锁拦截', second.status === 409 && second.body?.code === 20015,
    `status=${second.status} code=${second.body?.code} message=${second.body?.message}`);

  // 5) 轮询结果（消费者 1 秒内应该处理完）
  let result: any = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const poll = await api(`/v1/seckill/result/${reqId}`, { token });
    result = poll.body?.data;
    if (result && result.status !== 'pending') break;
    await sleep(500);
  }
  record('轮询拿到最终结果', result?.status === 'success', `result=${JSON.stringify(result)}`);

  // 6) 数据库核对：订单存在、库存已扣
  const [orders] = await pool.query<RowDataPacket[]>('SELECT id, order_no, status FROM tour_order WHERE req_id = ?', [reqId]);
  const [stock] = await pool.query<RowDataPacket[]>(
    'SELECT seckill_sold_seats, version FROM route_stock WHERE route_id = ? AND travel_date = ?', [ROUTE_ID, DATE]);
  record('消费者落库成功（tour_order.req_id）', orders.length === 1,
    `订单号=${orders[0]?.order_no ?? '-'} 状态=${orders[0]?.status ?? '-'}`);
  record('MySQL 库存扣减正确', Number(stock[0]?.seckill_sold_seats) === PEOPLE,
    `seckill_sold_seats=${stock[0]?.seckill_sold_seats} version=${stock[0]?.version}`);

  // 7) Redis 预扣结果与 MySQL 一致
  const redis = getRedis();
  const left = await redis?.get(redisKey(`stock:${ROUTE_ID}:${DATE}`));
  record('Redis 剩余名额 = DB 剩余', Number(left) === SEATS - PEOPLE,
    `Redis=${left} 期望=${SEATS - PEOPLE}`);

  if (!KEEP) await cleanup(sessionId, reqId);
  else console.log('\n--keep：测试数据已保留，请手工清理 route_stock / tour_order / api_session');

  const failed = results.filter((item) => !item.ok);
  console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length} 项`);
  if (failed.length) process.exitCode = 1;
}

/** 清理：只删本次脚本造的数据，不碰演示数据 */
async function cleanup(sessionId: string, reqId?: string) {
  const redis = getRedis();
  if (reqId) {
    await pool.query('DELETE FROM tour_order WHERE req_id = ?', [reqId]);
    await redis?.del(redisKey(`seckill:result:${reqId}`));
  }
  await pool.query('DELETE FROM route_stock WHERE route_id = ? AND travel_date = ?', [ROUTE_ID, DATE]);
  await redis?.del(redisKey(`stock:${ROUTE_ID}:${DATE}`));
  await redis?.del(redisKey(`lock:seckill:${E2E_USER_ID}:${ROUTE_ID}:${DATE}`));
  // 只删本次插入的测试会话（按 session_id，精确）
  await pool.query('DELETE FROM api_session WHERE session_id = ?', [sessionId]);
  await redis?.del(redisKey(`auth:user:${E2E_USER_ID}:sessions`));
  console.log('已清理本次 E2E 产生的数据');
}

main()
  .catch((error) => {
    console.error('E2E 失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); getRedis()?.disconnect(); } catch { /* 忽略 */ }
    setTimeout(() => process.exit(process.exitCode ?? 0), 300);
  });
