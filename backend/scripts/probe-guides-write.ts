import 'dotenv/config';
import { createHmac, createHash, randomUUID } from 'node:crypto';

const BASE = 'http://127.0.0.1:3001/v1';
const PWD = ['Admin', '@', '2026'].join('');

function sign(tok: string, method: string, pathWithQuery: string, body: string) {
  const ts = new Date().toISOString();
  const nonce = randomUUID();
  const sig = createHmac('sha256', tok)
    .update(`${method}\n/v1${pathWithQuery}\n${ts}\n${nonce}\n${createHash('sha256').update(body).digest('hex')}`)
    .digest('hex');
  return { 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': sig };
}

async function call(tok: string, method: string, path: string, body?: unknown) {
  const b = body === undefined ? '' : JSON.stringify(body);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
  Object.assign(headers, sign(tok, method, path, b));
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const r = await fetch(BASE + path, { method, headers, body: method === 'GET' ? undefined : b });
  return { http: r.status, ...(await r.json() as any) };
}

async function login(acc: string) {
  const cap: any = await (await fetch(BASE + '/auth/captcha')).json();
  const r = await fetch(BASE + '/auth/login/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Captcha-Id': cap.data.captcha_id, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ account: acc, password: PWD, captcha_code: cap.data.dev_code }),
  });
  const j: any = await r.json();
  if (j.code !== 0) throw new Error(acc + ' 登录失败 ' + JSON.stringify(j));
  return j.data.token as string;
}

const ok = (label: string, res: any) =>
  console.log(`${res.code === 0 ? '✓' : '✗'} ${label}  http=${res.http} code=${res.code}${res.code ? ' msg=' + res.message : ''}`);

(async () => {
  const tok = await login('admin');

  console.log('\n=== 导游 CRUD ===');
  const lic = 'D-SC-' + Math.floor(1e7 + Math.random() * 8e7);
  const created = await call(tok, 'POST', '/admin/guides', {
    name: '林小满', gender: '女', phone: '138' + String(Math.floor(1e7 + Math.random() * 9e7)), license_no: lic,
    specialty: '自然风光', bio: '九寨沟/黄龙专线，从业 6 年。',
  });
  ok('创建导游', created);
  const gid = created.data?.guide_id ?? created.data?.id;

  ok('编辑导游', await call(tok, 'PUT', '/admin/guides/' + gid, { name: '林小满', specialty: '自然风光 · 摄影' }));
  const off = await call(tok, 'PATCH', '/admin/guides/' + gid, { status: 'DISABLED' });
  ok('停用导游', off);
  const assignDisabled = await call(tok, 'GET', '/admin/guides?status=ACTIVE&page=1&size=100');
  const activeIds = (assignDisabled.data?.list || []).map((g: any) => String(g.guide_id));
  console.log('   停用后是否从在职列表移除:', !activeIds.includes(String(gid)));
  ok('重新启用', await call(tok, 'PATCH', '/admin/guides/' + gid, { status: 'ACTIVE' }));

  console.log('\n=== 团队 ===');
  const routes = await call(tok, 'GET', '/admin/routes?page=1&size=5');
  const route = (routes.data?.list || [])[0];
  console.log('   可用线路:', (routes.data?.list || []).map((r: any) => r.route_id + ':' + r.title).join(' / ') || '(无)');
  const sheet = '2099-06-' + String(Math.floor(10 + Math.random() * 18));
  const team = await call(tok, 'POST', '/admin/teams', { route_id: route.route_id, travel_date: sheet, max_members: 18, remark: '联调验证团队' });
  ok('创建团队', team);
  const teamNo = team.data?.team_no;
  console.log('   team_no:', teamNo);

  if (teamNo) {
    const guides = await call(tok, 'GET', '/admin/guides?status=ACTIVE&page=1&size=100');
    const g = (guides.data?.list || [])[0];
    ok('指派导游 ' + (g && g.name), await call(tok, 'PUT', '/admin/teams/' + encodeURIComponent(teamNo), { guide_id: g.guide_id }));
    const members = await call(tok, 'GET', '/admin/teams/' + encodeURIComponent(teamNo) + '/members');
    ok('查看成员名单（' + (members.data?.list || []).length + ' 人）', members);
    ok('状态流转 → DEPARTED', await call(tok, 'PUT', '/admin/teams/' + encodeURIComponent(teamNo), { status: 'DEPARTED' }));
    ok('状态回退 DEPARTED→RECRUITING 应被拒(409)', await call(tok, 'PUT', '/admin/teams/' + encodeURIComponent(teamNo), { status: 'RECRUITING' }));
    ok('人数上限调低到 5（无成员，应通过）', await call(tok, 'PUT', '/admin/teams/' + encodeURIComponent(teamNo), { max_members: 5 }));
  }

  console.log('\n=== 清理 ===');
  if (teamNo) console.log('   团队 ' + teamNo + ' 保留为演示数据（状态 DEPARTED）');
  console.log('   导游 ' + gid + ' 保留（ACTIVE，' + lic + '）');
})().catch((e) => console.log('ERR', e.message));
