import { Router, Request } from 'express';
import { z } from 'zod';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { ApiError, id, reply, run, page, list, write, maskMobile } from './core.js';
import { requireAction } from '../auth/rbac.js';
import { chat, llmInfo } from '../agent/llm.js';

/**
 * 平台端接口 —— 支撑平台方 Web 原型 9 页面的真实数据
 * 依据：demo/Web端原型设计说明.md §4 + 三端实施方案
 *
 * 契约：
 *   GET  /platform/overview                  平台工作台大盘          analytics 只读（order:manage:query）
 *   GET  /platform/agencies                  机构列表               system:agency:query
 *   POST /platform/agencies                  新增机构               system:agency:add
 *   PUT  /platform/agencies/:id              编辑机构               system:agency:update
 *   PATCH /platform/agencies/:id             启用/禁用机构           system:agency:update
 *   GET  /platform/audits                    审核列表（线路/特产）    order:manage:query（只读）
 *   POST /platform/audits/:type/:id          审核结论（幂等写）      route:line:audit / souvenir:audit
 *   GET  /platform/users                     全量用户列表            system:user:query
 *   PATCH /platform/users/:id                启用/禁用账号           system:user:update
 *   POST /platform/users/:id/roles           分配角色（全量覆盖）     system:user:update
 *   GET  /platform/orders                    全量订单               order:manage:query
 *   GET  /platform/finance/summary           财务 KPI               finance:platform:query
 *   GET  /platform/settlements               结算单列表             finance:platform:query
 *   POST /platform/settlements/:id/confirm   确认结算（幂等写）      finance:platform:settle
 *   GET  /platform/refunds                   退款记录               finance:platform:query
 *   GET  /platform/ai-service                AI 服务监控            ai:service:query
 *   PUT  /platform/ai-service/config         服务配置               ai:service:config
 *   GET  /platform/analytics                 数据分析中心            order:manage:query
 */

export const platform = Router();

const audit = async (conn: import('mysql2/promise').PoolConnection | typeof pool,
  operatorId: number, operatorName: string, action: string, objectType: string, objectNo: string, detail: string) => {
  try {
    await conn.query(
      `INSERT INTO sys_audit_log (operator_id, operator_name, action, object_type, object_no, detail) VALUES (?,?,?,?,?,?)`,
      [operatorId, operatorName, action, objectType, objectNo, detail]);
  } catch { /* 审计失败不阻断业务 */ }
};

const userOf = (req: Request) =>
  (req.res!.locals as { user: { id: number; nickname: string } }).user;

// ---------------------------------------------------------------------------
// 平台工作台大盘
// ---------------------------------------------------------------------------

platform.get('/platform/overview', requireAction('order:manage', 'query'), run(async (_req, res) => {
  const [kpiRows] = await pool.query<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM sys_user WHERE role='TOURIST') AS tourist_count,
      (SELECT COUNT(*) FROM travel_agency WHERE status='ACTIVE') AS agency_count,
      (SELECT COUNT(*) FROM travel_product WHERE status='ON_SALE') AS route_onsale,
      (SELECT COUNT(*) FROM souvenir WHERE status='ON_SALE') AS souvenir_onsale,
      (SELECT COUNT(*) FROM tour_order WHERE created_at >= CURDATE()) AS today_orders,
      (SELECT COALESCE(SUM(total_amount),0) FROM tour_order WHERE created_at >= CURDATE()) AS today_amount,
      (SELECT COUNT(*) FROM travel_product WHERE audit_status='PENDING')
        + (SELECT COUNT(*) FROM souvenir WHERE audit_status='PENDING') AS pending_audits,
      (SELECT COUNT(*) FROM tour_order WHERE status='PAID') AS pending_confirms,
      (SELECT COUNT(*) FROM settlement WHERE status='PENDING') AS pending_settlements,
      (SELECT COALESCE(SUM(total_amount),0) FROM tour_order WHERE status='REFUNDED') AS refund_amount
  `);
  const [trend] = await pool.query<RowDataPacket[]>(`
    SELECT d.day, COALESCE(o.orders,0) AS orders, COALESCE(o.amount,0) AS amount, COALESCE(v.visits,0) AS visits
      FROM (SELECT DATE_SUB(CURDATE(), INTERVAL seq DAY) AS day
              FROM (SELECT (@s := @s + 1) AS seq FROM information_schema.columns, (SELECT @s := -1) init LIMIT 14) x) d
      LEFT JOIN (SELECT DATE(created_at) AS day, COUNT(*) AS orders, SUM(total_amount) AS amount
                   FROM tour_order WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY DATE(created_at)) o
             ON o.day = d.day
      LEFT JOIN (SELECT DATE(occurred_at) AS day, COUNT(*) AS visits
                   FROM product_stat_event WHERE event_type='VISIT' AND occurred_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
                   GROUP BY DATE(occurred_at)) v
             ON v.day = d.day
     ORDER BY d.day`);
  const [topProducts] = await pool.query<RowDataPacket[]>(`
    SELECT p.id AS route_id, p.product_no, p.title, a.agency_name, p.visitor_count, p.order_count, p.conversion_rate
      FROM travel_product p JOIN travel_agency a ON a.id=p.agency_id
      WHERE p.status='ON_SALE' ORDER BY p.conversion_rate DESC, p.order_count DESC LIMIT 5`);
  const [destHeat] = await pool.query<RowDataPacket[]>(`
    SELECT destination, SUM(visitor_count) AS visits FROM travel_product
      WHERE visitor_count > 0 GROUP BY destination ORDER BY visits DESC LIMIT 5`);
  reply(res, { kpi: kpiRows[0], trend, top_products: topProducts, destination_heat: destHeat });
}));

// ---------------------------------------------------------------------------
// 旅行社管理（平台机构治理）
// ---------------------------------------------------------------------------

platform.get('/platform/agencies', requireAction('system:agency', 'query'), run(async (req, res) => {
  const p = page(req.query, ['created_at', 'agency_name'], {
    keyword: z.string().max(50).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional()
  });
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (p.keyword) { conds.push('(a.agency_name LIKE ? OR a.license_no LIKE ?)'); params.push(`%${p.keyword}%`, `%${p.keyword}%`); }
  if (p.status) { conds.push('a.status = ?'); params.push(p.status); }
  const where = ` WHERE ${conds.join(' AND ')}`;
  const data = await list(pool,
    `SELECT a.id AS agency_id, a.agency_name, a.license_no, a.contact_name, a.contact_phone, a.status,
       a.created_at,
       (SELECT COUNT(*) FROM travel_product tp WHERE tp.agency_id=a.id AND tp.status='ON_SALE') AS onsale_products,
       (SELECT COUNT(*) FROM tour_order o JOIN travel_product tp ON tp.id=o.product_id WHERE tp.agency_id=a.id) AS order_count
     FROM travel_agency a${where}`,
    `SELECT COUNT(*) AS total FROM travel_agency a${where}`, params, p);
  reply(res, { ...data, list: data.list.map((r: RowDataPacket) => ({ ...r, contact_phone: maskMobile(r.contact_phone) })) });
}));

const agencyInput = z.object({
  agency_name: z.string().min(1).max(100),
  license_no: z.string().min(4).max(50),
  contact_name: z.string().max(50).optional(),
  contact_phone: z.string().max(20).optional(),
  intro: z.string().max(500).optional()
}).strict();

platform.post('/platform/agencies', requireAction('system:agency', 'add'), run(async (req, res) => {
  const body = agencyInput.parse(req.body);
  const user = userOf(req);
  await write(req, res, async (conn) => {
    try {
      const [rs] = await conn.query<ResultSetHeader>(
        `INSERT INTO travel_agency (agency_name, license_no, contact_name, contact_phone, intro) VALUES (?,?,?,?,?)`,
        [body.agency_name, body.license_no, body.contact_name ?? null, body.contact_phone ?? null, body.intro ?? null]);
      await audit(conn, user.id, user.nickname, '新增机构', 'agency', body.license_no, body.agency_name);
      return { data: { agency_id: String(rs.insertId) }, status: 201 };
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new ApiError(409, 20015, '许可证号已存在');
      throw err;
    }
  });
}));

platform.put('/platform/agencies/:id', requireAction('system:agency', 'update'), run(async (req, res) => {
  const agencyId = id.parse(req.params.id);
  const body = agencyInput.partial().parse(req.body);
  await write(req, res, async (conn) => {
    const [rs] = await conn.query<ResultSetHeader>(
      `UPDATE travel_agency SET agency_name=?, license_no=?, contact_name=?, contact_phone=?, intro=? WHERE id=?`,
      [body.agency_name, body.license_no, body.contact_name ?? null, body.contact_phone ?? null, body.intro ?? null, agencyId]);
    if (!rs.affectedRows) throw new ApiError(404, 20016, '机构不存在');
    return { data: { agency_id: String(agencyId) } };
  });
}));

platform.patch('/platform/agencies/:id', requireAction('system:agency', 'update'), run(async (req, res) => {
  const agencyId = id.parse(req.params.id);
  const body = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).strict().parse(req.body);
  const user = userOf(req);
  await write(req, res, async (conn) => {
    const [rs] = await conn.query<ResultSetHeader>('UPDATE travel_agency SET status=? WHERE id=?', [body.status, agencyId]);
    if (!rs.affectedRows) throw new ApiError(404, 20016, '机构不存在');
    if (body.status === 'DISABLED') {
      // 禁用机构 → 其名下账号一并禁用（api_session 由 passport 查状态拦截）
      await conn.query(`UPDATE sys_user SET status='DISABLED' WHERE agency_id=? AND role='ADMIN'`, [agencyId]);
    } else {
      await conn.query(`UPDATE sys_user SET status='ACTIVE' WHERE agency_id=? AND role='ADMIN'`, [agencyId]);
    }
    await audit(conn, user.id, user.nickname, body.status === 'DISABLED' ? '禁用机构' : '启用机构', 'agency', String(agencyId), '机构名下管理员账号状态同步变更');
    return { data: { agency_id: String(agencyId), status: body.status } };
  });
}));

platform.get('/platform/agencies/:id', requireAction('system:agency', 'query'), run(async (req, res) => {
  const agencyId = id.parse(req.params.id);
  const [agencies] = await pool.query<RowDataPacket[]>(
    `SELECT id AS agency_id, agency_name, license_no, contact_name, contact_phone, status, intro, created_at FROM travel_agency WHERE id=?`, [agencyId]);
  if (!agencies.length) throw new ApiError(404, 20016, '机构不存在');
  const [members] = await pool.query<RowDataPacket[]>(
    `SELECT u.username, u.nickname, u.status, u.last_login_at FROM sys_user u WHERE u.agency_id=? AND u.role='ADMIN'`, [agencyId]);
  const [statsRows] = await pool.query<RowDataPacket[]>(`
    SELECT (SELECT COUNT(*) FROM travel_product WHERE agency_id=? AND status='ON_SALE') AS onsale_products,
           (SELECT COUNT(*) FROM tour_order o JOIN travel_product tp ON tp.id=o.product_id WHERE tp.agency_id=?) AS order_count,
           (SELECT COALESCE(SUM(o.total_amount),0) FROM tour_order o JOIN travel_product tp ON tp.id=o.product_id WHERE tp.agency_id=? AND o.status IN ('PAID','CONFIRMED','COMPLETED')) AS total_amount`,
    [agencyId, agencyId, agencyId]);
  reply(res, { ...agencies[0], contact_phone: maskMobile(agencies[0].contact_phone), members, stats: statsRows[0] });
}));

// ---------------------------------------------------------------------------
// 产品审核
// ---------------------------------------------------------------------------

platform.get('/platform/audits', requireAction('order:manage', 'query'), run(async (req, res) => {
  const p = page(req.query, ['updated_at', 'created_at'], {
    type: z.enum(['route', 'souvenir']).default('route'),
    audit_status: z.enum(['NONE', 'PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
    keyword: z.string().max(50).optional()
  });
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (p.keyword) { conds.push('(t.title LIKE ? OR t.product_no LIKE ?)'); params.push(`%${p.keyword}%`, `%${p.keyword}%`); }
  const where = ` WHERE t.audit_status='${p.audit_status}' ${conds[0] !== '1=1' ? `AND ${conds[1]}` : ''}`;
  // 排序字段限定到产品表，避免与 travel_agency 同名列二义
  const sortField = p.sort.replace(/^-/, '');
  const p2 = { ...p, sort: p.sort.replace(sortField, sortField === 'created_at' ? 't.created_at' : sortField === 'updated_at' ? 't.updated_at' : sortField) };
  if (p.type === 'route') {
    const data = await list(pool,
      `SELECT t.id AS product_id, t.product_no, t.title, t.destination, a.agency_name, t.base_price_rmb AS price,
         t.audit_status, t.audit_remark, t.status AS product_status, t.updated_at AS submitted_at
       FROM travel_product t JOIN travel_agency a ON a.id=t.agency_id${where}`,
      `SELECT COUNT(*) AS total FROM travel_product t${where}`, params, p2, { tieBreaker: 't.id' });
    return reply(res, { ...data, type: 'route' });
  }
  const data = await list(pool,
    `SELECT t.id AS product_id, t.product_no, t.name AS title, t.category AS destination, a.agency_name, t.price,
       t.audit_status, t.audit_remark, t.status AS product_status, t.updated_at AS submitted_at
     FROM souvenir t JOIN travel_agency a ON a.id=t.agency_id${where}`,
    `SELECT COUNT(*) AS total FROM souvenir t${where}`, params, p2, { tieBreaker: 't.id' });
  reply(res, { ...data, type: 'souvenir' });
}));

platform.post('/platform/audits/:type/:id', run(async (req, res) => {
  const body = z.object({
    result: z.enum(['APPROVED', 'REJECTED']),
    remark: z.string().max(255).optional()
  }).strict().parse(req.body);
  const type = z.enum(['route', 'souvenir']).parse(req.params.type);
  const targetId = id.parse(req.params.id);
  const user = userOf(req);
  await write(req, res, async (conn) => {
    const isRoute = type === 'route';
    // 平台审核权限：线路 route:line:audit / 特产 souvenir:audit —— 用 Casbin 判定
    const { evaluateRequests } = await import('../auth/casbin.js');
    const { toPolicyRequest } = await import('../auth/permissionCode.js');
    const need = isRoute ? toPolicyRequest('route:line', 'audit') : toPolicyRequest('route:souvenir', 'audit');
    const decision = await evaluateRequests(req.user!, [need], 'all');
    if (!decision.allowed) throw new ApiError(403, 20013, '权限不足，禁止访问');

    const table = isRoute ? 'travel_product' : 'souvenir';
    const [own] = await conn.query<RowDataPacket[]>(`SELECT id, product_no, title, audit_status, agency_id FROM ${table} WHERE id=?`, [targetId]);
    if (!own.length) throw new ApiError(404, 20016, '待审对象不存在');
    if (own[0].audit_status === 'APPROVED' && body.result === 'APPROVED') throw new ApiError(409, 20010, '该产品已审核通过');
    // 通过 → 上架；驳回 → 维持现态并把理由回传提交方
    await conn.query(
      `UPDATE ${table} SET audit_status=?, audit_remark=?, audited_by=?, audited_at=UTC_TIMESTAMP(),
         status=? WHERE id=?`,
      [body.result, body.remark ?? (body.result === 'REJECTED' ? '未通过平台审核' : null), user.id,
        body.result === 'APPROVED' ? 'ON_SALE' : (isRoute ? 'DRAFT' : 'OFF_SALE'), targetId]);
    await audit(conn, user.id, user.nickname, body.result === 'APPROVED' ? '审核通过' : '审核驳回',
      isRoute ? 'route' : 'souvenir', String(own[0].product_no), body.remark ?? '');
    return { data: { product_id: String(targetId), audit_status: body.result } };
  });
}));

// ---------------------------------------------------------------------------
// 用户管理（全量账号治理）
// ---------------------------------------------------------------------------

platform.get('/platform/users', requireAction('system:user', 'query'), run(async (req, res) => {
  const p = page(req.query, ['created_at', 'last_login_at'], {
    keyword: z.string().max(50).optional(),
    user_type: z.enum(['TOURIST', 'ADMIN']).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    agency_id: id.optional()
  });
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (p.keyword) { conds.push('(u.nickname LIKE ? OR u.username LIKE ? OR u.phone LIKE ?)'); params.push(`%${p.keyword}%`, `%${p.keyword}%`, `%${p.keyword}%`); }
  if (p.user_type) { conds.push('u.role = ?'); params.push(p.user_type); }
  if (p.status) { conds.push('u.status = ?'); params.push(p.status); }
  if (p.agency_id) { conds.push('u.agency_id = ?'); params.push(p.agency_id); }
  const where = ` WHERE ${conds.join(' AND ')}`;
  const data = await list(pool,
    `SELECT u.id AS user_id, u.nickname, u.username, u.phone AS masked_phone, u.role AS user_type,
       u.agency_id, a.agency_name,
       (SELECT GROUP_CONCAT(r.name) FROM sys_user_role ur JOIN sys_role r ON r.id=ur.role_id WHERE ur.user_id=u.id) AS role_names,
       u.status, u.last_login_at, u.created_at
     FROM sys_user u LEFT JOIN travel_agency a ON a.id=u.agency_id${where}`,
    `SELECT COUNT(*) AS total FROM sys_user u${where}`, params, p, { tieBreaker: 'u.id' });
  reply(res, { ...data, list: data.list.map((r: RowDataPacket) => ({ ...r, masked_phone: maskMobile(r.masked_phone) })) });
}));

platform.patch('/platform/users/:id', requireAction('system:user', 'update'), run(async (req, res) => {
  const userId = id.parse(req.params.id);
  const body = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).strict().parse(req.body);
  const user = userOf(req);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, username FROM sys_user WHERE id=?', [userId]);
    if (!rows.length) throw new ApiError(404, 20016, '用户不存在');
    if (rows[0].username === 'super') throw new ApiError(403, 20013, '内置超级管理员账号不可禁用');
    await conn.query('UPDATE sys_user SET status=? WHERE id=?', [body.status, userId]);
    if (body.status === 'DISABLED') {
      // 禁用即撤销会话（与 rbacRouter 同口径）
      await conn.query('UPDATE api_session SET is_revoked=1 WHERE user_id=? AND is_revoked=0', [userId]);
    }
    await audit(conn, user.id, user.nickname, body.status === 'DISABLED' ? '禁用账号' : '启用账号', 'user', String(userId), rows[0].username);
    return { data: { user_id: String(userId), status: body.status } };
  });
}));

platform.post('/platform/users/:id/roles', requireAction('system:user', 'update'), run(async (req, res) => {
  const userId = id.parse(req.params.id);
  const body = z.object({ role_ids: z.array(id).max(5) }).strict().parse(req.body);
  const user = userOf(req);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT username FROM sys_user WHERE id=?', [userId]);
    if (!rows.length) throw new ApiError(404, 20016, '用户不存在');
    if (rows[0].username === 'super') throw new ApiError(403, 20013, '内置超级管理员角色不可变更');
    await conn.query('DELETE FROM sys_user_role WHERE user_id=?', [userId]);
    for (const rid of body.role_ids) {
      await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [userId, rid]);
    }
    await audit(conn, user.id, user.nickname, '分配角色', 'user', String(userId), body.role_ids.join(','));
    return { data: { user_id: String(userId), role_ids: body.role_ids } };
  });
}));

// ---------------------------------------------------------------------------
// 订单与交易管理（全量监督，只读）
// ---------------------------------------------------------------------------

platform.get('/platform/orders', requireAction('order:manage', 'query'), run(async (req, res) => {
  const p = page(req.query, ['created_at', 'total_amount'], {
    keyword: z.string().max(50).optional(),
    status: z.enum(['PENDING', 'PAID', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'REFUNDED']).optional(),
    agency_id: id.optional()
  });
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (p.keyword) { conds.push('(o.order_no LIKE ? OR o.contact_phone LIKE ?)'); params.push(`%${p.keyword}%`, `%${p.keyword}%`); }
  if (p.status) { conds.push('o.status = ?'); params.push(p.status); }
  if (p.agency_id) { conds.push('p.agency_id = ?'); params.push(p.agency_id); }
  const where = ` WHERE ${conds.join(' AND ')}`;
  const data = await list(pool,
    `SELECT o.id, o.id AS order_id, o.order_no, a.agency_name, p.title AS route_title,
       o.traveler_count AS people_count, o.total_amount AS amount, o.status, o.contact_name, o.contact_phone,
       o.travel_date, o.created_at, o.paid_at
     FROM tour_order o JOIN travel_product p ON p.id=o.product_id JOIN travel_agency a ON a.id=p.agency_id${where}`,
    `SELECT COUNT(*) AS total FROM tour_order o JOIN travel_product p ON p.id=o.product_id${where}`, params, p,
    { tieBreaker: 'o.id' });
  reply(res, { ...data, list: data.list.map((r: RowDataPacket) => ({
    ...r, contact_phone: maskMobile(r.contact_phone),
    contact_name: r.contact_name ? String(r.contact_name).replace(/^(.).*/, '$1*') : null
  })) });
}));

// ---------------------------------------------------------------------------
// 财务与结算
// ---------------------------------------------------------------------------

platform.get('/platform/finance/summary', requireAction('finance:platform', 'query'), run(async (_req, res) => {
  const [kpiRows] = await pool.query<RowDataPacket[]>(`
    SELECT
      (SELECT COALESCE(SUM(total_amount),0) FROM tour_order WHERE status IN ('PAID','CONFIRMED','COMPLETED')) AS total_gmv,
      (SELECT COALESCE(SUM(payable_amount),0) FROM settlement WHERE status='PENDING') AS pending_settle,
      (SELECT COUNT(DISTINCT agency_id) FROM settlement WHERE status='PENDING') AS pending_agencies,
      (SELECT COALESCE(SUM(payable_amount),0) FROM settlement WHERE status='SETTLED') AS settled_amount,
      (SELECT COALESCE(SUM(total_amount),0) FROM tour_order WHERE status='REFUNDED') AS refund_amount,
      (SELECT COUNT(*) FROM tour_order WHERE status='REFUNDED') AS refund_count
  `);
  reply(res, kpiRows[0]);
}));

platform.get('/platform/settlements', requireAction('finance:platform', 'query'), run(async (req, res) => {
  const p = page(req.query, ['created_at'], { status: z.enum(['PENDING', 'SETTLED', 'REJECTED']).optional() });
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (p.status) { conds.push('st.status = ?'); params.push(p.status); }
  const where = ` WHERE ${conds.join(' AND ')}`;
  reply(res, await list(pool,
    `SELECT st.id AS settlement_id, st.settlement_no, a.agency_name, st.period_label, st.order_count,
       st.gross_amount, st.commission_rate, st.commission_amount, st.payable_amount, st.status,
       st.reject_reason, st.created_at, st.settled_at
     FROM settlement st JOIN travel_agency a ON a.id=st.agency_id${where}`,
    `SELECT COUNT(*) AS total FROM settlement st${where}`, params, p, { tieBreaker: 'st.id' }));
}));

platform.post('/platform/settlements/:id/confirm', requireAction('finance:platform', 'settle'), run(async (req, res) => {
  const sid = id.parse(req.params.id);
  const user = userOf(req);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, settlement_no, status FROM settlement WHERE id=? FOR UPDATE', [sid]);
    if (!rows.length) throw new ApiError(404, 20016, '结算单不存在');
    if (rows[0].status === 'SETTLED') throw new ApiError(409, 20010, '该结算单已结算，请勿重复操作');
    if (rows[0].status === 'REJECTED') throw new ApiError(409, 20010, '该结算单已驳回，需先处理争议订单');
    await conn.query(`UPDATE settlement SET status='SETTLED', settled_at=UTC_TIMESTAMP() WHERE id=?`, [sid]);
    await conn.query(`UPDATE tour_order SET settlement_id=? WHERE settlement_id IS NULL AND status IN ('CONFIRMED','COMPLETED')
       AND product_id IN (SELECT tp.id FROM (SELECT agency_id FROM settlement WHERE id=?) s JOIN travel_product tp ON tp.agency_id=s.agency_id)`, [sid, sid]);
    await audit(conn, user.id, user.nickname, '确认结算', 'settlement', String(rows[0].settlement_no), '');
    return { data: { settlement_id: String(sid), status: 'SETTLED' } };
  });
}));

platform.get('/platform/refunds', requireAction('finance:platform', 'query'), run(async (_req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT o.order_no, u.nickname AS customer, o.contact_phone AS masked_phone, a.agency_name,
       o.total_amount AS amount, o.refund_reason, o.refunded_at, o.status
     FROM tour_order o
     JOIN travel_product p ON p.id=o.product_id
     JOIN travel_agency a ON a.id=p.agency_id
     LEFT JOIN sys_user u ON u.id=o.user_id
     WHERE o.status='REFUNDED' ORDER BY o.refunded_at DESC LIMIT 20`);
  reply(res, { list: rows.map((r) => ({ ...r, masked_phone: maskMobile(r.masked_phone) })), total: rows.length, has_more: false });
}));

// ---------------------------------------------------------------------------
// 系统元数据：审计日志 + 业务字典（权限与系统管理页）
// ---------------------------------------------------------------------------

platform.get('/platform/system-meta', requireAction('system:agency', 'query'), run(async (_req, res) => {
  const [logs] = await pool.query<RowDataPacket[]>(
    `SELECT operator_name, action, object_type, object_no, detail, trace_id, created_at
       FROM sys_audit_log ORDER BY created_at DESC LIMIT 50`);
  const [dicts] = await pool.query<RowDataPacket[]>(
    `SELECT dict_type, dict_key, dict_value, sort FROM sys_dict ORDER BY dict_type, sort`);
  reply(res, { audit_logs: logs, dicts });
}));

// ---------------------------------------------------------------------------
// AI 智能服务管理
// ---------------------------------------------------------------------------

platform.get('/platform/ai-service', requireAction('ai:service', 'query'), run(async (_req, res) => {
  const [kpiRows] = await pool.query<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM chat_session WHERE created_at >= CURDATE()) AS today_sessions,
      (SELECT COUNT(*) FROM chat_session WHERE status='ACTIVE') AS active_sessions,
      (SELECT COUNT(*) FROM chat_message WHERE created_at >= CURDATE()) AS today_messages,
      (SELECT COUNT(*) FROM tool_call_log WHERE created_at >= CURDATE()) AS today_tool_calls,
      (SELECT IFNULL(AVG(latency_ms),0) FROM tool_call_log WHERE created_at >= CURDATE() AND response_status='SUCCESS') AS avg_latency_ms,
      (SELECT COUNT(*) FROM chat_session cs WHERE cs.status='ACTIVE' AND cs.message_count > 0 AND cs.last_active_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS unclosed_sessions
  `);
  const [toolDist] = await pool.query<RowDataPacket[]>(`
    SELECT tool_name, COUNT(*) AS calls,
           SUM(CASE WHEN response_status='SUCCESS' THEN 1 ELSE 0 END) AS success_calls,
           SUM(CASE WHEN response_status <> 'SUCCESS' THEN 1 ELSE 0 END) AS failed_calls
      FROM tool_call_log GROUP BY tool_name ORDER BY calls DESC`);
  const [hotQuestions] = await pool.query<RowDataPacket[]>(`
    SELECT content, COUNT(*) AS cnt FROM chat_message
      WHERE sender='USER' GROUP BY content ORDER BY cnt DESC LIMIT 5`);
  const [abnormal] = await pool.query<RowDataPacket[]>(`
    SELECT cs.id AS session_id, cs.title, cs.user_id, cs.status, cs.last_active_at
      FROM chat_session cs
      WHERE EXISTS (SELECT 1 FROM tool_call_log tl WHERE tl.session_id=cs.id AND tl.response_status IN ('FAILED','TIMEOUT'))
         OR (cs.status='ACTIVE' AND cs.message_count > 0 AND cs.last_active_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
      ORDER BY cs.last_active_at DESC LIMIT 10`);
  const [configRows] = await pool.query<RowDataPacket[]>('SELECT persona, model_params, tools_json, updated_at FROM ai_service_config WHERE id=1');
  reply(res, {
    kpi: kpiRows[0], tool_distribution: toolDist, hot_questions: hotQuestions,
    abnormal_sessions: abnormal, config: configRows[0], llm: llmInfo()
  });
}));

/** 大模型连通性自检：真实发起一次极小请求，返回模型 / 耗时 / 回复 */
platform.post('/platform/ai-service/test', requireAction('ai:service', 'config'), run(async (_req, res) => {
  const info = llmInfo();
  if (!info.key_configured) {
    throw new ApiError(400, 50010, '未检测到 DEEPSEEK_API_KEY 环境变量，请在服务器环境变量中配置后重启后端');
  }
  const started = Date.now();
  const r = await chat(
    [
      { role: 'system', content: '你是连通性自检助手，只回复一个简短中文句子。' },
      { role: 'user', content: '请回复：智能体服务连接正常。' },
    ],
    { temperature: 0.1, maxTokens: 40, timeoutMs: 20000, thinking: false },
  );
  if (!r) throw new ApiError(502, 50011, '大模型调用失败，请检查密钥有效性、余额或网络出口');
  reply(res, {
    ok: true,
    model: r.model,
    latency_ms: Date.now() - started,
    tokens: r.usage?.total_tokens ?? null,
    reply: r.content.slice(0, 120),
    provider: info.provider,
    base_url: info.base_url,
  });
}));

platform.put('/platform/ai-service/config', requireAction('ai:service', 'config'), run(async (req, res) => {
  const body = z.object({
    persona: z.string().max(255).optional(),
    model_params: z.string().max(255).optional(),
    tools: z.object({
      attractions: z.boolean(), transport: z.boolean(), hotel: z.boolean(), food: z.boolean(), weather: z.boolean()
    }).partial().strict().optional()
  }).strict().parse(req.body);
  const user = userOf(req);
  await write(req, res, async (conn) => {
    await conn.query(
      `UPDATE ai_service_config SET
         persona=COALESCE(?, persona), model_params=COALESCE(?, model_params),
         tools_json=COALESCE(JSON_MERGE_PATCH(COALESCE(tools_json,'{}'), CAST(? AS JSON)), tools_json),
         updated_by=?
       WHERE id=1`,
      [body.persona ?? null, body.model_params ?? null, body.tools ? JSON.stringify(body.tools) : null, user.id]);
    const [[config]] = await conn.query<RowDataPacket[][]>('SELECT persona, model_params, tools_json, updated_at FROM ai_service_config WHERE id=1');
    await audit(conn, user.id, user.nickname, '更新AI服务配置', 'ai_service', '1', body.persona ?? '');
    return { data: config };
  });
}));

// ---------------------------------------------------------------------------
// 数据分析中心
// ---------------------------------------------------------------------------

platform.get('/platform/analytics', requireAction('order:manage', 'query'), run(async (req, res) => {
  const days = z.coerce.number().int().refine((v) => [7, 30, 90].includes(v)).default(30).parse(req.query.days);
  const [funnelRows] = await pool.query<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM product_stat_event WHERE event_type='VISIT' AND occurred_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)) AS visits,
      (SELECT COUNT(*) FROM product_stat_event WHERE event_type='PLAN_GENERATED' AND occurred_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)) AS plans,
      (SELECT COUNT(*) FROM product_stat_event WHERE event_type='ORDER' AND occurred_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)) AS orders,
      (SELECT COUNT(*) FROM tour_order WHERE status IN ('CONFIRMED','COMPLETED') AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)) AS deals
  `, [days, days, days, days]);
  const funnel = funnelRows[0];
  const [trend] = await pool.query<RowDataPacket[]>(`
    SELECT d.day, COALESCE(o.orders,0) AS orders, COALESCE(o.amount,0) AS amount
      FROM (SELECT DATE_SUB(CURDATE(), INTERVAL seq DAY) AS day
              FROM (SELECT (@s2 := @s2 + 1) AS seq FROM information_schema.columns, (SELECT @s2 := -1) init LIMIT ?) x) d
      LEFT JOIN (SELECT DATE(created_at) AS day, COUNT(*) AS orders, SUM(total_amount) AS amount
                   FROM tour_order WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(created_at)) o
             ON o.day = d.day ORDER BY d.day`, [days, days]);
  const [destHeat] = await pool.query<RowDataPacket[]>(`
    SELECT destination, SUM(visitor_count) AS visits, SUM(order_count) AS orders
      FROM travel_product WHERE visitor_count > 0 GROUP BY destination ORDER BY visits DESC LIMIT 6`);
  const [productRank] = await pool.query<RowDataPacket[]>(`
    SELECT p.id AS route_id, p.product_no, p.title, a.agency_name, p.visitor_count, p.order_count, p.conversion_rate
      FROM travel_product p JOIN travel_agency a ON a.id=p.agency_id
      ORDER BY p.conversion_rate DESC LIMIT 8`);
  const [tagDist] = await pool.query<RowDataPacket[]>(`
    SELECT tag_value, COUNT(*) AS cnt FROM preference_tag WHERE tag_type='INTEREST' GROUP BY tag_value ORDER BY cnt DESC LIMIT 6`);
  const [cityDist] = await pool.query<RowDataPacket[]>(`
    SELECT default_departure_city AS city, COUNT(*) AS cnt FROM sys_user
      WHERE role='TOURIST' AND default_departure_city IS NOT NULL GROUP BY city ORDER BY cnt DESC LIMIT 6`);
  const [agencyPerf] = await pool.query<RowDataPacket[]>(`
    SELECT a.id AS agency_id, a.agency_name,
       (SELECT COUNT(*) FROM travel_product tp WHERE tp.agency_id=a.id AND tp.status='ON_SALE') AS onsale_products,
       (SELECT COUNT(*) FROM tour_order o JOIN travel_product tp ON tp.id=o.product_id WHERE tp.agency_id=a.id AND o.status IN ('PAID','CONFIRMED','COMPLETED')) AS order_count,
       (SELECT COALESCE(SUM(o.total_amount),0) FROM tour_order o JOIN travel_product tp ON tp.id=o.product_id WHERE tp.agency_id=a.id AND o.status IN ('PAID','CONFIRMED','COMPLETED')) AS total_amount
      FROM travel_agency a WHERE a.status='ACTIVE' ORDER BY order_count DESC LIMIT 6`);
  reply(res, { days, funnel, trend, destination_heat: destHeat, product_rank: productRank, tag_distribution: tagDist, city_distribution: cityDist, agency_performance: agencyPerf });
}));
