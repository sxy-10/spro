import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../app.js';
import { pool } from '../db/connection.js';
import {
  matchPermission,
  requireAction,
  requireAnyAction,
  requireAnyPermission,
  requirePermission,
  requireRole,
  PERMISSION_DENIED_CODE,
  AUTH_REQUIRED_CODE
} from './rbac.js';
import { toPolicyRequest, toPolicyRules } from './permissionCode.js';
import {
  RBAC_MODEL_TEXT,
  StaticPolicyAdapter,
  evaluateRequests,
  getEnforcer,
  invalidatePolicyCache,
  isAllowed,
  setPolicyAdapter
} from './casbin.js';

/**
 * RBAC / Casbin 授权层测试（组员2 · 阶段二）
 * 覆盖四层：
 *   1. 权限码 → Casbin (obj, act) 的折算口径（纯函数：菜单/按钮/通配/大小写）
 *   2. Casbin 策略判定（静态策略适配器，不依赖 MySQL）
 *   3. 守卫中间件的三态（未登录 401 / 无权限 403 / 有权限放行），含 requireAction 新写法
 *   4. 走真实 Express 链路：游客 403、旅行社管理员 200、无 token 401，响应包络与契约一致
 */

const TEST_SECRET = 'test-secret-with-at-least-32-characters';
process.env.JWT_SECRET = TEST_SECRET;

const fakeRes = () => ({ locals: {} as Record<string, unknown> }) as any;
const invoker = () => {
  let captured: any;
  const next = (error?: any) => { captured = error; };
  return { next, error: () => captured };
};

/** 守卫是 async 的（要等 Casbin 判定），这里统一让出一个宏任务再取 next 的入参 */
async function invoke(handler: any, req: any, res: any = fakeRes()): Promise<any> {
  const { next, error } = invoker();
  handler(req, res, next);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return error();
}

const shape = (request: { obj: string; act: string }) => ({ obj: request.obj, act: request.act });

// ---------------------------------------------------------------------------
// 1. 折算口径
// ---------------------------------------------------------------------------

test('权限码折算：菜单/按钮/通配统一落到 (obj, act)', () => {
  assert.deepEqual(shape(toPolicyRequest('system:role:add')), { obj: 'system:role', act: 'add' });
  assert.deepEqual(shape(toPolicyRequest('system:role')), { obj: 'system:role', act: 'view' }, '菜单只放行 view');
  assert.deepEqual(shape(toPolicyRequest('system')), { obj: 'system', act: 'view' });
  assert.deepEqual(shape(toPolicyRequest('system:role', 'query')), { obj: 'system:role', act: 'query' }, 'requireAction(module, action) 写法');
  assert.deepEqual(shape(toPolicyRequest('System:Role', 'Query')), { obj: 'system:role', act: 'query' }, '大小写不应影响判定');
  // 通配：keyMatch 是前缀通配，故一条通配码要下发两条策略才能覆盖整棵子树
  assert.deepEqual(toPolicyRules('route:*').map(shape), [
    { obj: 'route', act: '*' },
    { obj: 'route:*', act: '*' }
  ]);
  assert.deepEqual(toPolicyRules('route:line:*').map(shape), [
    { obj: 'route:line', act: '*' },
    { obj: 'route:line:*', act: '*' }
  ]);
});

test('权限码匹配：精确命中、通配授予、跨模块不误放行', () => {
  assert.equal(matchPermission('route:line:add', 'route:line:add'), true);
  assert.equal(matchPermission('route:line:add', 'route:line:query'), false);
  assert.equal(matchPermission('route:line:add', 'route:line:*'), true, '资源级通配应放行同资源的所有操作');
  assert.equal(matchPermission('route:line:add', 'route:*'), true, '模块级通配应放行该模块全部权限');
  assert.equal(matchPermission('route:line:add', '*'), true, '全量通配应放行一切');
  assert.equal(matchPermission('system:role:add', 'route:*'), false, '跨模块通配不得放行');
  assert.equal(matchPermission('systemx:role', 'system:*'), false, '前缀必须整段匹配，systemx 不算 system');
  assert.equal(matchPermission('system:role:query', 'system:role'), false, '菜单授权不得放大成按钮操作');
  assert.equal(matchPermission('Route:Line:Add', 'route:line:add'), true, '大小写不应影响判定');
});

// ---------------------------------------------------------------------------
// 2. Casbin 策略判定（静态策略，不连库）
// ---------------------------------------------------------------------------

test('Casbin：角色 → 权限命中放行，未授予的操作拒绝', async () => {
  setPolicyAdapter(new StaticPolicyAdapter([
    'p, AGENCY_ADMIN, route:line, query',
    'p, AGENCY_ADMIN, route:line, add',
    'p, TOURIST, system:role, view'
  ]));
  // permissions 故意留空：证明放行来自 Casbin 策略，而不是登录时聚合的快照
  const agency = { id: '2', roles: ['AGENCY_ADMIN'], permissions: [] };
  assert.equal(await isAllowed(agency, toPolicyRequest('route:line', 'query')), true);
  assert.equal(await isAllowed(agency, toPolicyRequest('route:line', 'add')), true);
  assert.equal(await isAllowed(agency, toPolicyRequest('route:line', 'delete')), false, '策略里没有 delete');

  const tourist = { id: '3', roles: ['TOURIST'], permissions: [] };
  assert.equal(await isAllowed(tourist, toPolicyRequest('system:role')), true, '菜单 view 放行');
  assert.equal(await isAllowed(tourist, toPolicyRequest('system:role', 'query')), false, '菜单授权不得放大成按钮操作');
});

test('Casbin：g 规则按用户 ID 绑定角色，通配策略覆盖整棵子树', async () => {
  setPolicyAdapter(new StaticPolicyAdapter([
    'p, AGENCY_ADMIN, route:line, query',
    'p, SUPER_ADMIN, *, *',
    'g, 42, AGENCY_ADMIN'
  ]));

  // roles 留空：只靠数据库里的 g 规则（sys_user_role）命中角色，验证角色继承真的生效
  const bound = { id: '42', roles: [], permissions: [] };
  assert.equal(await isAllowed(bound, toPolicyRequest('route:line', 'query')), true);
  assert.equal(await isAllowed(bound, toPolicyRequest('route:line', 'delete')), false);
  assert.equal(
    await isAllowed({ id: '99', roles: [], permissions: [] }, toPolicyRequest('route:line', 'query')),
    false,
    '没有 g 规则、也不是该角色 → 拒绝'
  );

  const superAdmin = { id: '1', roles: ['SUPER_ADMIN'], permissions: [] };
  assert.equal(await isAllowed(superAdmin, toPolicyRequest('system:permission', 'delete')), true, '通配策略应放行任意模块');
});

test('Casbin：策略表为空时退回权限快照，结论与策略路径一致', async () => {
  setPolicyAdapter(new StaticPolicyAdapter([]));
  const user = { id: '7', roles: ['TOURIST'], permissions: ['route:line:query'] };

  const allow = await evaluateRequests(user, [toPolicyRequest('route:line', 'query')]);
  assert.equal(allow.allowed, true);
  assert.equal(allow.engine, 'snapshot', '策略为空必须降级到快照，不能把所有人一刀切拒掉');

  const deny = await evaluateRequests(user, [toPolicyRequest('route:line', 'add')]);
  assert.equal(deny.allowed, false);
  assert.deepEqual(deny.missing, ['route:line:add']);
});

test('Casbin：多条要求支持 all / any 两种模式', async () => {
  setPolicyAdapter(new StaticPolicyAdapter(['p, AGENCY_ADMIN, route:line, query']));
  const user = { id: '2', roles: ['AGENCY_ADMIN'], permissions: [] };
  const all = await evaluateRequests(user, [toPolicyRequest('route:line', 'query'), toPolicyRequest('route:line', 'add')], 'all');
  assert.equal(all.allowed, false);
  const any = await evaluateRequests(user, [toPolicyRequest('route:line', 'query'), toPolicyRequest('route:line', 'add')], 'any');
  assert.equal(any.allowed, true);
});

test('Casbin：模型必须同时具备 role_definition 与 keyMatch 通配', async () => {
  // 模型是判定的根：少一条语义都会让某类授权静默失效，所以直接对模型文本断言
  assert.match(RBAC_MODEL_TEXT, /^g = _, _$/m, '缺少 role_definition → 角色继承静默失效');
  assert.match(RBAC_MODEL_TEXT, /g\(r\.sub, p\.sub\)/, '映射里没接 g() → 角色继承不参与判定');
  assert.match(RBAC_MODEL_TEXT, /keyMatch\(r\.obj, p\.obj\)/, '缺少 keyMatch → 通配授权静默失效');
  assert.match(RBAC_MODEL_TEXT, /p\.act == "\*"/, '缺少 act 通配 → SUPER_ADMIN 这类全量授权无法表达');

  // 引擎真的按这份模型跑起来了：策略命中即放行
  setPolicyAdapter(new StaticPolicyAdapter(['p, SUPER_ADMIN, *, *']));
  const enforcer = await getEnforcer();
  assert.equal(await enforcer.enforce('SUPER_ADMIN', 'system:permission', 'delete'), true);
});

// ---------------------------------------------------------------------------
// 3. 守卫三态
// ---------------------------------------------------------------------------

test('守卫：未登录请求返回 401 + 20012', async () => {
  setPolicyAdapter(new StaticPolicyAdapter(['p, AGENCY_ADMIN, system:role, add']));
  const error = await invoke(requireAction('system:role', 'add'), { originalUrl: '/v1/roles' });
  assert.equal(error.status, 401);
  assert.equal(error.code, AUTH_REQUIRED_CODE);
});

test('守卫：已登录但缺权限返回 403 + 20013 + 统一文案', async () => {
  setPolicyAdapter(new StaticPolicyAdapter(['p, TOURIST, route:line, query']));
  const req = { originalUrl: '/v1/admin/roles', user: { id: '1', roles: ['TOURIST'], permissions: ['route:line:query'] } };
  const error = await invoke(requirePermission('system:role:add'), req);
  assert.equal(error.status, 403);
  assert.equal(error.code, PERMISSION_DENIED_CODE);
  assert.equal(error.message, '权限不足，禁止访问');
});

test('守卫：持有全部所需权限才放行，缺一即拒', async () => {
  setPolicyAdapter(new StaticPolicyAdapter([
    'p, AGENCY_ADMIN, system:role, query',
    'p, AGENCY_ADMIN, system:role, export'
  ]));
  const req = { originalUrl: '/v1/admin/roles', user: { id: '1', roles: ['AGENCY_ADMIN'], permissions: [] } };
  assert.equal(await invoke(requirePermission('system:role:query'), req), undefined);
  assert.equal(await invoke(requirePermission('system:role:query', 'system:role:export'), req), undefined);
  assert.equal((await invoke(requirePermission('system:role:query', 'system:role:add'), req))?.status, 403);
});

test('守卫：任意权限模式、任意操作模式与角色模式', async () => {
  setPolicyAdapter(new StaticPolicyAdapter(['p, AGENCY_ADMIN, route:line, update']));
  const req = { originalUrl: '/v1/roles/1', user: { id: '2', roles: ['AGENCY_ADMIN'], permissions: [] } };

  assert.equal(await invoke(requireAnyPermission('route:line:update', 'route:line:add'), req), undefined);
  assert.equal((await invoke(requireAnyPermission('system:role:add', 'system:role:delete'), req))?.status, 403);
  assert.equal(await invoke(requireAnyAction(['route:line', 'update'], ['route:line', 'add']), req), undefined);
  assert.equal(await invoke(requireRole('AGENCY_ADMIN', 'SUPER_ADMIN'), req), undefined);
  assert.equal((await invoke(requireRole('SUPER_ADMIN'), req))?.status, 403);
});

// ---------------------------------------------------------------------------
// 4. 真实 HTTP 链路
// ---------------------------------------------------------------------------

test('HTTP 链路：游客 403 / 旅行社管理员 200 / 无 token 401', async () => {
  const persona = { role: 'TOURIST', permissions: [] as string[], roles: ['TOURIST'] };
  setPolicyAdapter(null); // 恢复 MySQL 适配器（下面的桩函数会喂它真数据）

  const originalQuery = pool.query;
  (pool as any).query = async (sql: string) => {
    // Casbin 适配器 g 规则（用户 → 角色）
    if (sql.includes('AS role_code') && sql.includes('FROM sys_user_role ur')) {
      return [persona.roles.map((code) => ({ user_id: '1', role_code: code }))];
    }
    // Casbin 适配器 p 规则（角色 → 权限）
    if (sql.includes('AS permission_code')) {
      return [persona.permissions.map((code) => ({ role_code: persona.roles[0] ?? 'TOURIST', permission_code: code }))];
    }
    if (sql.includes('api_rate_limit')) return [sql.trim().startsWith('SELECT') ? [{ hits: 1 }] : {}];
    if (sql.includes('JOIN sys_user u')) {
      return [[{ id: 1, phone: '13900000001', role: persona.role, agency_id: 1, status: 'ACTIVE' }]];
    }
    if (sql.includes('sys_role_permission') && !sql.includes('AS user_count')) {
      return [persona.permissions.map((code) => ({ code }))];
    }
    if (sql.includes('FROM sys_user_role ur') && !sql.includes('user_count')) {
      return [persona.roles.map((code) => ({ code }))];
    }
    if (sql.includes('COUNT(*) AS total FROM chat_session')) return [[{ total: 0 }]];
    if (sql.includes('FROM chat_session')) return [[]];
    if (sql.includes('COUNT(*) AS total FROM tour_order')) return [[{ total: 0 }]];
    if (sql.includes('FROM tour_order') && sql.includes('COUNT(*) AS order_count')) {
      return [[{ order_count: 0, paid_order_count: 0, canceled_order_count: 0, revenue_rmb: '0.00' }]];
    }
    if (sql.includes('FROM tour_order')) return [[]];
    if (sql.includes('SELECT COUNT(*) AS route_count')) {
      return [[{ route_count: 0, on_sale_route_count: 0, visitor_count: 0, plans_generated_count: 0 }]];
    }
    if (sql.includes('COUNT(*) total FROM travel_product')) return [[{ total: 0 }]];
    if (sql.includes('FROM travel_product')) return [[]];
    if (sql.includes('COUNT(*) total FROM sys_role')) return [[{ total: 2 }]];
    if (sql.includes('FROM sys_role')) {
      return [[
        { role_id: '1', name: '游客', code: 'TOURIST', description: null, status: 'ENABLED', create_time: '2026-11-01T00:00:00Z', update_time: '2026-11-01T00:00:00Z', user_count: 1, permission_count: 0 },
        { role_id: '2', name: '旅行社管理员', code: 'AGENCY_ADMIN', description: null, status: 'ENABLED', create_time: '2026-11-01T00:00:00Z', update_time: '2026-11-01T00:00:00Z', user_count: 0, permission_count: 12 }
      ]];
    }
    if (sql.includes('FROM sys_permission')) {
      return [[
        { permission_id: '10', parent_id: null, name: '系统管理', code: 'system', resource_type: 'MENU', path: '/admin', icon: 'setting', sort: 1, status: 'ENABLED' },
        { permission_id: '11', parent_id: '10', name: '角色管理', code: 'system:role', resource_type: 'MENU', path: '/admin/roles', icon: null, sort: 1, status: 'ENABLED' },
        { permission_id: '101', parent_id: '11', name: '新增角色', code: 'system:role:add', resource_type: 'BUTTON', path: null, icon: null, sort: 1, status: 'ENABLED' }
      ]];
    }
    throw new Error(`Unexpected SQL in rbac test: ${sql}`);
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  const token = jwt.sign({}, TEST_SECRET, {
    subject: '1', jwtid: 'rbac-test-session', issuer: 'travel-agent', audience: 'travel-client', expiresIn: '10m'
  });
  const call = async (path: string, withToken = true) => {
    const response = await fetch(`http://127.0.0.1:${port}/v1${path}`, {
      headers: withToken ? { Authorization: `Bearer ${token}` } : {}
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  /** 切身份后必须作废策略缓存，否则要等 TTL 才生效（生产由 rbacRouter 的写操作钩子负责） */
  const switchPersona = (next: { role: string; roles: string[]; permissions: string[] }) => {
    Object.assign(persona, next);
    invalidatePolicyCache('test:persona');
  };

  try {
    const health = await call('/health', false);
    assert.equal(health.status, 200);
    assert.equal(health.body.data.status, 'ok');

    // 1. 无 token → 401 + 20012（契约硬要求：401 必须与 403/20013 区分开）
    const anonymous = await call('/admin/routes', false);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.code, AUTH_REQUIRED_CODE, '未登录业务码必须是 20012，不能与 403/20013 撞码');

    // 2. 游客（无任何按钮权限）→ 403 + 20013
    switchPersona({ role: 'TOURIST', roles: ['TOURIST'], permissions: [] });
    const denied = await call('/admin/routes');
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, PERMISSION_DENIED_CODE);
    assert.equal(denied.body.message, '权限不足，禁止访问');
    assert.deepEqual(Object.keys(denied.body).sort(), ['code', 'data', 'message', 'trace_id']);
    const chatDenied = await call('/chat/sessions');
    assert.equal(chatDenied.status, 403);
    assert.equal(chatDenied.body.code, PERMISSION_DENIED_CODE);

    // 3. 旅行社管理员持有 route:line:query → 放行（关键：不再依赖 sys_user.role = 'ADMIN'）
    switchPersona({ role: 'TOURIST', roles: ['AGENCY_ADMIN'], permissions: ['route:line:query', 'order:manage:query'] });
    const allowed = await call('/admin/routes');
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.code, 0);
    assert.equal((await call('/admin/orders')).status, 200);

    // 4. 同一身份访问 analytics 也应有权限（order:manage:query）
    assert.equal((await call('/admin/analytics')).status, 200);

    // 游客被明确授予聊天读取权限后，业务查询放行。
    switchPersona({ role: 'TOURIST', roles: ['TOURIST'], permissions: ['chat:session:query'] });
    const sessions = await call('/chat/sessions');
    assert.equal(sessions.status, 200);
    assert.deepEqual(sessions.body.data.list, []);

    // 5. RBAC 管理接口同样受权限码保护：无 system:role:query 时 403
    const rolesDenied = await call('/roles');
    assert.equal(rolesDenied.status, 403);
    assert.equal(rolesDenied.body.code, PERMISSION_DENIED_CODE);

    // 6. 补上 system:role:query 后可读角色列表（验证路由挂载与列表包络）
    switchPersona({ role: 'TOURIST', roles: ['AGENCY_ADMIN'], permissions: ['system:role', 'system:role:query'] });
    const rolesAllowed = await call('/roles');
    assert.equal(rolesAllowed.status, 200);
    assert.equal(rolesAllowed.body.data.total, 2);
    assert.equal(rolesAllowed.body.data.list[1].code, 'AGENCY_ADMIN');

    // 7. 前端权限接口：只有 system:role 这一支时，菜单树只暴露 system → system:role
    const myPermissions = await call('/users/me/permissions');
    assert.equal(myPermissions.status, 200);
    assert.equal(myPermissions.body.data.menus.length, 1);
    assert.equal(myPermissions.body.data.menus[0].code, 'system');
    assert.equal(myPermissions.body.data.menus[0].children[0].code, 'system:role');
    assert.deepEqual(myPermissions.body.data.buttons, []);

    // 8. 游客无任何权限时，权限接口返回空结构而不是 403（前端据此只渲染公开页）
    switchPersona({ role: 'TOURIST', roles: ['TOURIST'], permissions: [] });
    const emptyPermissions = await call('/users/me/permissions');
    assert.equal(emptyPermissions.status, 200);
    assert.deepEqual(emptyPermissions.body.data, { menus: [], buttons: [] });
  } finally {
    (pool as any).query = originalQuery;
    setPolicyAdapter(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
