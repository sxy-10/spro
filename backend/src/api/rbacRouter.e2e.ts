/**
 * RBAC 管理接口真实联调脚本
 * 验证 api/rbacRouter.ts 的 9 个接口：权限树、角色 CRUD、角色授权、当前用户；
 * 并验收 Casbin 授权层：策略确实从数据库加载、写权限后立即生效（第 7 段）。
 *
 * 前置：库已执行 01_schema.sql → 05_rbac_schema.sql → 08_rbac_complete.sql；backend/.env 配好 DB_*。
 * 账号：脚本会自动创建/重置 3 个联调账号（13800000001 超管 / 13800000002 社管 /
 *      13800000003 游客，密码 Passw0rd!23），不依赖 02_seed.sql 的占位哈希。
 * 运行：cd backend && npm run e2e:rbac
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { RowDataPacket } from 'mysql2/promise';
import { app } from '../app.js';
import { pool } from '../db/connection.js';
import { getPolicySnapshot, isAllowed } from '../auth/casbin.js';
import { toPolicyRequest } from '../auth/permissionCode.js';
import { hashPassword } from '../auth/security.js';

process.env.JWT_SECRET ||= 'e2e-secret-with-at-least-32-characters!!';

const DEMO_PASSWORD = 'Passw0rd!23';

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ->  ${JSON.stringify(actual)}${ok ? '' : `  (期望 ${JSON.stringify(expected)})`}`);
}

/**
 * 联调账号准备（幂等，可反复执行）。
 * 为什么必须做：02_seed.sql 里的密码是占位哈希（登录必失败），且只建了 2 个账号、
 * 没有 sys_user_role 绑定。真实库联调要的是「三种角色各一个能登录的账号」，
 * 所以脚本自己补齐：建号/重置密码 → 绑定角色（覆盖式）。
 */
async function ensureDemoAccounts(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const accounts = [
    { phone: '13800000001', username: 'rbac_super',   nickname: '联调-超管',        role: 'ADMIN',   agencyId: 1,    roleCode: 'SUPER_ADMIN' },
    { phone: '13800000002', username: 'rbac_agency',  nickname: '联调-旅行社管理员', role: 'ADMIN',   agencyId: 1,    roleCode: 'AGENCY_ADMIN' },
    { phone: '13800000003', username: 'rbac_tourist', nickname: '联调-游客',        role: 'TOURIST', agencyId: null, roleCode: 'TOURIST' }
  ] as const;

  // agency_id=1 在 02_seed.sql 里才有；只跑 01/04/05/06 时 sys_user 的外键
  // fk_user_agency 会直接拒绝插入，所以这里自己兜一个 id=1 的机构（幂等）。
  await pool.query(
    `INSERT INTO travel_agency (id, agency_name, license_no, contact_name, contact_phone, status)
     VALUES (1, '联调旅行社', 'E2E-DEMO-LICENSE-0001', '联调', '13800000000', 'ACTIVE')
     ON DUPLICATE KEY UPDATE id = id`
  );

  const [roleRows] = await pool.query<RowDataPacket[]>('SELECT id, code FROM sys_role');
  const roleIdByCode = new Map<string, number>(roleRows.map((row) => [String(row.code), Number(row.id)]));
  for (const account of accounts) {
    if (!roleIdByCode.has(account.roleCode)) {
      throw new Error(`角色 ${account.roleCode} 不存在：请先执行 database/05_rbac_schema.sql`);
    }
  }

  for (const account of accounts) {
    await pool.query(
      `INSERT INTO sys_user (username, phone, password_hash, nickname, role, agency_id, status)
       VALUES (?,?,?,?,?,?,'ACTIVE')
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), nickname = VALUES(nickname),
                               agency_id = VALUES(agency_id), status = 'ACTIVE'`,
      [account.username, account.phone, passwordHash, account.nickname, account.role, account.agencyId]
    );
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM sys_user WHERE phone = ?', [account.phone]);
    const userId = String(rows[0].id);
    await pool.query('DELETE FROM sys_user_role WHERE user_id = ?', [userId]);
    await pool.query('INSERT INTO sys_user_role (user_id, role_id) VALUES (?,?)', [userId, roleIdByCode.get(account.roleCode)]);
  }
  console.log(`联调账号就绪（13800000001/2/3，密码 ${DEMO_PASSWORD}）\n`);
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/v1`;

  const login = async (mobile: string): Promise<string> => {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ mobile, password: 'Passw0rd!23' })
    });
    const body: any = await response.json();
    if (!body.data?.token) throw new Error(`登录失败 ${mobile}: ${JSON.stringify(body)}`);
    return body.data.token as string;
  };

  const call = async (token: string | null, path: string, method = 'GET', body?: unknown) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Idempotency-Key'] = randomUUID();
    if (method !== 'GET' && body === undefined) headers['Idempotency-Key'] = randomUUID();
    if (token && body !== undefined) {
      const timestamp = new Date().toISOString();
      const nonce = randomUUID();
      const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      headers['X-Timestamp'] = timestamp;
      headers['X-Nonce'] = nonce;
      headers['X-Signature'] = createHmac('sha256', token)
        .update(`${method}\n/v1${path}\n${timestamp}\n${nonce}\n${digest}`)
        .digest('hex');
    }
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as any };
  };

  await ensureDemoAccounts();
  const superToken = await login('13800000001');
  const agencyToken = await login('13800000002');
  const touristToken = await login('13800000003');
  console.log('三个角色登录成功\n');

  console.log('=== 0. 健康检查 / 管理接口角色矩阵 ===');
  check('匿名 GET /health → 200', (await call(null, '/health')).status, 200);
  check('游客 GET /admin/routes → 403/20013',
    [(await call(touristToken, '/admin/routes')).status, (await call(touristToken, '/admin/routes')).body.code],
    [403, 20013]);
  check('社管 GET /admin/routes → 200', (await call(agencyToken, '/admin/routes')).status, 200);
  check('超管 GET /admin/routes → 200', (await call(superToken, '/admin/routes')).status, 200);
  check('游客 GET /admin/orders → 403/20013',
    [(await call(touristToken, '/admin/orders')).status, (await call(touristToken, '/admin/orders')).body.code],
    [403, 20013]);
  check('社管 GET /admin/orders → 200', (await call(agencyToken, '/admin/orders')).status, 200);
  check('超管 GET /admin/orders → 200', (await call(superToken, '/admin/orders')).status, 200);

  console.log('=== 1. 未登录 / 当前用户 ===');
  check('未登录 GET /users/me → 401', (await call(null, '/users/me')).status, 401);

  const me = await call(superToken, '/users/me');
  check('超管 GET /users/me → 200', me.status, 200);
  check('返回角色数组含 SUPER_ADMIN', me.body.data.roles.map((r: any) => r.code), ['SUPER_ADMIN']);

  console.log('\n=== 2. GET /users/me/permissions（前端动态路由数据源）===');
  const touristPerms = await call(touristToken, '/users/me/permissions');
  check('游客 → 200 且获得 6 个业务按钮', [touristPerms.status, touristPerms.body.data.buttons.length], [200, 6]);
  check('游客按钮包含聊天/行程创建/预订权限',
    ['chat:session:query', 'chat:message:query', 'chat:message:add', 'itinerary:plan:add', 'order:booking:add', 'order:booking:query']
      .every((code) => touristPerms.body.data.buttons.some((button: any) => button.code === code)), true);
  check('游客可读取会话列表', (await call(touristToken, '/chat/sessions')).status, 200);
  const createdChat = await call(touristToken, '/chat/sessions', 'POST', { content: 'RBAC 联调消息' });
  check('游客可创建会话并写入首条消息', createdChat.status, 201);
  const chatHistory = await call(touristToken, `/chat/sessions/${createdChat.body.data.session_id}/messages`);
  check('游客可读取新会话历史', [chatHistory.status, chatHistory.body.data.total], [200, 1]);

  const agencyPerms = await call(agencyToken, '/users/me/permissions');
  const menuCodes = JSON.stringify(agencyPerms.body.data.menus);
  check('社管菜单根节点 = route + order', agencyPerms.body.data.menus.map((m: any) => m.code), ['route', 'order']);
  check('社管按钮数 = 8', agencyPerms.body.data.buttons.length, 8);
  check('按钮含 route:line:add', agencyPerms.body.data.buttons.some((b: any) => b.code === 'route:line:add'), true);
  check('不含 system 菜单', menuCodes.includes('"system"'), false);

  const superPerms = await call(superToken, '/users/me/permissions');
  check('超管按钮数 = 31（全部 BUTTON）', superPerms.body.data.buttons.length, 31);

  console.log('\n=== 3. 角色列表的越权拦截 ===');
  check('社管 GET /roles → 403/20013', [ (await call(agencyToken, '/roles')).status, (await call(agencyToken, '/roles')).body.code ], [403, 20013]);
  const roles = await call(superToken, '/roles');
  check('超管 GET /roles → 200', roles.status, 200);
  check('内置角色 3 个', roles.body.data.total, 3);
  check('字段符合契约（role_id/create_time/user_count）',
    Object.keys(roles.body.data.list[0]).filter((k) => ['role_id', 'name', 'code', 'status', 'create_time', 'user_count', 'permission_count'].includes(k)).length >= 6, true);
  console.log('   角色行示例：', JSON.stringify(roles.body.data.list[0]));

  console.log('\n=== 4. 角色 CRUD ===');
  const created = await call(superToken, '/roles', 'POST', { name: '线路运营', code: 'ROUTE_OP', description: '管理线路产品' });
  check('POST /roles → 201', created.status, 201);
  const newRoleId = created.body.data.role_id;
  console.log('   新角色 id =', newRoleId);
  const dup = await call(superToken, '/roles', 'POST', { name: '重复', code: 'ROUTE_OP' });
  check('编码重复 → 409/20015', [dup.status, dup.body.code], [409, 20015]);
  const badCode = await call(superToken, '/roles', 'POST', { name: '小写', code: 'route_op' });
  check('小写编码 → 400', badCode.status, 400);

  console.log('\n=== 5. 角色授权（全量覆盖 + 自动补祖先）===');
  const assign = await call(superToken, `/roles/${newRoleId}/permissions`, 'PUT', { permission_ids: ['101'] });
  check('只传按钮 101 → 自动补上 10、11', assign.body.data.permission_ids, ['10', '11', '101']);
  const readBack = await call(superToken, `/roles/${newRoleId}/permissions`);
  check('回读一致', readBack.body.data.permission_ids, ['10', '11', '101']);
  const clear = await call(superToken, `/roles/${newRoleId}/permissions`, 'PUT', { permission_ids: [] });
  check('清空授权 → 空数组', clear.body.data.permission_ids, []);
  const lockSuper = await call(superToken, '/roles/3/permissions', 'PUT', { permission_ids: [] });
  check('超管角色权限不可改 → 403', lockSuper.status, 403);
  const badPid = await call(superToken, `/roles/${newRoleId}/permissions`, 'PUT', { permission_ids: ['9999'] });
  check('不存在的权限 id → 400', badPid.status, 400);

  console.log('\n=== 6. 权限树 ===');
  const tree = await call(superToken, '/permissions');
  check('超管 GET /permissions → 200', tree.status, 200);
  check('权限总数 44', tree.body.data.total, 44);
  check('根节点 5 个模块', tree.body.data.list.map((n: any) => n.code), ['system', 'route', 'order', 'itinerary', 'chat']);
  check('system 下挂 3 个二级菜单', tree.body.data.list[0].children.map((c: any) => c.code), ['system:role', 'system:user', 'system:permission']);
  check('按钮数与 BUTTON 行数一致', tree.body.data.buttons.length, 31);

  console.log('\n=== 7. Casbin 策略热更新（组员2 阶段二验收点）===');
  // 权限 id：201 = route:line:add，204 = route:line:query（见 05_rbac_schema.sql 种子）
  const casbinRole = await call(superToken, '/roles', 'POST', { name: '策略验证角色', code: 'CASBIN_CHECK' });
  check('建临时角色 → 201', casbinRole.status, 201);
  const casbinRoleId = casbinRole.body.data.role_id;

  await call(superToken, `/roles/${casbinRoleId}/permissions`, 'PUT', { permission_ids: ['204'] });
  const asCasbinRole = { id: '0', roles: ['CASBIN_CHECK'], permissions: [] as string[] };
  check('Casbin：只给 query → 查询放行',
    await isAllowed(asCasbinRole, toPolicyRequest('route:line', 'query')), true);
  check('Casbin：只给 query → 新增拒绝（不是只读人就都能写）',
    await isAllowed(asCasbinRole, toPolicyRequest('route:line', 'add')), false);

  // 关键验收点：写接口返回后策略立即重载，无需等 30s 缓存过期
  await call(superToken, `/roles/${casbinRoleId}/permissions`, 'PUT', { permission_ids: ['201', '204'] });
  check('Casbin：补完 add 授权后立即生效（缓存已被写操作作废）',
    await isAllowed(asCasbinRole, toPolicyRequest('route:line', 'add')), true);

  const snapshot = await getPolicySnapshot();
  check('策略快照含 p,CASBIN_CHECK,route:line,add',
    snapshot.p.some((rule) => JSON.stringify(rule) === JSON.stringify(['CASBIN_CHECK', 'route:line', 'add'])), true);
  check('策略快照含用户→角色的 g 规则（≥3 个种子账号）', snapshot.g.length >= 3, true);
  console.log(`   策略条数：p=${snapshot.p.length}，g=${snapshot.g.length}`);
  await call(superToken, `/roles/${casbinRoleId}`, 'DELETE');

  console.log('\n=== 8. 删除保护 ===');
  const delBuiltin = await call(superToken, '/roles/1', 'DELETE');
  check('删内置角色 → 409', [delBuiltin.status, delBuiltin.body.code], [409, 20015]);
  const delUsed = await call(superToken, `/roles/${newRoleId}`, 'DELETE');
  check('删自建空角色 → 200', delUsed.status, 200);

  await pool.end();
  server.close();
  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} 项失败`}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (error) => {
  console.error('联调异常：', error);
  await pool.end();
  process.exit(1);
});
