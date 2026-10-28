import { randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';

export class ApiError extends Error {
  constructor(public status: number, public code: number, message: string) { super(message); }
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  return value;
};
export function serialize(value: any, key = ''): any {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => serialize(item));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => {
    const name = k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    return [name, serialize(v, name)];
  }));
  if (/(^id$|_id$)/.test(key)) return String(value);
  if (/(rmb$|^amount$|total_amount$)/.test(key)) return typeof value === 'number' ? value.toFixed(2) : value;
  if (/^(is_|has_)/.test(key)) return Boolean(value);
  return value;
}
export function reply(res: Response, data: unknown, status = 200) {
  res.status(status).json({ code: 0, message: 'ok', data: serialize(data), trace_id: res.locals.traceId });
}
export const run = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => { Promise.resolve(fn(req, res)).catch(next); };
export const id = z.string().regex(/^[1-9]\d{0,19}$/);
export const mobile = z.string().regex(/^1\d{10}$/);
export const utc = z.string().datetime({ offset: false });
export const money = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).refine(v => Number(v) > 0);
export const maskMobile = (value: string | null) => value?.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2') ?? null;
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    await verifyUser(req, res);
    next();
  } catch (error) { next(error); }
}
async function verifyUser(req: Request, res: Response) {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new ApiError(401, 20013, '请先登录');
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: 'travel-agent', audience: 'travel-client' }) as jwt.JwtPayload; }
  catch { throw new ApiError(401, 20013, '登录已失效'); }
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT u.id,u.role,u.agency_id FROM api_session s JOIN sys_user u ON u.id=s.user_id
    WHERE s.session_id=? AND s.user_id=? AND s.is_revoked=0 AND s.expires_at>UTC_TIMESTAMP() AND u.status='ACTIVE'`, [payload.jti, payload.sub]);
  if (!rows.length) throw new ApiError(401, 20013, '登录已失效');
  res.locals.user = rows[0]; res.locals.sessionId = payload.jti;
}
export function page(query: unknown, sorts: string[], filters: Record<string, z.ZodType> = {}) {
  const schema = z.object({ page: z.coerce.number().int().min(1).max(100).default(1), size: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.string().refine(v => sorts.includes(v.replace(/^-/, ''))).default('-created_at'), ...filters }).strict();
  return schema.parse(query) as {page: number; size: number; sort: string; [key: string]: any};
}
export async function list(conn: typeof pool | PoolConnection, select: string, count: string, params: any[], p: ReturnType<typeof page>) {
  // select and count are server-owned SQL, and sort is checked against each endpoint's whitelist.
  const field = p.sort.replace(/^-/, '');
  const [rows] = await conn.query<RowDataPacket[]>(`${select} ORDER BY ${field} ${p.sort.startsWith('-') ? 'DESC' : 'ASC'}, id DESC LIMIT ? OFFSET ?`, [...params, p.size, (p.page - 1) * p.size]);
  const [totals] = await conn.query<RowDataPacket[]>(count, params);
  const total = Number(totals[0].total);
  return { list: rows, total, has_more: p.page * p.size < total };
}
export async function rateLimit(key: string, limit: number) {
  const bucket = hash(`${key}:${Math.floor(Date.now() / 60000)}`);
  await pool.query(`INSERT INTO api_rate_limit(bucket_hash,hits,expires_at) VALUES (?,1,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MINUTE)) ON DUPLICATE KEY UPDATE hits=hits+1`, [bucket]);
  const [rows] = await pool.query<RowDataPacket[]>('SELECT hits FROM api_rate_limit WHERE bucket_hash=?', [bucket]);
  if (rows[0].hits > limit) throw new ApiError(429, 20014, '请求过于频繁，请稍后重试');
}
export async function write(req: Request, res: Response, action: (conn: PoolConnection) => Promise<{data: unknown; status?: number}>, important = true) {
  const key = z.string().min(8).max(128).parse(req.get('Idempotency-Key'));
  const scope = hash(`${res.locals.user?.id ?? req.ip}:${req.method}:${req.path}:${key}`);
  const fingerprint = hash(`${JSON.stringify(req.body)}:${res.locals.sessionId ?? ''}`);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO api_idempotency(scope_hash,request_hash) VALUES (?,?)', [scope, fingerprint]);
    const [rows] = await conn.query<RowDataPacket[]>('SELECT * FROM api_idempotency WHERE scope_hash=? FOR UPDATE', [scope]);
    if (rows[0].request_hash !== fingerprint) throw new ApiError(409, 20015, '幂等键已用于其他请求');
    if (rows[0].response_status) {
      await conn.commit();
      reply(res, typeof rows[0].response_data === 'string' ? JSON.parse(rows[0].response_data) : rows[0].response_data, rows[0].response_status); return;
    }
    if (important) {
      const timestamp = utc.parse(req.get('X-Timestamp'));
      const nonce = z.string().regex(/^[A-Za-z0-9-]{16,128}$/).parse(req.get('X-Nonce'));
      if (Math.abs(Date.now() - Date.parse(timestamp)) > 300000) throw new ApiError(409, 20016, '请求已过期');
      const signature = z.string().regex(/^[a-f0-9]{64}$/).parse(req.get('X-Signature'));
      const token = req.headers.authorization!.slice(7);
      const expected = createHmac('sha256', token).update(`${req.method}\n${req.originalUrl}\n${timestamp}\n${nonce}\n${hash(JSON.stringify(req.body))}`).digest('hex');
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ApiError(403, 20013, '请求签名无效');
      try { await conn.query('INSERT INTO api_nonce(nonce_hash,expires_at) VALUES (?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))', [hash(`${res.locals.user.id}:${nonce}`)]); }
      catch (error: any) { if (error.code === 'ER_DUP_ENTRY') throw new ApiError(409, 20016, '请求已被使用'); throw error; }
    }
    const result = await action(conn);
    await conn.query('UPDATE api_idempotency SET response_status=?,response_data=? WHERE scope_hash=?', [result.status ?? 200, JSON.stringify(serialize(result.data)), scope]);
    await conn.commit(); reply(res, result.data, result.status ?? 200);
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
export function errors(error: any, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  const known = error instanceof ApiError;
  const invalid = error instanceof z.ZodError || error.type === 'entity.parse.failed' || error.type === 'entity.too.large';
  const duplicate = error.code === 'ER_DUP_ENTRY';
  const status = known ? error.status : invalid ? 400 : duplicate ? 409 : 500;
  if (status === 429) res.setHeader('Retry-After', '60');
  if (status >= 500) console.error(JSON.stringify({ trace_id: res.locals.traceId, code: 'INTERNAL_ERROR' }));
  res.status(status).json({ code: known ? error.code : invalid ? 10001 : duplicate ? 20015 : 50000,
    message: known ? error.message : invalid ? '参数为空、格式错误或超出允许范围' : duplicate ? '资源已存在' : '服务器内部错误，请稍后重试', data: null, trace_id: res.locals.traceId ?? randomUUID() });
}
