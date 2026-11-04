import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../app.js';
import { pool } from '../db/connection.js';
import {
  matchPermission,
  requirePermission,
  requireAnyPermission,
  requireRole,
  PERMISSION_DENIED_CODE,
  AUTH_REQUIRED_CODE
} from './rbac.js';

/**
 * RBAC 授权层测试（组员2）
 * 覆盖三层：
 *   1. 权限码匹配规则（精确 / 通配）
 *   2. 守卫中间件的三态（未登录 401 / 无权限 403 / 有权限放行）
 *   3. 走真实 Express 链路：游客 403、旅行社管理员 200、无 token 401，响应包络与契约一致
 * 数据库全部用桩替换，测试不依赖本地 MySQL。
 */

const TEST_SECRET = 'test-secret-with-at-least-32-characters';
process.env.JWT_SECRET = TEST_SECRET;

const fakeRes = () => ({ locals: {} as Record<string, unknown> }) as any;
const invoker = () => {
  let captured: any;
  const next = (error?: any) => { captured = error; };
  return { next, error: () => captured };
};

test('权限码匹配：精确命中、通配授予、跨模块不误放行', () => {
  assert.equal(matchPermission('route:line:add', 'route:line:add'), true);
  assert.equal(matchPermission('route:line:add', 'route:line:query'), false);
  assert.equal(matchPermission('route:line:add', 'route:line:*'), true, '资源级通配应放行同资源的所有操作');
  assert.equal(matchPermission('route:line:add', 'route:*'), true, '模块级通配应放行该模块全部权限');
  assert.equal(matchPermission('route:line:add', '*'), true, '全量通配应放行一切');
  assert.equal(matchPermission('system:role:add', 'route:*'), false, '跨模块通配不得放行');
  assert.equal(matchPermission('systemx:role', 'system:*'), false, '前缀必须整段匹配，systemx 不算 system');
  assert.equal(matchPermission('Route:Line:Add', 'route:line:add'), true, '大小写不应影响判定');
});

test('守卫：未登录请求返回 401 + 20012', () => {
  const handler = requirePermission('system:role:add');
  const { next, error } = invoker();
  handler({ originalUrl: '/v1/admin/roles' } as any, fakeRes(), next as any);
  const err = error();
  assert.equal(err.status, 401);
  assert.equal(err.code, AUTH_REQUIRED_CODE);
});

test('守卫：已登录但缺权限返回 403 + 20013 + 统一文案', () => {
  const handler = requirePermission('system:role:add');
  const { next, error } = invoker();
  const req = { originalUrl: '/v1/admin/roles', user: { id: '1', roles: ['TOURIST'], permissions: ['route:line:query'] } } as any;
  handler(req, fakeRes(), next as any);
  const err = error();
  assert.equal(err.status, 403);
  assert.equal(err.code, PERMISSION_DENIED_CODE);
  assert.equal(err.message, '权限不足，禁止访问');
});

test('守卫：持有全部所需权限才放行，缺一即拒', () => {
  const req = { originalUrl: '/v1/admin/roles', user: { id: '1', roles: ['AGENCY_ADMIN'], permissions: ['system:role:query', 'system:role:export'] } } as any;
  const pass = invoker();
  requirePermission('system:role:query')(req, fakeRes(), pass.next as any);
  assert.equal(pass.error(), undefined);

  const deny = invoker();
  requirePermission('system:role:query', 'system:role:add')(req, fakeRes(), deny.next as any);
  assert.equal(deny.error()?.status, 403);
});

test('守卫：任意权限模式与角色模式', () => {
  const req = { originalUrl: '/v1/roles/1', user: { id: '2', roles: ['AGENCY_ADMIN'], permissions: ['route:line:update'] } } as any;

  const anyPass = invoker();
  requireAnyPermission('route:line:update', 'route:line:add')(req, fakeRes(), anyPass.next as any);
  assert.equal(anyPass.error(), undefined);

  const anyDeny = invoker();
  requireAnyPermission('system:role:add', 'system:role:delete')(req, fakeRes(), anyDeny.next as any);
  assert.equal(anyDeny.error()?.status, 403);

  const rolePass = invoker();
  requireRole('AGENCY_ADMIN', 'SUPER_ADMIN')(req, fakeRes(), rolePass.next as any);
  assert.equal(rolePass.error(), undefined);

  const roleDeny = invoker();
  requireRole('SUPER_ADMIN')(req, fakeRes(), roleDeny.next as any);
  assert.equal(roleDeny.error()?.status, 403);
});

test('HTTP 链路：游客 403 / 旅行社管理员 200 / 无 token 401', async () => {
  const persona = { role: 'TOURIST', permissions: [] as string[], roles: ['TOURIST'] };

  const originalQuery = pool.query;
  (pool as any).query = async (sql: string) => {
    if (sql.includes('api_rate_limit')) return [sql.trim().startsWith('SELECT') ? [{ hits: 1 }] : {}];
    if (sql.includes('JOIN sys_user u')) {
      return [[{ id: 1, phone: '13900000001', role: persona.role, agency_id: 1, status: 'ACTIVE' }]];
    }
    if (sql.includes('sys_role_permission')) {
      return [persona.permissions.map((code) => ({ code }))];
    }
    if (sql.includes('FROM sys_user_role ur')) {
      return [persona.roles.map((code) => ({ code }))];
    }
    if (sql.includes('COUNT(*) total FROM travel_product')) return [[{ total: 0 }]];
    if (sql.includes('FROM travel_product')) return [[]];
    if (sql.includes('FROM tour_order')) return [[{ order_count: 0, paid_order_count: 0 }]];
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

  try {
    // 1. 无 token → 401，包络符合契约
    const anonymous = await call('/admin/routes', false);
    assert.equal(anonymous.status, 401);

    // 2. 游客（无任何按钮权限）→ 403 + 20013
    persona.role = 'TOURIST'; persona.roles = ['TOURIST']; persona.permissions = [];
    const denied = await call('/admin/routes');
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, PERMISSION_DENIED_CODE);
    assert.equal(denied.body.message, '权限不足，禁止访问');
    assert.deepEqual(Object.keys(denied.body).sort(), ['code', 'data', 'message', 'trace_id']);

    // 3. 旅行社管理员持有 route:line:query → 放行（关键：不再依赖 sys_user.role = 'ADMIN'）
    persona.role = 'TOURIST'; persona.roles = ['AGENCY_ADMIN']; persona.permissions = ['route:line:query', 'order:manage:query'];
    const allowed = await call('/admin/routes');
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.code, 0);

    // 4. 同一身份访问 analytics 也应有权限（order:manage:query）
    assert.equal((await call('/admin/analytics')).status, 200);
  } finally {
    (pool as any).query = originalQuery;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
