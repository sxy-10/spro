import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { ApiError, id, mobile, reply, run, page, list, write } from './core.js';
import { matchPermission, requirePermission } from '../auth/rbac.js';
import { hashPassword } from '../auth/security.js';

/**
 * RBAC 管理接口（组员2 交付，接口契约见 auth-rbac-api-openapi.json）
 *
 * 为什么单独一个文件、而不是写进 api/router.ts：
 *   router.ts 由组员3 并行维护，RBAC 接口独立成模块后，
 *   合并时只需在 router.ts 里加一行 api.use(rbac)，不会和业务接口互相冲突。
 *
 * 权限码与 database/05_rbac_schema.sql 的种子数据一一对应：
 *   GET    /users/me                 已登录即可（无需额外权限）
 *   GET    /users/me/permissions     已登录即可（前端动态路由 / 按钮控制的数据源）
 *   GET    /roles                    system:role:query
 *   POST   /roles                    system:role:add
 *   PUT    /roles/:id                system:role:update
 *   DELETE /roles/:id                system:role:delete
 *   GET    /roles/:id/permissions    system:role:query
 *   PUT    /roles/:id/permissions    system:role:update
 *   GET    /permissions              system:permission:query
 *
 * 约定：
 *   - 写操作带 Idempotency-Key（走 core.write，与组员3 的业务写接口同一套幂等实现）；
 *   - 内置角色（TOURIST / AGENCY_ADMIN / SUPER_ADMIN）不允许删除；
 *   - SUPER_ADMIN 的权限集不允许改（防止把超管自己锁死在系统外）。
 */

export const rbac = Router();

const text = (max: number) => z.string().trim().min(1).max(max);
const roleCode = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,49}$/, '角色编码只能是大写字母、数字、下划线，且以字母开头');
const BUILTIN_ROLE_CODES = ['TOURIST', 'AGENCY_ADMIN', 'SUPER_ADMIN'];

interface PermissionRow extends RowDataPacket {
  permission_id: string | number;
  parent_id: string | number | null;
  name: string;
  code: string;
  resource_type: 'MENU' | 'BUTTON';
  path: string | null;
  icon: string | null;
  sort: number;
  status: string;
}

interface MenuNode {
  permission_id: string;
  parent_id: string | null;
  name: string;
  code: string;
  path: string | null;
  icon: string | null;
  sort: number;
  children: MenuNode[];
}

/** 把扁平的 MENU 行组装成树；按 sort 升序，同层稳定 */
export function buildMenuTree(rows: PermissionRow[]): MenuNode[] {
  const nodes = new Map<string, MenuNode>();
  for (const row of rows) {
    if (row.resource_type !== 'MENU') continue;
    const key = String(row.permission_id);
    nodes.set(key, {
      permission_id: key,
      parent_id: row.parent_id === null ? null : String(row.parent_id),
      name: row.name,
      code: row.code,
      path: row.path,
      icon: row.icon,
      sort: Number(row.sort),
      children: []
    });
  }
  const roots: MenuNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id === null ? undefined : nodes.get(node.parent_id);
    // 父节点没被选中时，子节点提升为根，避免前端出现"孤儿菜单"
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortTree = (list_: MenuNode[]) => {
    list_.sort((a, b) => a.sort - b.sort || a.permission_id.localeCompare(b.permission_id));
    list_.forEach((node) => sortTree(node.children));
  };
  sortTree(roots);
  return roots;
}

/** 取全部启用权限资源（权限树 / 用户权限都基于它，数据量小，一次取完在内存里筛） */
async function loadPermissionRows(): Promise<PermissionRow[]> {
  const [rows] = await pool.query<PermissionRow[]>(
    `SELECT id AS permission_id, parent_id, name, code, resource_type, path, icon, sort, status
       FROM sys_permission
      WHERE status = 'ENABLED'
      ORDER BY sort, id`
  );
  return rows;
}

/**
 * 已授予权限 → 可见节点集合。
 * 规则：节点自身被授予（含通配）即可见；同时把它的所有祖先菜单一并带上，
 * 否则前端拿到一个没有父菜单的按钮，菜单树会断链。
 */
function visiblePermissionIds(rows: PermissionRow[], granted: string[]): Set<number> {
  const byId = new Map<number, PermissionRow>(rows.map((row) => [Number(row.permission_id), row]));
  const keep = new Set<number>();
  for (const row of rows) {
    if (!granted.some((own) => matchPermission(row.code, own))) continue;
    let cursor: PermissionRow | undefined = row;
    // 沿 parent_id 往上补祖先，visited 防脏数据成环
    const visited = new Set<number>();
    while (cursor && !visited.has(Number(cursor.permission_id))) {
      visited.add(Number(cursor.permission_id));
      keep.add(Number(cursor.permission_id));
      cursor = cursor.parent_id === null ? undefined : byId.get(Number(cursor.parent_id));
    }
  }
  return keep;
}

// ---------------------------------------------------------------------------
// 当前登录用户
// ---------------------------------------------------------------------------

/** GET /users/me —— 当前登录用户 + 角色码 */
rbac.get('/users/me', run(async (_req, res) => {
  const userId = res.locals.user.id;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id AS user_id, u.nickname, u.phone, u.avatar_url, u.role, u.agency_id,
            u.status, u.created_at AS create_time
       FROM sys_user u WHERE u.id = ?`,
    [userId]
  );
  if (!rows.length) throw new ApiError(404, 20012, '用户不存在');
  const [roleRows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id AS role_id, r.name, r.code
       FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.status = 'ENABLED'
      ORDER BY r.id`,
    [userId]
  );
  reply(res, { ...rows[0], roles: roleRows });
}));

/** GET /users/me/permissions —— 前端动态路由与按钮级控制的数据源 */
rbac.get('/users/me/permissions', run(async (req, res) => {
  const granted = req.user?.permissions ?? [];
  if (granted.length === 0) {
    // 没有任何授权时返回空结构而不是 403：前端据此只渲染公开页
    reply(res, { menus: [], buttons: [] });
    return;
  }
  const rows = await loadPermissionRows();
  const visible = visiblePermissionIds(rows, granted);
  const picked = rows.filter((row) => visible.has(Number(row.permission_id)));
  reply(res, {
    menus: buildMenuTree(picked),
    buttons: picked
      .filter((row) => row.resource_type === 'BUTTON')
      .map((row) => ({
        permission_id: String(row.permission_id),
        name: row.name,
        code: row.code,
        resource_type: row.resource_type
      }))
  });
}));

// ---------------------------------------------------------------------------
// 角色管理
// ---------------------------------------------------------------------------

const roleFields = `id AS role_id, name, code, description, status, created_at AS create_time, updated_at AS update_time`;

/** GET /roles —— 角色列表（分页） */
rbac.get('/roles', requirePermission('system:role:query'), run(async (req, res) => {
  const p = page(req.query, ['created_at', 'name', 'code']);
  reply(res, await list(
    pool,
    `SELECT ${roleFields},
            (SELECT COUNT(*) FROM sys_user_role ur WHERE ur.role_id = sys_role.id) AS user_count,
            (SELECT COUNT(*) FROM sys_role_permission rp WHERE rp.role_id = sys_role.id) AS permission_count
       FROM sys_role`,
    'SELECT COUNT(*) total FROM sys_role',
    [],
    p
  ));
}));

const roleCreate = z.object({
  name: text(50),
  code: roleCode,
  description: z.string().trim().max(200).optional()
}).strict();

/** POST /roles —— 新建角色（编码唯一，冲突返回 409/20015） */
rbac.post('/roles', requirePermission('system:role:add'), run(async (req, res) => {
  const body = roleCreate.parse(req.body);
  await write(req, res, async (conn) => {
    const [dup] = await conn.query<RowDataPacket[]>('SELECT id FROM sys_role WHERE code = ?', [body.code]);
    if (dup.length) throw new ApiError(409, 20015, '角色编码已存在');
    const [result] = await conn.query<ResultSetHeader>(
      'INSERT INTO sys_role (name, code, description, status) VALUES (?,?,?,\'ENABLED\')',
      [body.name, body.code, body.description ?? null]
    );
    return { data: { role_id: String(result.insertId) }, status: 201 };
  }, false);
}));

const roleUpdate = z.object({
  name: text(50).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['ENABLED', 'DISABLED']).optional()
}).strict().refine((v) => Object.keys(v).length > 0, { message: '至少提供一个待修改字段' });

/** PUT /roles/:id —— 改名称/描述/状态（不允许改 code，编码是前端与后端的约定） */
rbac.put('/roles/:id', requirePermission('system:role:update'), run(async (req, res) => {
  const roleId = id.parse(req.params.id);
  const body = roleUpdate.parse(req.body);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, code FROM sys_role WHERE id = ? FOR UPDATE', [roleId]);
    if (!rows.length) throw new ApiError(404, 20015, '角色不存在');
    if (rows[0].code === 'SUPER_ADMIN' && body.status === 'DISABLED') {
      throw new ApiError(409, 20015, '超级管理员角色不允许停用');
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name); }
    if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description); }
    if (body.status !== undefined) { sets.push('status = ?'); params.push(body.status); }
    await conn.query(`UPDATE sys_role SET ${sets.join(', ')} WHERE id = ?`, [...params, roleId]);
    return { data: { role_id: String(roleId) } };
  }, false);
}));

/** DELETE /roles/:id —— 内置角色与仍被引用的角色不允许删除 */
rbac.delete('/roles/:id', requirePermission('system:role:delete'), run(async (req, res) => {
  const roleId = id.parse(req.params.id);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, code FROM sys_role WHERE id = ? FOR UPDATE', [roleId]);
    if (!rows.length) throw new ApiError(404, 20015, '角色不存在');
    if (BUILTIN_ROLE_CODES.includes(rows[0].code)) throw new ApiError(409, 20015, '内置角色不允许删除');
    const [used] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM sys_user_role WHERE role_id = ?', [roleId]);
    if (Number(used[0].cnt) > 0) throw new ApiError(409, 20015, '该角色下仍有用户，请先解除用户关联');
    await conn.query('DELETE FROM sys_role WHERE id = ?', [roleId]);
    return { data: { role_id: String(roleId), deleted: true } };
  }, false);
}));

/** GET /roles/:id/permissions —— 角色已分配的权限 id 列表（含祖先菜单，与 PUT 的入参口径一致） */
rbac.get('/roles/:id/permissions', requirePermission('system:role:query'), run(async (req, res) => {
  const roleId = id.parse(req.params.id);
  const [exists] = await pool.query<RowDataPacket[]>('SELECT id FROM sys_role WHERE id = ?', [roleId]);
  if (!exists.length) throw new ApiError(404, 20015, '角色不存在');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rp.permission_id
       FROM sys_role_permission rp JOIN sys_permission p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND p.status = 'ENABLED'
      ORDER BY rp.permission_id`,
    [roleId]
  );
  reply(res, { role_id: String(roleId), permission_ids: rows.map((row) => String(row.permission_id)) });
}));

const rolePermissions = z.object({
  permission_ids: z.array(id).max(1000)
}).strict();

/**
 * PUT /roles/:id/permissions —— 全量覆盖式分配
 * 自动补齐父级菜单，避免出现「按钮已授权但父菜单没授权」导致前端菜单树断链。
 */
rbac.put('/roles/:id/permissions', requirePermission('system:role:update'), run(async (req, res) => {
  const roleId = id.parse(req.params.id);
  const body = rolePermissions.parse(req.body);
  await write(req, res, async (conn) => {
    const [roles] = await conn.query<RowDataPacket[]>('SELECT id, code FROM sys_role WHERE id = ? FOR UPDATE', [roleId]);
    if (!roles.length) throw new ApiError(404, 20015, '角色不存在');
    if (roles[0].code === 'SUPER_ADMIN') throw new ApiError(403, 20013, '超级管理员为内置全量权限，不允许修改');

    const wanted = new Set<number>(body.permission_ids.map(Number));
    const [all] = await conn.query<PermissionRow[]>(
      'SELECT id AS permission_id, parent_id, resource_type FROM sys_permission'
    );
    const byId = new Map<number, PermissionRow>(all.map((row) => [Number(row.permission_id), row]));
    for (const pid of wanted) {
      if (!byId.has(pid)) throw new ApiError(400, 10001, `权限资源不存在：${pid}`);
    }
    // 补齐祖先
    for (const pid of [...wanted]) {
      let cursor = byId.get(pid);
      const visited = new Set<number>();
      while (cursor?.parent_id != null && !visited.has(Number(cursor.parent_id))) {
        visited.add(Number(cursor.parent_id));
        wanted.add(Number(cursor.parent_id));
        cursor = byId.get(Number(cursor.parent_id));
      }
    }

    await conn.query('DELETE FROM sys_role_permission WHERE role_id = ?', [roleId]);
    if (wanted.size > 0) {
      const values = [...wanted].map((pid) => [roleId, pid]);
      await conn.query('INSERT INTO sys_role_permission (role_id, permission_id) VALUES ?', [values]);
    }
    return { data: { role_id: String(roleId), permission_ids: [...wanted].sort((a, b) => a - b).map(String) } };
  }, false);
}));

// ---------------------------------------------------------------------------
// 权限资源
// ---------------------------------------------------------------------------

/** GET /permissions —— 全量权限树（菜单嵌套、按钮挂在所属菜单下），供角色分配页勾选 */
rbac.get('/permissions', requirePermission('system:permission:query'), run(async (_req, res) => {
  const rows = await loadPermissionRows();
  const tree = buildMenuTree(rows);
  const buttons = rows.filter((row) => row.resource_type === 'BUTTON');
  reply(res, {
    list: tree,
    buttons: buttons.map((row) => ({
      permission_id: String(row.permission_id),
      parent_id: row.parent_id === null ? null : String(row.parent_id),
      name: row.name,
      code: row.code,
      sort: Number(row.sort),
      status: row.status
    })),
    total: rows.length
  });
}));

const permissionCreate = z.object({
  parent_id: id.nullable().optional(),
  name: text(50),
  code: z.string().trim().regex(/^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*){0,2}$/, '权限码只能是 模块[:资源[:操作]] 的小写格式'),
  resource_type: z.enum(['MENU', 'BUTTON']),
  path: z.string().trim().max(200).nullable().optional(),
  icon: z.string().trim().max(100).nullable().optional(),
  sort: z.number().int().min(0).max(9999).optional()
}).strict().superRefine((v, ctx) => {
  // 与数据库 chk_permission_button_code 同一条规则，提前到入参层给出可读报错
  if (v.resource_type === 'BUTTON' && v.code.split(':').length !== 3) {
    ctx.addIssue({ code: 'custom', message: '按钮权限码必须是 模块:资源:操作 三段式' });
  }
  if (v.resource_type === 'BUTTON' && v.parent_id === undefined) {
    ctx.addIssue({ code: 'custom', message: '按钮必须挂在某个菜单下' });
  }
});

/** POST /permissions —— 新建菜单或按钮 */
rbac.post('/permissions', requirePermission('system:permission:add'), run(async (req, res) => {
  const body = permissionCreate.parse(req.body);
  await write(req, res, async (conn) => {
    const [dup] = await conn.query<RowDataPacket[]>('SELECT id FROM sys_permission WHERE code = ?', [body.code]);
    if (dup.length) throw new ApiError(409, 20015, '权限码已存在');
    if (body.parent_id) {
      const [parent] = await conn.query<RowDataPacket[]>('SELECT id FROM sys_permission WHERE id = ?', [body.parent_id]);
      if (!parent.length) throw new ApiError(400, 10001, '父权限资源不存在');
    }
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort, status)
       VALUES (?,?,?,?,?,?,?,'ENABLED')`,
      [body.parent_id ?? null, body.name, body.code, body.resource_type,
       body.resource_type === 'MENU' ? (body.path ?? null) : null,
       body.resource_type === 'MENU' ? (body.icon ?? null) : null,
       body.sort ?? 0]
    );
    return { data: { permission_id: String(result.insertId) }, status: 201 };
  }, false);
}));

const permissionUpdate = z.object({
  name: text(50).optional(),
  path: z.string().trim().max(200).nullable().optional(),
  icon: z.string().trim().max(100).nullable().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  status: z.enum(['ENABLED', 'DISABLED']).optional()
}).strict().refine((v) => Object.keys(v).length > 0, { message: '至少提供一个待修改字段' });

/** PUT /permissions/:id —— 改名称/路由/图标/排序/状态（code 与类型不允许改） */
rbac.put('/permissions/:id', requirePermission('system:permission:update'), run(async (req, res) => {
  const permissionId = id.parse(req.params.id);
  const body = permissionUpdate.parse(req.body);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, resource_type FROM sys_permission WHERE id = ? FOR UPDATE', [permissionId]);
    if (!rows.length) throw new ApiError(404, 20015, '权限资源不存在');
    if (rows[0].resource_type === 'BUTTON' && (body.path !== undefined || body.icon !== undefined)) {
      throw new ApiError(400, 10001, '按钮资源不支持 path / icon 字段');
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name); }
    if (body.path !== undefined) { sets.push('path = ?'); params.push(body.path); }
    if (body.icon !== undefined) { sets.push('icon = ?'); params.push(body.icon); }
    if (body.sort !== undefined) { sets.push('sort = ?'); params.push(body.sort); }
    if (body.status !== undefined) { sets.push('status = ?'); params.push(body.status); }
    await conn.query(`UPDATE sys_permission SET ${sets.join(', ')} WHERE id = ?`, [...params, permissionId]);
    return { data: { permission_id: String(permissionId) } };
  }, false);
}));

/** DELETE /permissions/:id —— 有子节点或仍被角色引用时拒绝，避免删出断链菜单 */
rbac.delete('/permissions/:id', requirePermission('system:permission:delete'), run(async (req, res) => {
  const permissionId = id.parse(req.params.id);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM sys_permission WHERE id = ? FOR UPDATE', [permissionId]);
    if (!rows.length) throw new ApiError(404, 20015, '权限资源不存在');
    const [children] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM sys_permission WHERE parent_id = ?', [permissionId]);
    if (Number(children[0].cnt) > 0) throw new ApiError(409, 20015, '该资源下仍有子节点，请先删除子节点');
    const [used] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM sys_role_permission WHERE permission_id = ?', [permissionId]);
    if (Number(used[0].cnt) > 0) throw new ApiError(409, 20015, '该资源已分配给角色，请先在角色分配中移除');
    await conn.query('DELETE FROM sys_permission WHERE id = ?', [permissionId]);
    return { data: { permission_id: String(permissionId), deleted: true } };
  }, false);
}));

// ---------------------------------------------------------------------------
// 用户管理（管理端：分配角色、启停用）
// ---------------------------------------------------------------------------

const userSelect = `SELECT u.id AS user_id, u.nickname, u.phone, u.avatar_url, u.role, u.agency_id,
       CASE u.status WHEN 'ACTIVE' THEN 'ENABLED' ELSE 'DISABLED' END AS status,
       u.created_at AS create_time
  FROM sys_user u`;

/** GET /admin/users —— 用户列表（分页，可按状态筛选，带角色码数组） */
rbac.get('/admin/users', requirePermission('system:user:query'), run(async (req, res) => {
  const p = page(req.query, ['created_at', 'id'], { status: z.enum(['ENABLED', 'DISABLED']).optional() });
  const where = p.status
    ? ` WHERE u.status = ${p.status === 'ENABLED' ? "'ACTIVE'" : "'DISABLED'"}`
    : '';
  const result = await list(pool, `${userSelect}${where}`, `SELECT COUNT(*) total FROM sys_user u${where}`, [], p);
  const ids = result.list.map((row: any) => String(row.user_id));
  const rolesByUser = new Map<string, any[]>();
  if (ids.length > 0) {
    const [roleRows] = await pool.query<RowDataPacket[]>(
      `SELECT ur.user_id, r.id AS role_id, r.name, r.code
         FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
        WHERE ur.user_id IN (${ids.map(() => '?').join(',')})
        ORDER BY r.id`,
      ids
    );
    for (const row of roleRows) {
      const key = String(row.user_id);
      if (!rolesByUser.has(key)) rolesByUser.set(key, []);
      rolesByUser.get(key)!.push({ role_id: String(row.role_id), name: row.name, code: row.code });
    }
  }
  reply(res, {
    list: result.list.map((row: any) => ({ ...row, roles: rolesByUser.get(String(row.user_id)) ?? [] })),
    total: result.total,
    has_more: result.has_more
  });
}));

const adminUserCreate = z.object({
  mobile,
  password: z.string().min(8).max(72),
  nickname: text(50).optional(),
  role_ids: z.array(id).min(1).max(20)
}).strict();

/** 校验角色 id 都存在且启用，返回去重后的数字数组 */
async function assertRolesAssignable(conn: typeof pool | PoolConnection, roleIds: string[]): Promise<number[]> {
  const unique = [...new Set(roleIds.map(Number))];
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM sys_role WHERE id IN (${unique.map(() => '?').join(',')}) AND status = 'ENABLED'`,
    unique
  );
  if (rows.length !== unique.length) throw new ApiError(400, 10001, '存在无效或已停用的角色');
  return unique;
}

/** POST /admin/users —— 管理员建号并分配角色 */
rbac.post('/admin/users', requirePermission('system:user:add'), run(async (req, res) => {
  const body = adminUserCreate.parse(req.body);
  const passwordHash = await hashPassword(body.password);
  await write(req, res, async (conn) => {
    const [dup] = await conn.query<RowDataPacket[]>('SELECT id FROM sys_user WHERE phone = ?', [body.mobile]);
    if (dup.length) throw new ApiError(409, 20015, '手机号已被注册');
    const roleIds = await assertRolesAssignable(conn, body.role_ids);
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO sys_user (username, phone, password_hash, nickname, role, agency_id, status)
       VALUES (?,?,?,?,'TOURIST',NULL,'ACTIVE')`,
      [body.mobile, body.mobile, passwordHash, body.nickname ?? null]
    );
    const newUserId = result.insertId;
    await conn.query('INSERT INTO sys_user_role (user_id, role_id) VALUES ?', [roleIds.map((roleId) => [newUserId, roleId])]);
    return { data: { user_id: String(newUserId), role_ids: roleIds.map(String) }, status: 201 };
  }, false);
}));

const adminUserUpdate = z.object({
  nickname: text(50).optional(),
  status: z.enum(['ENABLED', 'DISABLED']).optional(),
  role_ids: z.array(id).min(1).max(20)
}).strict();

/** PUT /admin/users/:id —— 改资料/启停用/全量覆盖角色（停用即踢下线） */
rbac.put('/admin/users/:id', requirePermission('system:user:update'), run(async (req, res) => {
  const userId = id.parse(req.params.id);
  const body = adminUserUpdate.parse(req.body);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id, phone FROM sys_user WHERE id = ? FOR UPDATE', [userId]);
    if (!rows.length) throw new ApiError(404, 20015, '用户不存在');
    const roleIds = await assertRolesAssignable(conn, body.role_ids);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.nickname !== undefined) { sets.push('nickname = ?'); params.push(body.nickname); }
    if (body.status !== undefined) { sets.push('status = ?'); params.push(body.status === 'ENABLED' ? 'ACTIVE' : 'DISABLED'); }
    if (sets.length > 0) await conn.query(`UPDATE sys_user SET ${sets.join(', ')} WHERE id = ?`, [...params, userId]);

    await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [userId]);
    await conn.query('INSERT INTO sys_user_role (user_id, role_id) VALUES ?', [roleIds.map((roleId) => [userId, roleId])]);

    // 停用后立刻撤销全部会话，避免旧 token 继续可用
    if (body.status === 'DISABLED') {
      await conn.query('UPDATE api_session SET is_revoked = 1 WHERE user_id = ?', [userId]);
    }
    return { data: { user_id: String(userId), role_ids: roleIds.map(String), status: body.status ?? null } };
  }, false);
}));

/** DELETE /admin/users/:id —— 不做物理删除（历史订单/行程仍引用该用户），改为停用 + 撤销会话 */
rbac.delete('/admin/users/:id', requirePermission('system:user:delete'), run(async (req, res) => {
  const userId = id.parse(req.params.id);
  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT id FROM sys_user WHERE id = ? FOR UPDATE', [userId]);
    if (!rows.length) throw new ApiError(404, 20015, '用户不存在');
    if (String(userId) === String(res.locals.user.id)) throw new ApiError(409, 20015, '不能停用当前登录的管理员账号');
    await conn.query("UPDATE sys_user SET status = 'DISABLED' WHERE id = ?", [userId]);
    await conn.query('UPDATE api_session SET is_revoked = 1 WHERE user_id = ?', [userId]);
    return { data: { user_id: String(userId), status: 'DISABLED' } };
  }, false);
}));

export default rbac;
