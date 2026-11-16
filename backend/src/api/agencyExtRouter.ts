import { Router, Request } from 'express';
import { z } from 'zod';
import { RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { ApiError, id, reply, run, page, list, write, maskMobile, serialize } from './core.js';
import { requireAction } from '../auth/rbac.js';
import { TravelPlannerAgent } from '../agent/planner.js';
import { generateUlid } from '../db/repository.js';

/**
 * B 端（旅行社）扩展接口 —— 支撑 Web 端原型 8 页面的真实数据
 * 依据：demo/Web端原型设计说明.md §3 + 三端实施方案 §5.2
 *
 * 契约（前端 prototype/assets/api.js 一一对应）：
 *   GET    /admin/orders                     订单列表（本社）          order:manage:query
 *   GET    /admin/orders/:id                 订单详情（状态流转）      order:manage:query
 *   POST   /admin/orders/:id/confirm         确认处理（幂等写）        order:manage:update
 *   GET    /admin/specialties                特产列表                 route:souvenir:query
 *   POST   /admin/specialties                新建特产（下架态）        route:souvenir:add
 *   PUT    /admin/specialties/:id            编辑特产                 route:souvenir:update
 *   PATCH  /admin/specialties/:id            上架/下架（逻辑删除）     route:souvenir:delete
 *   POST   /admin/specialties/:id/submit     提交平台审核             route:souvenir:update
 *   GET    /admin/customers                  客户聚合列表             customer:query
 *   GET    /admin/customers/:id              客户详情（订单+偏好）     customer:query
 *   PUT    /admin/customers/:id/note         跟进备注                 customer:update
 *   GET    /admin/guides                     导游列表                 guide:query
 *   POST   /admin/guides                     新增导游                 guide:add
 *   PUT    /admin/guides/:id                 编辑导游                 guide:update
 *   PATCH  /admin/guides/:id                 启用/停用                guide:delete
 *   GET    /admin/teams                      团队列表                 team:query
 *   GET    /admin/teams/:no/members          团队成员                 team:query
 *   POST   /admin/teams                      创建团队（自动收编订单）  team:add
 *   PUT    /admin/teams/:no                  指派导游 / 状态流转      team:update
 *   GET    /admin/finance/summary            财务 KPI                 finance:agency:query
 *   GET    /admin/finance/flows              收支明细                 finance:agency:query
 *   GET    /admin/settings                   本社资料+成员            agency:member:query
 *   PUT    /admin/settings                   保存资料/通知偏好        agency:settings:update
 *   POST   /admin/members                    新增社内成员             agency:member:add
 *   PATCH  /admin/members/:id                启用/禁用成员            agency:member:update
 */

export const agencyExt = Router();
const plannerAgent = new TravelPlannerAgent();

/** 审计留痕（错误不影响主流程） */
const audit = async (
  conn: typeof pool | PoolConnection, operatorId: number, operatorName: string,
  action: string, objectType: string, objectNo: string, detail: string
) => {
  try {
    await conn.query(
      `INSERT INTO sys_audit_log (operator_id, operator_name, action, object_type, object_no, detail, trace_id)
       VALUES (?,?,?,?,?,?,?)`,
      [operatorId, operatorName, action, objectType, objectNo, detail, null]
    );
  } catch { /* 审计失败不阻断业务 */ }
};

const agencyOf = (req: Request) =>
  (req.res!.locals as { user: { agency_id: number | null; id: number; nickname: string } }).user;

/** 本社订单字段（脱敏在应用层做） */
const adminOrderFields = `o.id, o.id AS order_id, o.order_no, o.product_id AS route_id, p.title AS route_title,
  o.traveler_count AS people_count, o.total_amount AS amount, o.status, o.contact_name, o.contact_phone,
  o.travel_date, o.created_at, o.paid_at, o.confirmed_at, o.confirm_remark, o.cancelled_at, o.refunded_at,
  o.refund_reason, o.expires_at, o.settlement_id`;

const maskOrder = (row: RowDataPacket) => ({
  ...row,
  contact_phone: maskMobile(row.contact_phone),
  contact_name: row.contact_name ? String(row.contact_name).replace(/^(.).*/, '$1*') : null
});

// ---------------------------------------------------------------------------
// 订单管理
// ---------------------------------------------------------------------------

agencyExt.get('/admin/orders', requireAction('order:manage', 'query'), run(async (req, res) => {
  const p = page(req.query, ['created_at', 'total_amount', 'travel_date'], {
    status: z.enum(['PENDING', 'PAID', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'REFUNDED']).optional(),
    route_id: id.optional(),
    travel_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    keyword: z.string().max(50).optional()
  });
  const conds = ['p.agency_id = ?'];
  const params: unknown[] = [agencyOf(req).agency_id];
  if (p.status) { conds.push('o.status = ?'); params.push(p.status); }
  if (p.route_id) { conds.push('o.product_id = ?'); params.push(p.route_id); }
  if (p.travel_date) { conds.push('o.travel_date = ?'); params.push(p.travel_date); }
  if (p.keyword) {
    conds.push('(o.order_no LIKE ? OR o.contact_phone LIKE ? OR o.contact_name LIKE ?)');
    const like = `%${p.keyword}%`;
    params.push(like, like, like);
  }
  const where = ` FROM tour_order o JOIN travel_product p ON p.id = o.product_id WHERE ${conds.join(' AND ')}`;
  const data = await list(pool,
    `SELECT ${adminOrderFields}${where}`,
    `SELECT COUNT(*) AS total${where}`, params, p, { tieBreaker: 'o.id' });
  reply(res, { ...data, list: data.list.map(maskOrder) });
}));

agencyExt.get('/admin/orders/:id', requireAction('order:manage', 'query'), run(async (req, res) => {
  const orderId = id.parse(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${adminOrderFields} FROM tour_order o JOIN travel_product p ON p.id = o.product_id
      WHERE o.id = ? AND p.agency_id = ?`, [orderId, agencyOf(req).agency_id]);
  if (!rows.length) throw new ApiError(404, 20016, '订单不存在或无权查看');
  const row = rows[0];
  // 状态流转时间线（后端判定，前端只渲染）
  const timeline = [
    { step: '订单创建（锁位）', time: row.created_at, done: true },
    { step: '支付成功', time: row.paid_at, done: !!row.paid_at },
    { step: '社管确认处理', time: row.confirmed_at ?? (row.status === 'PAID' ? '待处理' : null), done: !!row.confirmed_at },
    { step: '出行完成', time: row.status === 'COMPLETED' ? '已完成' : '待出行后更新', done: row.status === 'COMPLETED' }
  ];
  reply(res, { ...maskOrder(row), timeline });
}));

agencyExt.post('/admin/orders/:id/confirm', requireAction('order:manage', 'update'), run(async (req, res) => {
  const orderId = id.parse(req.params.id);
  const body = z.object({ remark: z.string().max(200).optional() }).strict().parse(req.body);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT o.id, o.status, o.order_no FROM tour_order o JOIN travel_product p ON p.id = o.product_id
        WHERE o.id = ? AND p.agency_id = ? FOR UPDATE`, [orderId, agencyOf(req).agency_id]);
    if (!rows.length) throw new ApiError(404, 20016, '订单不存在或无权处理');
    if (rows[0].status === 'CONFIRMED') throw new ApiError(409, 20010, '该订单已确认，请勿重复处理');
    if (rows[0].status !== 'PAID') throw new ApiError(409, 20010, `当前状态为「${rows[0].status}」，仅已支付待确认订单可处理`);
    await conn.query(
      `UPDATE tour_order SET status='CONFIRMED', confirmed_at=UTC_TIMESTAMP(), confirm_remark=? WHERE id=?`,
      [body.remark ?? null, orderId]);
    const [fresh] = await conn.query<RowDataPacket[]>(`SELECT ${adminOrderFields} FROM tour_order o JOIN travel_product p ON p.id=o.product_id WHERE o.id=?`, [orderId]);
    const user = agencyOf(req);
    await audit(conn, user.id, user.nickname, '确认订单', 'order', String(rows[0].order_no), body.remark ?? '');
    return { data: maskOrder(fresh[0]) };
  });
}));

// ---------------------------------------------------------------------------
// 特产管理
// ---------------------------------------------------------------------------

const souvenirFields = `s.id, s.id AS spu_id, s.product_no, s.agency_id, s.name, s.category, s.link_route_id,
  r.title AS link_route_title, s.price, s.stock, s.sales, s.status, s.audit_status, s.audit_remark,
  s.description, s.created_at, s.updated_at`;

agencyExt.get('/admin/specialties', requireAction('route:souvenir', 'query'), run(async (req, res) => {
  const p = page(req.query, ['created_at', 'price', 'sales'], {
    keyword: z.string().max(50).optional(),
    category: z.string().max(20).optional(),
    status: z.enum(['ON_SALE', 'OFF_SALE']).optional()
  });
  const conds = ['s.agency_id = ?'];
  const params: unknown[] = [agencyOf(req).agency_id];
  if (p.keyword) { conds.push('(s.name LIKE ? OR s.product_no LIKE ?)'); params.push(`%${p.keyword}%`, `%${p.keyword}%`); }
  if (p.category) { conds.push('s.category = ?'); params.push(p.category); }
  if (p.status) { conds.push('s.status = ?'); params.push(p.status); }
  const where = ` FROM souvenir s LEFT JOIN travel_product r ON r.id = s.link_route_id WHERE ${conds.join(' AND ')}`;
  reply(res, await list(pool, `SELECT ${souvenirFields}${where}`, `SELECT COUNT(*) AS total FROM souvenir s WHERE ${conds.join(' AND ')}`, params, p));
}));

const souvenirInput = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(['特色食品', '手工艺品', '茶饮', '其他']).default('特色食品'),
  link_route_id: id.nullable().optional(),
  price: z.coerce.number().min(0).max(999999),
  stock: z.coerce.number().int().min(0).max(1000000),
  description: z.string().max(2000).optional()
}).strict();

agencyExt.post('/admin/specialties', requireAction('route:souvenir', 'add'), run(async (req, res) => {
  const body = souvenirInput.parse(req.body);
  const user = agencyOf(req);
  const no = `sou_${Date.now().toString(36)}`;
  await write(req, res, async (conn) => {
    await conn.query(
      `INSERT INTO souvenir (product_no, agency_id, name, category, link_route_id, price, stock, status, description, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [no, user.agency_id, body.name, body.category, body.link_route_id ?? null, body.price, body.stock, 'OFF_SALE', body.description ?? null, user.id]);
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${souvenirFields} FROM souvenir s LEFT JOIN travel_product r ON r.id=s.link_route_id WHERE s.product_no=?`, [no]);
    await audit(conn, user.id, user.nickname, '新建特产', 'souvenir', no, body.name);
    return { data: rows[0], status: 201 };
  });
}));

agencyExt.put('/admin/specialties/:id', requireAction('route:souvenir', 'update'), run(async (req, res) => {
  const spuId = id.parse(req.params.id);
  const body = souvenirInput.partial().parse(req.body);
  const user = agencyOf(req);
  await write(req, res, async (conn) => {
    const [own] = await conn.query<RowDataPacket[]>('SELECT id, product_no FROM souvenir WHERE id=? AND agency_id=?', [spuId, user.agency_id]);
    if (!own.length) throw new ApiError(404, 20016, '特产不存在或无权操作');
    await conn.query(
      `UPDATE souvenir SET name=?, category=?, link_route_id=?, price=?, stock=?, description=? WHERE id=?`,
      [body.name, body.category, body.link_route_id ?? null, body.price, body.stock, body.description ?? null, spuId]);
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${souvenirFields} FROM souvenir s LEFT JOIN travel_product r ON r.id=s.link_route_id WHERE s.id=?`, [spuId]);
    await audit(conn, user.id, user.nickname, '编辑特产', 'souvenir', String(own[0].product_no), '');
    return { data: rows[0] };
  });
}));

agencyExt.patch('/admin/specialties/:id', requireAction('route:souvenir', 'delete'), run(async (req, res) => {
  const spuId = id.parse(req.params.id);
  const body = z.object({ status: z.enum(['ON_SALE', 'OFF_SALE']) }).strict().parse(req.body);
  const user = agencyOf(req);
  await write(req, res, async (conn) => {
    const [rs] = await conn.query<ResultSetHeader>('UPDATE souvenir SET status=? WHERE id=? AND agency_id=?', [body.status, spuId, user.agency_id]);
    if (!rs.affectedRows) throw new ApiError(404, 20016, '特产不存在或无权操作');
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${souvenirFields} FROM souvenir s LEFT JOIN travel_product r ON r.id=s.link_route_id WHERE s.id=?`, [spuId]);
    return { data: rows[0] };
  });
}));

agencyExt.post('/admin/specialties/:id/submit', requireAction('route:souvenir', 'update'), run(async (req, res) => {
  const spuId = id.parse(req.params.id);
  const user = agencyOf(req);
  await write(req, res, async (conn) => {
    const [rs] = await conn.query<ResultSetHeader>(`UPDATE souvenir SET audit_status='PENDING', audit_remark=NULL WHERE id=? AND agency_id=?`, [spuId, user.agency_id]);
    if (!rs.affectedRows) throw new ApiError(404, 20016, '特产不存在或无权操作');
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${souvenirFields} FROM souvenir s LEFT JOIN travel_product r ON r.id=s.link_route_id WHERE s.id=?`, [spuId]);
    return { data: rows[0] };
  });
}));

// ---------------------------------------------------------------------------
// 客户管理（与本社产生过下单行为的游客）
// ---------------------------------------------------------------------------

agencyExt.get('/admin/customers', requireAction('customer:customer', 'query'), run(async (req, res) => {
  const p = page(req.query, ['last_order_at', 'total_spend'], {
    keyword: z.string().max(50).optional()
  });
  const conds = [`u.role = 'TOURIST'`,
    `EXISTS (SELECT 1 FROM tour_order o JOIN travel_product p2 ON p2.id=o.product_id WHERE o.user_id=u.id AND p2.agency_id = ?)`];
  const params: unknown[] = [agencyOf(req).agency_id];
  if (p.keyword) {
    conds.push('(u.nickname LIKE ? OR u.phone LIKE ?)');
    params.push(`%${p.keyword}%`, `%${p.keyword}%`);
  }
  const where = ` WHERE ${conds.join(' AND ')}`;
  const data = await list(pool,
    `SELECT u.id AS user_id, u.nickname, u.phone AS masked_phone, u.default_departure_city AS departure_city,
       u.created_at AS register_time,
       (SELECT COUNT(*) FROM tour_order o JOIN travel_product p2 ON p2.id=o.product_id WHERE o.user_id=u.id AND p2.agency_id=? AND o.status <> 'CANCELLED') AS total_orders,
       (SELECT COALESCE(SUM(o.total_amount),0) FROM tour_order o JOIN travel_product p2 ON p2.id=o.product_id WHERE o.user_id=u.id AND p2.agency_id=? AND o.status IN ('PAID','CONFIRMED','COMPLETED')) AS total_spend,
       (SELECT MAX(o.created_at) FROM tour_order o JOIN travel_product p2 ON p2.id=o.product_id WHERE o.user_id=u.id AND p2.agency_id=?) AS last_order_at,
       (SELECT GROUP_CONCAT(DISTINCT pt.tag_value) FROM preference_tag pt JOIN travel_preference tp ON tp.id=pt.preference_id JOIN chat_session cs ON cs.id=tp.session_id WHERE cs.user_id=u.id AND pt.tag_type='INTEREST') AS preference_tags
     FROM sys_user u${where}`,
    `SELECT COUNT(*) AS total FROM sys_user u${where}`,
    [agencyOf(req).agency_id, agencyOf(req).agency_id, agencyOf(req).agency_id, ...params], p);
  const rows = data.list.map((r: RowDataPacket) => ({
    ...r,
    masked_phone: maskMobile(r.masked_phone),
    preference_tags: r.preference_tags ? String(r.preference_tags).split(',') : []
  }));
  reply(res, { ...data, list: rows });
}));

agencyExt.get('/admin/customers/:id', requireAction('customer:customer', 'query'), run(async (req, res) => {
  const userId = id.parse(req.params.id);
  const agencyId = agencyOf(req).agency_id;
  const [users] = await pool.query<RowDataPacket[]>(
    `SELECT u.id AS user_id, u.nickname, u.phone, u.default_departure_city AS departure_city, u.created_at AS register_time
      FROM sys_user u
      WHERE u.id=? AND u.role='TOURIST'
        AND EXISTS (SELECT 1 FROM tour_order o JOIN travel_product p2 ON p2.id=o.product_id WHERE o.user_id=u.id AND p2.agency_id=?)`,
    [userId, agencyId]);
  if (!users.length) throw new ApiError(404, 20016, '客户不存在或与本社无交集');
  const [orders] = await pool.query<RowDataPacket[]>(
    `SELECT o.order_no, p.title AS route_title, o.traveler_count AS people_count, o.total_amount AS amount, o.status, o.created_at
      FROM tour_order o JOIN travel_product p ON p.id=o.product_id
      WHERE o.user_id=? AND p.agency_id=? ORDER BY o.created_at DESC LIMIT 20`, [userId, agencyId]);
  const [tags] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT pt.tag_value FROM preference_tag pt
       JOIN travel_preference tp ON tp.id=pt.preference_id
       JOIN chat_session cs ON cs.id=tp.session_id
      WHERE cs.user_id=? AND pt.tag_type='INTEREST'`, [userId]);
  const [dests] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT pd.city_name FROM preference_destination pd
       JOIN travel_preference tp ON tp.id=pd.preference_id
       JOIN chat_session cs ON cs.id=tp.session_id
      WHERE cs.user_id=?`, [userId]);
  const [notes] = await pool.query<RowDataPacket[]>('SELECT note FROM agency_customer_note WHERE agency_id=? AND user_id=?', [agencyId, userId]);
  reply(res, {
    ...users[0], phone: maskMobile(users[0].phone),
    orders, preference_tags: tags.map((t) => t.tag_value),
    preference_destinations: dests.map((d) => d.city_name),
    follow_up_note: notes[0]?.note ?? ''
  });
}));

agencyExt.put('/admin/customers/:id/note', requireAction('customer:customer', 'update'), run(async (req, res) => {
  const userId = id.parse(req.params.id);
  const body = z.object({ note: z.string().min(0).max(500) }).strict().parse(req.body);
  await write(req, res, async (conn) => {
    await conn.query(
      `INSERT INTO agency_customer_note (agency_id, user_id, note) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE note=VALUES(note)`,
      [agencyOf(req).agency_id, userId, body.note]);
    return { data: { user_id: String(userId), note: body.note } };
  });
}));

// ---------------------------------------------------------------------------
// 导游与团队管理
// ---------------------------------------------------------------------------

const guideFields = `g.id, g.id AS guide_id, g.agency_id, g.name, g.gender, g.phone AS masked_phone, g.license_no,
  g.specialty, g.bio, g.status, g.team_count, g.rating, g.created_at, g.updated_at`;

agencyExt.get('/admin/guides', requireAction('guide:guide', 'query'), run(async (req, res) => {
  const p = page(req.query, ['team_count', 'rating', 'created_at'], {
    keyword: z.string().max(50).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    specialty: z.string().max(30).optional()
  });
  const conds = ['g.agency_id = ?'];
  const params: unknown[] = [agencyOf(req).agency_id];
  if (p.keyword) { conds.push('(g.name LIKE ? OR g.license_no LIKE ?)'); params.push(`%${p.keyword}%`, `%${p.keyword}%`); }
  if (p.status) { conds.push('g.status = ?'); params.push(p.status); }
  if (p.specialty) { conds.push('g.specialty LIKE ?'); params.push(`%${p.specialty}%`); }
  const where = ` FROM guide g WHERE ${conds.join(' AND ')}`;
  const data = await list(pool, `SELECT ${guideFields}${where}`, `SELECT COUNT(*) AS total FROM guide g WHERE ${conds.join(' AND ')}`, params, p);
  reply(res, { ...data, list: data.list.map((r: RowDataPacket) => ({ ...r, masked_phone: maskMobile(r.masked_phone) })) });
}));

const guideInput = z.object({
  name: z.string().min(1).max(50),
  gender: z.enum(['男', '女']).default('男'),
  phone: z.string().regex(/^1\d{10}$/),
  license_no: z.string().min(4).max(32),
  specialty: z.string().max(50).optional(),
  bio: z.string().max(500).optional()
}).strict();

agencyExt.post('/admin/guides', requireAction('guide:guide', 'add'), run(async (req, res) => {
  const body = guideInput.parse(req.body);
  const user = agencyOf(req);
  await write(req, res, async (conn) => {
    try {
      const [rs] = await conn.query<ResultSetHeader>(
        `INSERT INTO guide (agency_id, name, gender, phone, license_no, specialty, bio, status) VALUES (?,?,?,?,?,?,?,'ACTIVE')`,
        [user.agency_id, body.name, body.gender, body.phone, body.license_no, body.specialty ?? null, body.bio ?? null]);
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${guideFields} FROM guide g WHERE g.id=?`, [rs.insertId]);
      await audit(conn, user.id, user.nickname, '新增导游', 'guide', body.license_no, body.name);
      return { data: { ...rows[0], masked_phone: maskMobile(rows[0].masked_phone) }, status: 201 };
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new ApiError(409, 20015, '该导游证号已登记');
      throw err;
    }
  });
}));

agencyExt.put('/admin/guides/:id', requireAction('guide:guide', 'update'), run(async (req, res) => {
  const guideId = id.parse(req.params.id);
  const body = guideInput.partial().parse(req.body);
  const user = agencyOf(req);
  // 仅更新显式传入的字段，避免 undefined 直接绑参导致 SQL 异常 / 误清空
  const editable = ['name', 'gender', 'phone', 'license_no', 'specialty', 'bio'] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of editable) {
    if (body[key] !== undefined) { sets.push(`${key}=?`); params.push(body[key]); }
  }
  if (!sets.length) throw new ApiError(400, 10001, '没有需要更新的字段');
  await write(req, res, async (conn) => {
    const [rs] = await conn.query<ResultSetHeader>(
      `UPDATE guide SET ${sets.join(', ')} WHERE id=? AND agency_id=?`,
      [...params, guideId, user.agency_id]);
    if (!rs.affectedRows) throw new ApiError(404, 20016, '导游不存在或无权操作');
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${guideFields} FROM guide g WHERE g.id=?`, [guideId]);
    return { data: { ...rows[0], masked_phone: maskMobile(rows[0].masked_phone) } };
  });
}));

agencyExt.patch('/admin/guides/:id', requireAction('guide:guide', 'delete'), run(async (req, res) => {
  const guideId = id.parse(req.params.id);
  const body = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).strict().parse(req.body);
  const user = agencyOf(req);
  await write(req, res, async (conn) => {
    const [rs] = await conn.query<ResultSetHeader>('UPDATE guide SET status=? WHERE id=? AND agency_id=?', [body.status, guideId, user.agency_id]);
    if (!rs.affectedRows) throw new ApiError(404, 20016, '导游不存在或无权操作');
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${guideFields} FROM guide g WHERE g.id=?`, [guideId]);
    return { data: { ...rows[0], masked_phone: maskMobile(rows[0].masked_phone) } };
  });
}));

const teamFields = `t.id, t.id AS team_id, t.team_no, t.agency_id, t.route_id, r.title AS route_title, t.travel_date,
  t.guide_id, g.name AS guide_name, t.max_members,
  (SELECT COALESCE(SUM(m.people_count),0) FROM tour_team_member m WHERE m.team_id=t.id) AS member_count,
  t.status, t.remark, t.created_at, t.updated_at`;

agencyExt.get('/admin/teams', requireAction('team:team', 'query'), run(async (req, res) => {
  const p = page(req.query, ['travel_date', 'created_at'], {
    status: z.enum(['RECRUITING', 'FULL', 'DEPARTED', 'FINISHED']).optional(),
    route_id: id.optional()
  });
  const conds = ['t.agency_id = ?'];
  const params: unknown[] = [agencyOf(req).agency_id];
  if (p.status) { conds.push('t.status = ?'); params.push(p.status); }
  if (p.route_id) { conds.push('t.route_id = ?'); params.push(p.route_id); }
  const where = ` FROM tour_team t LEFT JOIN travel_product r ON r.id=t.route_id LEFT JOIN guide g ON g.id=t.guide_id WHERE ${conds.join(' AND ')}`;
  reply(res, await list(pool, `SELECT ${teamFields}${where}`, `SELECT COUNT(*) AS total FROM tour_team t WHERE ${conds.join(' AND ')}`, params, p));
}));

agencyExt.get('/admin/teams/:no/members', requireAction('team:team', 'query'), run(async (req, res) => {
  const teamNo = z.string().max(32).parse(req.params.no);
  const [teams] = await pool.query<RowDataPacket[]>('SELECT id FROM tour_team WHERE team_no=? AND agency_id=?', [teamNo, agencyOf(req).agency_id]);
  if (!teams.length) throw new ApiError(404, 20016, '团队不存在或无权查看');
  const [members] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.order_id, o.order_no, m.member_name, m.member_phone, m.people_count
      FROM tour_team_member m LEFT JOIN tour_order o ON o.id=m.order_id WHERE m.team_id=? ORDER BY m.id`, [teams[0].id]);
  reply(res, {
    list: members.map((m) => ({ ...m, member_phone: maskMobile(m.member_phone) })),
    total: members.length, has_more: false
  });
}));

agencyExt.post('/admin/teams', requireAction('team:team', 'add'), run(async (req, res) => {
  const body = z.object({
    route_id: id,
    travel_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    max_members: z.coerce.number().int().min(1).max(100).default(20),
    remark: z.string().max(255).optional()
  }).strict().parse(req.body);
  const user = agencyOf(req);
  const teamNo = `T-${body.travel_date.replaceAll('-', '')}-${Date.now().toString().slice(-2)}`;
  await write(req, res, async (conn) => {
    const [route] = await conn.query<RowDataPacket[]>('SELECT id FROM travel_product WHERE id=? AND agency_id=?', [body.route_id, user.agency_id]);
    if (!route.length) throw new ApiError(404, 20016, '线路不存在或无权操作');
    await conn.query(
      `INSERT INTO tour_team (team_no, agency_id, route_id, travel_date, max_members, status, remark) VALUES (?,?,?,?,?, 'RECRUITING', ?)`,
      [teamNo, user.agency_id, body.route_id, body.travel_date, body.max_members, body.remark ?? null]);
    // 自动收编该线路该日期的已支付/已确认订单成员
    await conn.query(
      `INSERT IGNORE INTO tour_team_member (team_id, order_id, member_name, member_phone, people_count)
       SELECT t.id, o.id, o.contact_name, o.contact_phone, o.traveler_count
         FROM tour_team t, tour_order o
        WHERE t.team_no=? AND o.product_id=? AND o.travel_date=? AND o.status IN ('PAID','CONFIRMED')`,
      [teamNo, body.route_id, body.travel_date]);
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${teamFields} FROM tour_team t LEFT JOIN travel_product r ON r.id=t.route_id LEFT JOIN guide g ON g.id=t.guide_id WHERE t.team_no=?`, [teamNo]);
    await audit(conn, user.id, user.nickname, '创建团队', 'team', teamNo, body.travel_date);
    return { data: rows[0], status: 201 };
  });
}));

agencyExt.put('/admin/teams/:no', requireAction('team:team', 'update'), run(async (req, res) => {
  const teamNo = z.string().max(32).parse(req.params.no);
  const body = z.object({
    guide_id: id.nullable().optional(),
    status: z.enum(['RECRUITING', 'FULL', 'DEPARTED', 'FINISHED']).optional(),
    max_members: z.coerce.number().int().min(1).max(100).optional()
  }).strict().parse(req.body);
  const user = agencyOf(req);
  await write(req, res, async (conn) => {
    const [teams] = await conn.query<RowDataPacket[]>('SELECT id, guide_id, status, max_members FROM tour_team WHERE team_no=? AND agency_id=? FOR UPDATE', [teamNo, user.agency_id]);
    if (!teams.length) throw new ApiError(404, 20016, '团队不存在或无权操作');
    if (body.guide_id !== undefined && body.guide_id !== null) {
      const [g] = await conn.query<RowDataPacket[]>('SELECT id, status FROM guide WHERE id=? AND agency_id=?', [body.guide_id, user.agency_id]);
      if (!g.length) throw new ApiError(404, 20016, '导游不存在或无权指派');
      if (g[0].status !== 'ACTIVE') throw new ApiError(409, 20010, '该导游已停用，不可指派新团队');
    }
    // 状态只允许沿 待成团 → 已成团 → 出行中 → 已结束 单向流转（不允许回退）
    const FLOW: Record<string, string[]> = { RECRUITING: ['FULL', 'DEPARTED', 'FINISHED'], FULL: ['DEPARTED', 'FINISHED'], DEPARTED: ['FINISHED'], FINISHED: [] };
    if (body.status && body.status !== teams[0].status) {
      const allowedNext = FLOW[teams[0].status as string] || [];
      if (!allowedNext.includes(body.status)) {
        throw new ApiError(409, 20010, `团队状态不可从 ${teams[0].status} 变更为 ${body.status}`);
      }
    }
    const nextMax = body.max_members ?? Number(teams[0].max_members);
    const [memberSum] = await conn.query<RowDataPacket[]>('SELECT COALESCE(SUM(people_count),0) AS n FROM tour_team_member WHERE team_id=?', [teams[0].id]);
    if (Number(memberSum[0].n) > nextMax) {
      throw new ApiError(409, 20010, `人数上限不可低于已收编的 ${memberSum[0].n} 人`);
    }
    await conn.query(
      `UPDATE tour_team SET guide_id=?, status=?, max_members=? WHERE id=?`,
      [body.guide_id ?? teams[0].guide_id, body.status ?? teams[0].status, nextMax, teams[0].id]);
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${teamFields} FROM tour_team t LEFT JOIN travel_product r ON r.id=t.route_id LEFT JOIN guide g ON g.id=t.guide_id WHERE t.team_no=?`, [teamNo]);
    await audit(conn, user.id, user.nickname, '调整团队', 'team', teamNo, body.status ?? '指派导游');
    return { data: rows[0] };
  });
}));

// ---------------------------------------------------------------------------
// 财务管理（只读汇总）
// ---------------------------------------------------------------------------

agencyExt.get('/admin/finance/summary', requireAction('finance:agency', 'query'), run(async (_req, res) => {
  const agencyId = agencyOf(_req).agency_id;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN o.status='PAID' THEN o.total_amount END),0) AS pending_confirm_amount,
       COALESCE(SUM(CASE WHEN o.status='PAID' THEN 1 END),0) AS pending_confirm_count,
       COALESCE(SUM(CASE WHEN o.status IN ('CONFIRMED','COMPLETED') AND o.settlement_id IS NULL THEN o.total_amount END),0) AS unsettled_amount,
       COALESCE(SUM(CASE WHEN o.settlement_id IS NOT NULL AND o.status IN ('CONFIRMED','COMPLETED') THEN o.total_amount END),0) AS settled_amount,
       COALESCE(SUM(CASE WHEN o.status='REFUNDED' THEN o.total_amount END),0) AS refunded_amount,
       COALESCE(SUM(CASE WHEN o.status='REFUNDED' THEN 1 END),0) AS refunded_count
     FROM tour_order o JOIN travel_product p ON p.id=o.product_id
     WHERE p.agency_id=?`, [agencyId]);
  reply(res, rows[0]);
}));

agencyExt.get('/admin/finance/flows', requireAction('finance:agency', 'query'), run(async (req, res) => {
  const p = page(req.query, ['created_at', 'total_amount'], {
    status: z.enum(['PENDING', 'PAID', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'REFUNDED']).optional()
  });
  const conds = ['p.agency_id = ?', "o.status IN ('PAID','CONFIRMED','COMPLETED','REFUNDED')"];
  const params: unknown[] = [agencyOf(req).agency_id];
  if (p.status) { conds.push('o.status = ?'); params.push(p.status); }
  const where = ` FROM tour_order o JOIN travel_product p ON p.id=o.product_id LEFT JOIN settlement st ON st.id=o.settlement_id WHERE ${conds.join(' AND ')}`;
  const data = await list(pool,
    `SELECT o.order_no, p.title AS route_title, o.traveler_count AS people_count, o.total_amount AS amount,
       o.status, o.created_at, o.paid_at, st.settlement_no, st.period_label,
       CASE WHEN o.settlement_id IS NULL THEN 'PENDING' ELSE st.status END AS settle_status
       ${where}`,
    `SELECT COUNT(*) AS total ${where}`, params, p, { tieBreaker: 'o.id' });
  reply(res, { ...data, list: data.list.map(maskOrder) });
}));

// ---------------------------------------------------------------------------
// B 端工作台大盘
// ---------------------------------------------------------------------------

agencyExt.get('/admin/dashboard', requireAction('order:manage', 'query'), run(async (_req, res) => {
  const agencyId = agencyOf(_req).agency_id;
  const [kpiRows] = await pool.query<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM travel_product WHERE agency_id=? AND status='ON_SALE') AS onsale_count,
      (SELECT COUNT(*) FROM travel_product WHERE agency_id=? AND status='DRAFT') AS draft_count,
      (SELECT COUNT(*) FROM tour_order o JOIN travel_product p ON p.id=o.product_id
         WHERE p.agency_id=? AND o.created_at >= CURDATE() AND o.status <> 'CANCELLED') AS today_orders,
      (SELECT COUNT(*) FROM tour_order o JOIN travel_product p ON p.id=o.product_id
         WHERE p.agency_id=? AND o.status='PAID') AS pending_confirms,
      (SELECT COALESCE(SUM(o.total_amount),0) FROM tour_order o JOIN travel_product p ON p.id=o.product_id
         WHERE p.agency_id=? AND o.created_at >= CURDATE() AND o.status IN ('PAID','CONFIRMED','COMPLETED')) AS today_amount,
      (SELECT IFNULL(ROUND(SUM(p.order_count)/GREATEST(SUM(p.visitor_count),1)*100,1),0)
         FROM travel_product p WHERE p.agency_id=?) AS conversion_rate
  `, [agencyId, agencyId, agencyId, agencyId, agencyId, agencyId]);
  const [trend] = await pool.query<RowDataPacket[]>(`
    SELECT d.day,
      COALESCE(v.visits,0) AS visits, COALESCE(pl.plans,0) AS plans, COALESCE(od.orders,0) AS orders
      FROM (SELECT DATE_SUB(CURDATE(), INTERVAL seq DAY) AS day
              FROM (SELECT (@sd := @sd + 1) AS seq FROM information_schema.columns, (SELECT @sd := -1) init LIMIT 14) x) d
      LEFT JOIN (SELECT DATE(e.occurred_at) AS day, COUNT(*) AS visits
                   FROM product_stat_event e JOIN travel_product p ON p.id=e.product_id
                   WHERE p.agency_id=? AND e.event_type='VISIT' AND e.occurred_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
                   GROUP BY DATE(e.occurred_at)) v ON v.day=d.day
      LEFT JOIN (SELECT DATE(e.occurred_at) AS day, COUNT(*) AS plans
                   FROM product_stat_event e JOIN travel_product p ON p.id=e.product_id
                   WHERE p.agency_id=? AND e.event_type='PLAN_GENERATED' AND e.occurred_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
                   GROUP BY DATE(e.occurred_at)) pl ON pl.day=d.day
      LEFT JOIN (SELECT DATE(e.occurred_at) AS day, COUNT(*) AS orders
                   FROM product_stat_event e JOIN travel_product p ON p.id=e.product_id
                   WHERE p.agency_id=? AND e.event_type='ORDER' AND e.occurred_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
                   GROUP BY DATE(e.occurred_at)) od ON od.day=d.day
     ORDER BY d.day`, [agencyId, agencyId, agencyId]);
  const [topProducts] = await pool.query<RowDataPacket[]>(`
    SELECT id AS route_id, product_no, title, destination, style_tag, base_price_rmb,
       visitor_count, plans_generated_count, order_count, conversion_rate, status
      FROM travel_product WHERE agency_id=? AND status <> 'DRAFT'
      ORDER BY conversion_rate DESC, order_count DESC LIMIT 5`, [agencyId]);
  const [todoOrders] = await pool.query<RowDataPacket[]>(`
    SELECT o.id AS order_id, o.order_no, p.title AS route_title, o.traveler_count AS people_count,
       o.total_amount AS amount, o.status, o.created_at
      FROM tour_order o JOIN travel_product p ON p.id=o.product_id
      WHERE p.agency_id=? AND o.status='PAID' ORDER BY o.paid_at ASC LIMIT 5`, [agencyId]);
  const [todoStock] = await pool.query<RowDataPacket[]>(`
    SELECT rs.route_id, p.title, rs.travel_date, rs.total_seats,
       rs.total_seats - rs.locked_seats - rs.sold_seats AS available_seats
      FROM route_stock rs JOIN travel_product p ON p.id=rs.route_id
      WHERE p.agency_id=? AND rs.travel_date >= CURDATE()
        AND rs.total_seats - rs.locked_seats - rs.sold_seats <= 5
      ORDER BY rs.travel_date ASC LIMIT 5`, [agencyId]);
  const [recentOrders] = await pool.query<RowDataPacket[]>(`
    SELECT o.id AS order_id, o.order_no, p.title AS route_title, o.traveler_count AS people_count,
       o.total_amount AS amount, o.status, o.contact_phone, o.created_at
      FROM tour_order o JOIN travel_product p ON p.id=o.product_id
      WHERE p.agency_id=? ORDER BY o.created_at DESC LIMIT 6`, [agencyId]);
  reply(res, {
    kpi: kpiRows[0], trend,
    top_products: topProducts,
    todos: { pending_orders: todoOrders.map(maskOrder), low_stock: todoStock },
    recent_orders: recentOrders.map(maskOrder)
  });
}));

// ---------------------------------------------------------------------------
// AI 智能规划：自然语言 → 服务端解析意图 → 生成行程草稿
// （与 C 端 POST /plans 同一持久化；区别在于 destination/dates 由服务端解析，
//   体现「业务逻辑在后端」的三端约定）
// ---------------------------------------------------------------------------

agencyExt.post('/admin/plan-drafts', requireAction('itinerary:plan', 'add'), run(async (req, res) => {
  const body = z.object({ message: z.string().min(4).max(500) }).strict().parse(req.body);
  const user = agencyOf(req);

  // 服务端意图解析（目的地/天数/预算）——解析失败返回 10001，由前端原样展示
  const msg = body.message;
  const daysMatch = msg.match(/(\d+)\s*天/);
  const budgetMatch = msg.match(/预算\s*([3-9]\d{3,5}|[1-9]\d{4,5})/);
  let destination: string | null = null;
  const destMatch = msg.match(/(?:去|到|在|游|探索|规划|前往)([\u4e00-\u9fa5]{2,6})/);
  if (destMatch) {
    destination = destMatch[1].replace(/(一次|旅行|之旅|线路|行程|深度游|亲子游|自驾游)$/, '');
  }
  if (!destination) throw new ApiError(400, 10001, '未能识别目的地，请在需求中写明，例如「帮我规划云南大理 5 天的线路，预算 6000」');
  const days = Math.min(15, Math.max(2, Number(daysMatch?.[1]) || 4));
  const budget = budgetMatch ? budgetMatch[1] : '3000';

  const start = new Date(Date.now() + 7 * 86400000);
  const end = new Date(start.getTime() + (days - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10) + 'T00:00:00Z';

  await write(req, res, async (conn) => {
    const preference = await plannerAgent.extractPreferenceFromText(msg);
    preference.destinationCities = [destination];
    preference.daysCount = days;
    preference.nightsCount = days - 1;
    preference.budgetTotalRmb = Number(budget);
    preference.travelStyle = '旅行社策划';
    const plan = await plannerAgent.generatePlan(preference);
    plan.itineraryId = generateUlid();
    plan.days.forEach((day: { dateString?: string }, i: number) => { day.dateString = new Date(start.getTime() + i * 86400000).toISOString(); });
    const snapshot = { ...serialize(plan), plan_id: plan.itineraryId, start_date: iso(start), end_date: iso(end), is_estimated: true };
    await conn.query(
      `INSERT INTO itinerary(itinerary_no,user_id,title,summary,status,days_count,nights_count,start_date,end_date,total_budget_rmb,is_estimated)
       VALUES (?,?,?,?,'PENDING_CONFIRM',?,?,?,?,?,1)`,
      [plan.itineraryId, user.id, String(plan.planTitle).slice(0, 100), String(plan.summaryDescription).slice(0, 500), days, days - 1,
        iso(start).slice(0, 10), iso(end).slice(0, 10), budget]);
    await conn.query(
      `INSERT INTO itinerary_version(itinerary_id,version,change_type,snapshot,created_by)
       SELECT id,1,'GENERATE',?,user_id FROM itinerary WHERE itinerary_no=?`,
      [JSON.stringify(snapshot), plan.itineraryId]);
    return { data: { ...snapshot, version: 1, status: 'PENDING_CONFIRM', parsed: { destination, days, budget } }, status: 201 };
  });
}));

// ---------------------------------------------------------------------------
// 线路库存（管理端视角：任意状态线路 + 未来 14 天批量视图）
// ---------------------------------------------------------------------------

agencyExt.get('/admin/routes/:id/stock', requireAction('route:line', 'query'), run(async (req, res) => {
  const routeId = id.parse(req.params.id);
  const [routes] = await pool.query<RowDataPacket[]>(
    'SELECT id, title, status FROM travel_product WHERE id=? AND agency_id=?', [routeId, agencyOf(req).agency_id]);
  if (!routes.length) throw new ApiError(404, 20016, '线路不存在或无权查看');
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT rs.travel_date, rs.total_seats, rs.locked_seats, rs.sold_seats,
      rs.total_seats - rs.locked_seats - rs.sold_seats AS available_seats
      FROM route_stock rs WHERE rs.route_id=? AND rs.travel_date >= CURDATE()
      ORDER BY rs.travel_date ASC LIMIT 14`, [routeId]);
  reply(res, { route_id: String(routeId), title: routes[0].title, dates: rows });
}));

agencyExt.put('/admin/routes/:id/stock', requireAction('route:line', 'update'), run(async (req, res) => {
  const routeId = id.parse(req.params.id);
  const body = z.object({
    travel_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    total_seats: z.coerce.number().int().min(0).max(1000)
  }).strict().parse(req.body);
  const user = agencyOf(req);
  await write(req, res, async (conn) => {
    const [routes] = await conn.query<RowDataPacket[]>(
      'SELECT id FROM travel_product WHERE id=? AND agency_id=?', [routeId, user.agency_id]);
    if (!routes.length) throw new ApiError(404, 20016, '线路不存在或无权操作');
    const [current] = await conn.query<RowDataPacket[]>(
      'SELECT total_seats, locked_seats, sold_seats FROM route_stock WHERE route_id=? AND travel_date=? FOR UPDATE',
      [routeId, body.travel_date]);
    if (current.length && body.total_seats < Number(current[0].locked_seats) + Number(current[0].sold_seats)) {
      throw new ApiError(409, 20010, `该日期已有 ${Number(current[0].locked_seats) + Number(current[0].sold_seats)} 席被占用，名额不能低于已占用量`);
    }
    await conn.query(
      `INSERT INTO route_stock (route_id, travel_date, total_seats, locked_seats, sold_seats)
       VALUES (?,?,?,0,0) ON DUPLICATE KEY UPDATE total_seats=VALUES(total_seats)`,
      [routeId, body.travel_date, body.total_seats]);
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT travel_date, total_seats, locked_seats, sold_seats, total_seats-locked_seats-sold_seats AS available_seats FROM route_stock WHERE route_id=? AND travel_date=?',
      [routeId, body.travel_date]);
    await audit(conn, user.id, user.nickname, '设置库存名额', 'route', String(routeId), `${body.travel_date} 名额 ${body.total_seats}`);
    return { data: rows[0] };
  });
}));

// ---------------------------------------------------------------------------
// 旅行社设置
// ---------------------------------------------------------------------------

agencyExt.get('/admin/settings', requireAction('agency:member', 'query'), run(async (_req, res) => {
  const agencyId = agencyOf(_req).agency_id;
  const [agencies] = await pool.query<RowDataPacket[]>(
    `SELECT id AS agency_id, agency_name, license_no, contact_name, contact_phone, status, intro, notify_prefs, created_at
      FROM travel_agency WHERE id=?`, [agencyId]);
  if (!agencies.length) throw new ApiError(404, 20016, '机构不存在');
  const [members] = await pool.query<RowDataPacket[]>(
    `SELECT u.id AS user_id, u.username, u.nickname, u.status, u.last_login_at, r.name AS role_name
      FROM sys_user u
      LEFT JOIN sys_user_role ur ON ur.user_id=u.id
      LEFT JOIN sys_role r ON r.id=ur.role_id
      WHERE u.agency_id=? AND u.role='ADMIN' ORDER BY u.id`, [agencyId]);
  const [dict] = await pool.query<RowDataPacket[]>(
    `SELECT dict_type, dict_key, dict_value FROM sys_dict WHERE dict_type IN ('style_tag','departure_city') ORDER BY dict_type, sort`);
  const [logs] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(operator_name, CAST(COALESCE(actor_id, operator_id) AS CHAR)) AS operator_name,
       action, COALESCE(object_no, resource_id) AS object_no, created_at
      FROM sys_audit_log ORDER BY created_at DESC LIMIT 10`);
  reply(res, { ...agencies[0], members, dict, audit_logs: logs });
}));

agencyExt.put('/admin/settings', requireAction('agency:settings', 'update'), run(async (req, res) => {
  const body = z.object({
    agency_name: z.string().min(1).max(100),
    contact_name: z.string().max(50).optional(),
    contact_phone: z.string().max(20).optional(),
    intro: z.string().max(500).optional(),
    notify_prefs: z.object({
      new_order: z.boolean(), pending_warn: z.boolean(),
      stock_warn: z.boolean(), daily_report: z.boolean()
    }).partial().strict().optional()
  }).strict().parse(req.body);
  const user = agencyOf(req);
  await write(req, res, async (conn) => {
    await conn.query(
      `UPDATE travel_agency SET agency_name=?, contact_name=?, contact_phone=?, intro=?,
         notify_prefs=COALESCE(JSON_MERGE_PATCH(COALESCE(notify_prefs,'{}'), CAST(? AS JSON)), notify_prefs)
       WHERE id=?`,
      [body.agency_name, body.contact_name ?? null, body.contact_phone ?? null, body.intro ?? null,
        body.notify_prefs ? JSON.stringify(body.notify_prefs) : null, user.agency_id]);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id AS agency_id, agency_name, license_no, contact_name, contact_phone, intro, notify_prefs FROM travel_agency WHERE id=?`, [user.agency_id]);
    await audit(conn, user.id, user.nickname, '保存本社资料', 'agency', String(user.agency_id), body.agency_name);
    return { data: rows[0] };
  });
}));

const memberInput = z.object({
  username: z.string().min(3).max(50).regex(/^[A-Za-z0-9_]+$/),
  nickname: z.string().min(1).max(50),
  password: z.string().min(8).max(72),
  phone: z.string().regex(/^1\d{10}$/).optional()
}).strict();

agencyExt.post('/admin/members', requireAction('agency:member', 'add'), run(async (req, res) => {
  const body = memberInput.parse(req.body);
  const user = agencyOf(req);
  const { hashPassword } = await import('../auth/security.js');
  await write(req, res, async (conn) => {
    try {
      const [rs] = await conn.query<ResultSetHeader>(
        `INSERT INTO sys_user (agency_id, username, password_hash, nickname, phone, role) VALUES (?,?,?,?,?,'ADMIN')`,
        [user.agency_id, body.username, hashPassword(body.password), body.nickname, body.phone ?? null]);
      await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, 4)', [rs.insertId]);
      await audit(conn, user.id, user.nickname, '新增社内成员', 'user', body.username, body.nickname);
      return { data: { user_id: String(rs.insertId), username: body.username, nickname: body.nickname }, status: 201 };
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new ApiError(409, 20015, '登录名或手机号已存在');
      throw err;
    }
  });
}));

agencyExt.patch('/admin/members/:id', requireAction('agency:member', 'update'), run(async (req, res) => {
  const userId = id.parse(req.params.id);
  const body = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).strict().parse(req.body);
  const user = agencyOf(req);
  await write(req, res, async (conn) => {
    const [rs] = await conn.query<ResultSetHeader>(
      `UPDATE sys_user SET status=? WHERE id=? AND agency_id=? AND role='ADMIN' AND id <> ?`,
      [body.status, userId, user.agency_id, user.id]);
    if (!rs.affectedRows) throw new ApiError(404, 20016, '成员不存在、无权操作或不可操作本人');
    await audit(conn, user.id, user.nickname, body.status === 'DISABLED' ? '禁用成员' : '启用成员', 'user', String(userId), '');
    return { data: { user_id: String(userId), status: body.status } };
  });
}));
