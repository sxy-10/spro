import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { TravelPlannerAgent } from '../agent/planner.js';
import { generateUlid } from '../db/repository.js';
import { travelDate, lockSeats, releaseSeats } from './stock.js';
import { ApiError, id, mobile, utc, money, reply, run, page, list, write, secret, maskMobile, rateLimit, serialize } from './core.js';
import { authenticateJwt } from '../auth/passport.js';
import { requirePermission } from '../auth/rbac.js';
import { rbac } from './rbacRouter.js';
import { hashPassword, verifyPasswordConstantTime, checkLoginLockout, recordLoginFailure, clearLoginLockout } from '../auth/security.js';

export const api = Router();
const planner = new TravelPlannerAgent();
const credentials = z.object({ mobile, password: z.string().min(8).max(72) }).strict();
const userFields = 'id AS user_id,nickname,phone,avatar_url,role,default_departure_city,created_at';
const routeFields = 'id,id AS route_id,product_no,title,destination,default_days,style_tag,base_price_rmb,cover_image_url,status,is_active,created_at';
const planFields = 'id,itinerary_no AS plan_id,title,status,version,days_count,start_date,end_date,total_budget_rmb,is_estimated,created_at';
const orderFields = `id,id AS order_id,product_id AS route_id,travel_date,traveler_count AS people_count,total_amount AS amount,
  CASE status WHEN 'PENDING' THEN 'CREATED' WHEN 'CANCELLED' THEN 'CANCELED' ELSE status END AS status,created_at`;
const text = (max: number) => z.string().trim().min(1).max(max);

api.use((req, _res, next) => { rateLimit(`ip:${req.ip}`, 120).then(() => next(), next); });

api.post('/auth/register', run(async (req, res) => {
  const body = credentials.parse(req.body);
  await rateLimit(`auth:${req.ip}`, 10);
  const passwordHash = await hashPassword(body.password);
  await write(req, res, async conn => {
    await conn.query('INSERT INTO sys_user(username,phone,password_hash) VALUES (?,?,?)', [body.mobile, body.mobile, passwordHash]);
    const [rows] = await conn.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) AS user_id FROM sys_user WHERE phone=?', [body.mobile]);
    return { data: rows[0], status: 201 };
  }, false);
}));
api.post('/auth/login', run(async (req, res) => {
  const body = credentials.parse(req.body);
  await rateLimit(`auth:${req.ip}`, 10);
  await checkLoginLockout(body.mobile);
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id,password_hash FROM sys_user WHERE phone=? AND status=\'ACTIVE\'', [body.mobile]);
  const valid = await verifyPasswordConstantTime(body.password, rows[0]?.password_hash);
  if (!rows.length || !valid) {
    await recordLoginFailure(body.mobile);
    // 契约：/auth/login 400 → 10001「手机号或密码错误」（不能用 401/20012，那是"未登录"的语义）
    throw new ApiError(400, 10001, '手机号或密码错误');
  }
  await clearLoginLockout(body.mobile);
  const userId = String(rows[0].id), sessionId = randomUUID();
  const token = jwt.sign({}, secret(), { algorithm: 'HS256', subject: userId, jwtid: sessionId, expiresIn: '30m', issuer: 'travel-agent', audience: 'travel-client' });
  await write(req, res, async conn => {
    await conn.query('INSERT INTO api_session(session_id,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))', [sessionId, userId]);
    await conn.query('UPDATE sys_user SET last_login_at=UTC_TIMESTAMP() WHERE id=?', [userId]);
    return { data: { token, user_id: userId } };
  }, false);
}));

// 手机号短信登录
api.post('/auth/login/sms', run(async (req, res) => {
    const body = z.object({ mobile, sms_code: z.string().length(6) }).strict().parse(req.body);
    await rateLimit(`auth:${req.ip}`, 10);
    await checkLoginLockout(body.mobile);

    // TODO: 对接真实短信服务后，替换为从 Redis/数据库校验真实验证码
    // 当前开发环境：验证码统一为 123456
    if (body.sms_code !== '123456') {
        await recordLoginFailure(body.mobile);
        throw new ApiError(400, 10001, '验证码错误或已过期');
    }

    const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM sys_user WHERE phone=? AND status=\'ACTIVE\'', [body.mobile]);
    if (!rows.length) {
        await recordLoginFailure(body.mobile);
        throw new ApiError(400, 10001, '该手机号尚未注册，请先注册');
    }

    await clearLoginLockout(body.mobile);
    const userId = String(rows[0].id), sessionId = randomUUID();
    const token = jwt.sign({}, secret(), { algorithm: 'HS256', subject: userId, jwtid: sessionId, expiresIn: '30m', issuer: 'travel-agent', audience: 'travel-client' });

    await write(req, res, async conn => {
        await conn.query('INSERT INTO api_session(session_id,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))', [sessionId, userId]);
        await conn.query('UPDATE sys_user SET last_login_at=UTC_TIMESTAMP() WHERE id=?', [userId]);
        return { data: { token, user_id: userId } };
    }, false);
}));

// 重置密码（防枚举：不暴露用户是否存在）
api.post('/auth/reset-password', run(async (req, res) => {
    const body = z.object({ mobile, sms_code: z.string().length(6), new_password: z.string().min(8).max(72) }).strict().parse(req.body);
    await rateLimit(`auth:${req.ip}`, 10);

    // TODO: 对接真实短信服务后，替换为从 Redis/数据库校验真实验证码
    // 当前开发环境：验证码统一为 123456
    if (body.sms_code !== '123456') {
        throw new ApiError(400, 10001, '验证码错误或已过期');
    }

    // 防枚举：查询用户，无论是否存在都返回成功
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM sys_user WHERE phone=?', [body.mobile]);

    if (rows.length > 0) {
        const newPasswordHash = await hashPassword(body.new_password);
        await write(req, res, async conn => {
            await conn.query('UPDATE sys_user SET password_hash=? WHERE id=?', [newPasswordHash, rows[0].id]);
            // 重置密码后，作废该用户所有现有登录会话
            await conn.query('UPDATE api_session SET is_revoked=1 WHERE user_id=?', [rows[0].id]);
            return { data: null };
        }, false);
    } else {
        // 用户不存在：假装成功，延迟保持响应时间一致，防止通过响应时间枚举用户
        await new Promise(r => setTimeout(r, 120));
        reply(res, null);
    }
}));
// 获取图形验证码
api.get('/auth/captcha', run(async (_req, res) => {
    const svgCaptcha = require('svg-captcha');
    const captcha = svgCaptcha.create({
        size: 4,
        noise: 3,
        color: true,
        background: '#f0f0f0'
    });
    const captchaId = randomUUID();
    reply(res, {
        captcha_id: captchaId,
        captcha_image: captcha.data,
        dev_code: captcha.text.toLowerCase()
    });
}));

// 统一身份认证登录（账号+密码+图形验证码）
api.post('/auth/login/account', run(async (req, res) => {
    const body = z.object({
        account: z.string().min(4).max(64),
        password: z.string().min(8).max(72),
        captcha_code: z.string().min(4).max(6)
    }).strict().parse(req.body);

    await rateLimit(`auth:${req.ip}`, 10);

    // 开发环境：验证码统一为 aaaa
    if (body.captcha_code.toLowerCase() !== 'aaaa') {
        throw new ApiError(400, 10001, '图形验证码错误');
    }

    await checkLoginLockout(body.account);

    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, phone, password_hash FROM sys_user 
     WHERE (phone = ? OR username = ?) AND status = 'ACTIVE'`,
        [body.account, body.account]
    );

    const valid = await verifyPasswordConstantTime(body.password, rows[0]?.password_hash);
    if (!rows.length || !valid) {
        await recordLoginFailure(body.account);
        throw new ApiError(400, 10001, '账号或密码错误');
    }

    await clearLoginLockout(body.account);
    const userId = String(rows[0].id), sessionId = randomUUID();
    const token = jwt.sign({}, secret(), { algorithm: 'HS256', subject: userId, jwtid: sessionId, expiresIn: '30m', issuer: 'travel-agent', audience: 'travel-client' });

    await write(req, res, async conn => {
        await conn.query('INSERT INTO api_session(session_id,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))', [sessionId, userId]);
        await conn.query('UPDATE sys_user SET last_login_at=UTC_TIMESTAMP() WHERE id=?', [userId]);
        return { data: { token, user_id: userId, login_type: 'unified_account' } };
    }, false);
}));


api.get('/routes', run(async (req, res) => {
  const p = page(req.query, ['created_at','base_price_rmb','default_days'], { destination: text(100).optional() });
  const where = `FROM travel_product WHERE status='ON_SALE'${p.destination ? ' AND destination=?' : ''}`;
  reply(res, await list(pool, `SELECT ${routeFields} ${where}`, `SELECT COUNT(*) total ${where}`, p.destination ? [p.destination] : [], p));
}));
api.get('/routes/:id', run(async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${routeFields},description FROM travel_product WHERE id=? AND status='ON_SALE'`, [id.parse(req.params.id)]);
  if (!rows.length) throw new ApiError(404, 20016, '线路不存在');
  reply(res, rows[0]);
}));
api.get('/routes/:id/stock', run(async (req, res) => {
  const routeId=id.parse(req.params.id);
  const query=z.object({travel_date:travelDate}).strict().parse(req.query);
  res.setHeader('Cache-Control','no-store');
  const [routes]=await pool.query<RowDataPacket[]>(`SELECT id FROM travel_product WHERE id=? AND status='ON_SALE'`,[routeId]);
  if(!routes.length) throw new ApiError(404,20016,'线路不存在或已下架');
  const [rows]=await pool.query<RowDataPacket[]>(`SELECT total_seats,total_seats-locked_seats-sold_seats AS available_seats
    FROM route_stock WHERE route_id=? AND travel_date=?`,[routeId,query.travel_date]);
  const stock=rows[0] ?? {total_seats:0,available_seats:0};
  reply(res,{...stock,is_sellable:stock.available_seats>0});
}));
api.get('/spots', run(async (req, res) => {
  const p = page(req.query, ['created_at','name','rating'], { city_name: text(50).optional() });
  const where = `FROM poi WHERE poi_type='ATTRACTION' AND status='ACTIVE'${p.city_name ? ' AND city_name=?' : ''}`;
  reply(res, await list(pool, `SELECT id,id AS spot_id,name,city_name,address,rating,opening_hours,cover_image_url,created_at ${where}`, `SELECT COUNT(*) total ${where}`, p.city_name ? [p.city_name] : [], p));
}));

api.use(authenticateJwt);
api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); rateLimit(`user:${res.locals.user.id}`, 90).then(() => next(), next); });
// RBAC 管理接口（角色/权限/当前用户），见 api/rbacRouter.ts
api.use(rbac);
api.post('/auth/logout', run(async (req, res) => {
  await write(req, res, async conn => {
    await conn.query('UPDATE api_session SET is_revoked=1 WHERE session_id=?', [res.locals.sessionId]);
    return { data: null };
  });
}));
api.get('/users/:id', run(async (req, res) => {
  const userId = id.parse(req.params.id);
  if (userId !== String(res.locals.user.id)) throw new ApiError(403, 20013, '无权访问该用户');
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${userFields} FROM sys_user WHERE id=?`, [userId]);
  const {phone, ...user} = rows[0]; reply(res, { ...user, mobile: maskMobile(phone) });
}));
api.put('/users/:id', run(async (req, res) => {
  const userId = id.parse(req.params.id);
  if (userId !== String(res.locals.user.id)) throw new ApiError(403, 20013, '无权修改该用户');
  const body = z.object({ nickname: text(50), avatar_url: z.string().url().max(512).nullable(), default_departure_city: text(50).nullable() }).strict().parse(req.body);
  await write(req, res, async conn => {
    await conn.query('UPDATE sys_user SET nickname=?,avatar_url=?,default_departure_city=? WHERE id=?', [body.nickname,body.avatar_url,body.default_departure_city,userId]);
    return { data: { user_id: userId, ...body } };
  });
}));

const planInput = z.object({ destination: text(50), start_date: utc, end_date: utc,
  budget: z.string().regex(/^\d{1,9}(\.\d{1,2})?(-\d{1,9}(\.\d{1,2})?)?$/).optional(), tags: z.array(text(30)).max(20).optional(), prompt: text(2000).optional()
}).strict().superRefine((v, ctx) => {
  const days = (Date.parse(v.end_date) - Date.parse(v.start_date)) / 86400000;
  if (days < 0 || days >= 30 || !Number.isInteger(days)) ctx.addIssue({ code:'custom', message:'行程必须为1至30天，起止时间应一致' });
  if (v.budget) { const b=v.budget.split('-').map(Number); if (b.some(n=>n<=0) || (b.length===2 && b[0]>b[1])) ctx.addIssue({code:'custom',message:'预算范围错误'}); }
});
async function ownedPlan(conn: typeof pool | PoolConnection, planId: unknown, userId: string, lock=false) {
  const no = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).parse(planId);
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM itinerary WHERE itinerary_no=? AND user_id=? AND is_deleted=0${lock?' FOR UPDATE':''}`, [no,userId]);
  if (!rows.length) throw new ApiError(404,20016,'行程不存在');
  return rows[0];
}
async function planDetail(conn: typeof pool | PoolConnection, row: RowDataPacket) {
  const [versions] = await conn.query<RowDataPacket[]>('SELECT snapshot FROM itinerary_version WHERE itinerary_id=? AND version=?', [row.id,row.version]);
  const value = versions[0]?.snapshot;
  const snapshot = typeof value === 'string' ? JSON.parse(value) : value;
  return { ...snapshot, plan_id: row.itinerary_no, version: row.version, status: row.status, is_estimated: Boolean(row.is_estimated) };
}
function internalPlan(value: any): any {
  if (Array.isArray(value)) return value.map(internalPlan);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) =>
    [k.replace(/_([a-z])/g, (_match, c) => c.toUpperCase()), internalPlan(v)]));
  return value;
}
api.post('/plans', run(async (req,res) => {
  const body = planInput.parse(req.body);
  await write(req,res,async conn => {
    const preference = await planner.extractPreferenceFromText(body.prompt ?? body.destination);
    preference.destinationCities=[body.destination];
    preference.daysCount=Math.round((Date.parse(body.end_date)-Date.parse(body.start_date))/86400000)+1;
    preference.nightsCount=preference.daysCount-1;
    preference.budgetTotalRmb=body.budget ? Number(body.budget.split('-').at(-1)) : 5000;
    preference.travelStyle=body.tags?.join('、') || '休闲';
    const plan=await planner.generatePlan(preference);
    plan.itineraryId=generateUlid();
    plan.days.forEach((day,i)=>{day.dateString=new Date(Date.parse(body.start_date)+i*86400000).toISOString();});
    const snapshot = { ...serialize(plan), plan_id:plan.itineraryId, start_date:body.start_date, end_date:body.end_date, is_estimated:true };
    await conn.query(`INSERT INTO itinerary(itinerary_no,user_id,title,summary,status,days_count,nights_count,start_date,end_date,total_budget_rmb,is_estimated)
      VALUES (?,?,?,?,'PENDING_CONFIRM',?,?,?,?,?,1)`, [plan.itineraryId,res.locals.user.id,plan.planTitle,plan.summaryDescription,preference.daysCount,preference.nightsCount,body.start_date.slice(0,10),body.end_date.slice(0,10),String(preference.budgetTotalRmb)]);
    await conn.query(`INSERT INTO itinerary_version(itinerary_id,version,change_type,snapshot,created_by)
      SELECT id,1,'GENERATE',?,user_id FROM itinerary WHERE itinerary_no=?`, [JSON.stringify(snapshot),plan.itineraryId]);
    return { data:{ ...snapshot, version:1, status:'PENDING_CONFIRM' }, status:201 };
  });
}));
api.get('/plans', run(async(req,res)=>{
  const p=page(req.query,['created_at','title'],{status:z.enum(['DRAFT','PLANNING','PENDING_CONFIRM','OPTIMIZING','CONFIRMED','EXPORTED','ARCHIVED']).optional()});
  const where=`FROM itinerary WHERE user_id=? AND is_deleted=0${p.status?' AND status=?':''}`;
  reply(res,await list(pool,`SELECT ${planFields} ${where}`,`SELECT COUNT(*) total ${where}`,[res.locals.user.id,...(p.status?[p.status]:[])],p));
}));
api.get('/plans/:id', run(async(req,res)=>{ reply(res,await planDetail(pool,await ownedPlan(pool,req.params.id,res.locals.user.id))); }));
api.patch('/plans/:id',run(async(req,res)=>{
  const body=z.object({title:text(100).optional(),instruction:text(500).optional()}).strict().refine(v=>v.title||v.instruction).parse(req.body);
  await write(req,res,async conn=>{
    const row=await ownedPlan(conn,req.params.id,res.locals.user.id,true);
    if (!['DRAFT','PENDING_CONFIRM'].includes(row.status)) throw new ApiError(409,20011,'当前行程状态不允许修改');
    const detail=await planDetail(conn,row);
    const updated = body.instruction ? await planner.optimizeItinerary(internalPlan(detail), body.instruction) : internalPlan(detail);
    const snapshot={...serialize(updated),plan_title:body.title ?? updated.planTitle,version:row.version+1};
    await conn.query('UPDATE itinerary SET title=?,summary=?,version=version+1 WHERE id=?',[snapshot.plan_title.slice(0,100),String(snapshot.summary_description??'').slice(0,500),row.id]);
    await conn.query(`INSERT INTO itinerary_version(itinerary_id,version,change_type,adjustment_instruction,snapshot,created_by) VALUES (?,?,'OPTIMIZE',?,?,?)`,[row.id,row.version+1,body.instruction??null,JSON.stringify(snapshot),res.locals.user.id]);
    return {data:snapshot};
  });
}));
api.delete('/plans/:id',run(async(req,res)=>{
  z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).parse(req.params.id);
  await pool.query('UPDATE itinerary SET is_deleted=1 WHERE itinerary_no=? AND user_id=?',[req.params.id,res.locals.user.id]);
  res.status(204).end();
}));
api.post('/orders',run(async(req,res)=>{
  const body=z.object({route_id:id,travel_date:travelDate,people_count:z.number().int().min(1).max(100),contact_mobile:mobile}).strict().parse(req.body);
  await write(req,res,async conn=>{
    const [routes]=await conn.query<RowDataPacket[]>('SELECT id,base_price_rmb FROM travel_product WHERE id=? AND status=\'ON_SALE\' FOR UPDATE',[body.route_id]);
    if(!routes.length) throw new ApiError(404,20016,'线路不存在或已下架');
    const cents=BigInt(String(routes[0].base_price_rmb).replace('.',''))*BigInt(body.people_count);
    if(cents>999999999999n) throw new ApiError(400,10002,'订单金额超出允许范围');
    await lockSeats(conn,body.route_id,body.travel_date,body.people_count);
    const orderNo=generateUlid();
    // MySQL DECIMAL arithmetic retains cents exactly.
    await conn.query(`INSERT INTO tour_order(order_no,user_id,product_id,traveler_count,total_amount,contact_phone,travel_date,is_stock_locked,expires_at) VALUES (?,?,?,?,CAST(? AS DECIMAL(12,2))*?,?,?,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))`,[orderNo,res.locals.user.id,body.route_id,body.people_count,routes[0].base_price_rmb,body.people_count,body.contact_mobile,body.travel_date]);
    const [rows]=await conn.query<RowDataPacket[]>(`SELECT ${orderFields} FROM tour_order WHERE order_no=?`,[orderNo]);
    return {data:rows[0],status:201};
  });
}));
api.get('/orders',run(async(req,res)=>{
  const p=page(req.query,['created_at','total_amount'],{status:z.enum(['CREATED','PAID','CANCELED','COMPLETED','REFUNDED']).optional()});
  const status=({CREATED:'PENDING',CANCELED:'CANCELLED'} as Record<string,string>)[p.status]??p.status;
  const where=`FROM tour_order WHERE user_id=?${status?' AND status=?':''}`;
  reply(res,await list(pool,`SELECT ${orderFields} ${where}`,`SELECT COUNT(*) total ${where}`,[res.locals.user.id,...(status?[status]:[])],p));
}));
api.get('/orders/:id',run(async(req,res)=>{
  const [rows]=await pool.query<RowDataPacket[]>(`SELECT ${orderFields},contact_phone FROM tour_order WHERE id=? AND user_id=?`,[id.parse(req.params.id),res.locals.user.id]);
  if(!rows.length) throw new ApiError(404,20016,'订单不存在');
  const {contact_phone,...order}=rows[0]; reply(res,{...order,contact_mobile:maskMobile(contact_phone)});
}));
api.post('/orders/:id/cancel',run(async(req,res)=>{
  const orderId=id.parse(req.params.id); z.object({}).strict().parse(req.body);
  await write(req,res,async conn=>{
    const [rows]=await conn.query<RowDataPacket[]>('SELECT * FROM tour_order WHERE id=? AND user_id=? FOR UPDATE',[orderId,res.locals.user.id]);
    if(!rows.length) throw new ApiError(404,20016,'订单不存在');
    if(rows[0].status!=='PENDING') throw new ApiError(409,20011,'订单当前状态不允许取消');
    await releaseSeats(conn,rows[0]);
    await conn.query(`UPDATE tour_order SET status='CANCELLED',cancelled_at=UTC_TIMESTAMP(),is_stock_locked=0 WHERE id=?`,[orderId]);
    return {data:{order_id:orderId,status:'CANCELED'}};
  });
}));
api.post('/spots/:id/comments',run(async(req,res)=>{
  const spotId=id.parse(req.params.id);
  const body=z.object({content:text(2000),rating:z.number().int().min(1).max(5)}).strict().parse(req.body);
  await write(req,res,async conn=>{
    const [spots]=await conn.query<RowDataPacket[]>(`SELECT id FROM poi WHERE id=? AND poi_type='ATTRACTION' AND status='ACTIVE'`,[spotId]);
    if(!spots.length) throw new ApiError(404,20016,'景点不存在');
    await conn.query('INSERT INTO spot_comment(spot_id,user_id,content,rating) VALUES (?,?,?,?)',[spotId,res.locals.user.id,body.content,body.rating]);
    const [rows]=await conn.query<RowDataPacket[]>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS comment_id');
    return {data:{...rows[0],spot_id:spotId,...body},status:201};
  });
}));

// 管理端统一由 RBAC 权限码守卫：不再硬编码角色判断，权限来源改为 sys_user_role → sys_role_permission
// 数据级隔离（agency_id）仍由各 handler 自行按 res.locals.user.agency_id 收口
api.get('/admin/routes', requirePermission('route:line:query'), run(async(req,res)=>{
  const p=page(req.query,['created_at','base_price_rmb']);
  const where='FROM travel_product WHERE agency_id=?';
  reply(res,await list(pool,`SELECT ${routeFields} ${where}`,`SELECT COUNT(*) total ${where}`,[res.locals.user.agency_id],p));
}));
api.post('/admin/routes', requirePermission('route:line:add'), run(async(req,res)=>{
  const body=z.object({title:text(100),destination:text(100),default_days:z.number().int().min(1).max(30),style_tag:text(30),base_price_rmb:money}).strict().parse(req.body);
  await write(req,res,async conn=>{
    const no=generateUlid();
    await conn.query(`INSERT INTO travel_product(product_no,agency_id,title,destination,default_days,style_tag,base_price_rmb,status,created_by) VALUES (?,?,?,?,?,?,?,'ON_SALE',?)`,[no,res.locals.user.agency_id,body.title,body.destination,body.default_days,body.style_tag,body.base_price_rmb,res.locals.user.id]);
    const [rows]=await conn.query<RowDataPacket[]>(`SELECT ${routeFields} FROM travel_product WHERE product_no=?`,[no]);
    return {data:rows[0],status:201};
  });
}));
api.get('/admin/analytics', requirePermission('order:manage:query'), run(async(_req,res)=>{
  const [rows]=await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS order_count,SUM(status='PAID') AS paid_order_count FROM tour_order WHERE product_id IN (SELECT id FROM travel_product WHERE agency_id=?)`,[res.locals.user.agency_id]);
  reply(res,rows[0]);
}));
