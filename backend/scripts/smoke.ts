/**
 * scripts/smoke.ts —— 前后端联调冒烟测试（直连运行中的 3001 服务）
 * 覆盖：验证码 → 超管/社管登录 → 平台端 4 个核心接口 → 旅行社端 3 个核心接口 → 幂等写
 * 运行：npx tsx scripts/smoke.ts
 */
import 'dotenv/config';
import { createHmac, createHash, randomUUID } from 'node:crypto';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3001/v1';
const results: Array<[string, boolean, string]> = [];

function hash(s: string) { return createHash('sha256').update(s).digest('hex'); }

async function call(path: string, method: string, body: unknown, token?: string, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Timestamp'] = new Date().toISOString();
    headers['X-Nonce'] = randomUUID();
    const payload = JSON.stringify(body ?? {});
    headers['X-Signature'] = createHmac('sha256', token).update(`${method}\n/v1${path}\n${headers['X-Timestamp']}\n${headers['X-Nonce']}\n${hash(payload)}`).digest('hex');
  }
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as { code?: number; message?: string; data?: unknown } };
}

async function check(label: string, ok: boolean, detail: string) {
  results.push([label, ok, detail]);
  console.log(`${ok ? '  [OK] ' : '  [FAIL]'} ${label}${detail ? ' —— ' + detail : ''}`);
}

async function login(account: string, password: string) {
  const cap = await call('/auth/captcha', 'GET');
  const data = cap.json.data as { captcha_id: string; dev_code: string };
  const res = await fetch(BASE + '/auth/login/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Captcha-Id': data.captcha_id, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ account, password, captcha_code: data.dev_code })
  });
  const json = await res.json() as { code: number; data?: { token: string } };
  if (json.code !== 0) throw new Error(`${account} 登录失败: ${JSON.stringify(json).slice(0, 120)}`);
  return json.data!.token;
}

(async () => {
  console.log('=== 联调冒烟测试 ===', BASE);

  // 1. 登录链路
  let superToken = '', adminToken = '', touristToken = '';
  try {
    superToken = await login('super', 'Admin@2026');
    await check('超管登录（super）', true, '');
    adminToken = await login('admin', 'Admin@2026');
    await check('社管登录（admin）', true, '');
    touristToken = await login('tourist01', 'Admin@2026');
    await check('游客登录（tourist01）', true, '');
  } catch (e) {
    await check('登录链路', false, (e as Error).message);
    process.exit(1);
  }

  // 2. 平台端接口（super）
  const p1 = await call('/platform/overview', 'GET', undefined, superToken);
  await check('GET /platform/overview', p1.json.code === 0, `KPI=${JSON.stringify((p1.json.data as { kpi?: unknown })?.kpi ?? p1.json.message).slice(0, 80)}`);
  const p2 = await call('/platform/audits?type=route&audit_status=PENDING', 'GET', undefined, superToken);
  await check('GET /platform/audits', p2.json.code === 0, `total=${JSON.stringify((p2.json.data as { total?: unknown })?.total ?? p2.json.message)}`);
  const p3 = await call('/platform/finance/summary', 'GET', undefined, superToken);
  await check('GET /platform/finance/summary', p3.json.code === 0, '');
  const p4 = await call('/platform/ai-service', 'GET', undefined, superToken);
  await check('GET /platform/ai-service', p4.json.code === 0, '');
  const p5 = await call('/platform/analytics?days=30', 'GET', undefined, superToken);
  await check('GET /platform/analytics', p5.json.code === 0, '');
  const p6 = await call('/platform/system-meta', 'GET', undefined, superToken);
  await check('GET /platform/system-meta', p6.json.code === 0, '');
  const p7 = await call('/platform/users?user_type=ADMIN', 'GET', undefined, superToken);
  await check('GET /platform/users', p7.json.code === 0, '');

  // 3. 旅行社端接口（admin）
  const a1 = await call('/admin/dashboard', 'GET', undefined, adminToken);
  await check('GET /admin/dashboard', a1.json.code === 0, '');
  const a2 = await call('/admin/orders?status=PAID', 'GET', undefined, adminToken);
  await check('GET /admin/orders?status=PAID', a2.json.code === 0, '');
  const a3 = await call('/admin/customers', 'GET', undefined, adminToken);
  await check('GET /admin/customers', a3.json.code === 0, '');
  const a4 = await call('/admin/guides', 'GET', undefined, adminToken);
  await check('GET /admin/guides', a4.json.code === 0, '');
  const a5 = await call('/admin/teams', 'GET', undefined, adminToken);
  await check('GET /admin/teams', a5.json.code === 0, '');
  const a6 = await call('/admin/finance/summary', 'GET', undefined, adminToken);
  await check('GET /admin/finance/summary', a6.json.code === 0, '');
  const a7 = await call('/admin/settings', 'GET', undefined, adminToken);
  await check('GET /admin/settings', a7.json.code === 0, '');
  const a8 = await call('/plans?page=1', 'GET', undefined, adminToken);
  await check('GET /plans', a8.json.code === 0, '');

  // 4. 权限边界：游客访问平台接口应被拒
  const deny = await call('/platform/overview', 'GET', undefined, touristToken);
  await check('游客访问 /platform/overview 被拒', deny.json.code !== 0, `code=${deny.json.code}`);

  // 5. 幂等写：订单确认（PAID→CONFIRMED，重复确认 409）
  const paidList = await call('/admin/orders?status=PAID&size=1', 'GET', undefined, adminToken);
  const firstOrder = (paidList.json.data as { list?: Array<{ order_id: string }> })?.list?.[0];
  if (firstOrder) {
    const idem = randomUUID();
    const w1 = await call(`/admin/orders/${firstOrder.order_id}/confirm`, 'POST', { remark: '冒烟测试确认' }, adminToken, { 'Idempotency-Key': idem });
    await check('POST 确认订单（首次）', w1.json.code === 0, '');
    const w2 = await call(`/admin/orders/${firstOrder.order_id}/confirm`, 'POST', { remark: '冒烟测试确认' }, adminToken, { 'Idempotency-Key': idem });
    await check('同幂等键重放返回首次结果', w2.json.code === 0, '');
  } else {
    await check('存在待确认订单可测', false, '当前无 PAID 订单');
  }

  // 汇总
  const failed = results.filter((r) => !r[1]);
  console.log(`\n=== 结论：${results.length - failed.length}/${results.length} 通过 ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('冒烟异常：', e); process.exit(1); });
