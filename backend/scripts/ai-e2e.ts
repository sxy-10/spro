/**
 * AI 接入端到端验证：登录 → 平台 AI 状态/连通性 → 旅行社生成行程（真实 HTTP 链路）
 */
import 'dotenv/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const BASE = 'http://127.0.0.1:3001/v1';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function login(account: string, password: string): Promise<string> {
  const cap = await (await fetch(`${BASE}/auth/captcha`)).json() as { data: { captcha_id: string; dev_code: string } };
  const res = await fetch(`${BASE}/auth/login/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Captcha-Id': cap.data.captcha_id, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ account, password, captcha_code: cap.data.dev_code }),
  });
  const json = await res.json() as { code: number; data?: { token: string }; message?: string };
  if (json.code !== 0 || !json.data) throw new Error(`${account} 登录失败: ${json.message}`);
  return json.data.token;
}

async function call(path: string, method: string, token: string, body?: unknown) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const ts = new Date().toISOString().replace(/(\.\d{3})Z$/, '$1Z');
  const nonce = randomUUID();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Timestamp': ts,
    'X-Nonce': nonce,
    'X-Signature': createHmac('sha256', token)
      .update(`${method}\n/v1${path}\n${ts}\n${nonce}\n${sha256(payload)}`).digest('hex'),
  };
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(BASE + path, { method, headers, body: method === 'GET' ? undefined : payload });
  return await res.json() as { code: number; message: string; data?: any };
}

(async () => {
  const superTok = await login('super', 'Admin@2026');
  const adminTok = await login('admin', 'Admin@2026');

  const svc = await call('/platform/ai-service', 'GET', superTok);
  console.log('[1] AI 状态:', JSON.stringify(svc.data?.llm));

  const ping = await call('/platform/ai-service/test', 'POST', superTok, {});
  console.log('[2] 连通性测试:', JSON.stringify(ping).slice(0, 260));

  const t0 = Date.now();
  const draft = await call('/admin/plan-drafts', 'POST', adminTok, {
    message: '帮我规划云南大理丽江 5 天的线路，预算 9000，两个人，不吃辣，不要购物',
  });
  console.log('[3] 生成耗时(ms):', Date.now() - t0, 'code:', draft.code, 'msg:', draft.message);
  if (draft.code !== 0) { process.exit(1); }
  const d = draft.data;
  console.log('[4] plan_id:', d.plan_id, '| 标题:', d.plan_title);
  console.log('[5] ai_meta:', JSON.stringify(d.ai_meta));
  console.log('[6] 天数:', (d.days || []).length, '| 预算:', d.estimated_total_budget_rmb);
  const day1 = (d.days || [])[0] || {};
  console.log('[7] Day1:', day1.theme_title, '| 景点:',
    [].concat(day1.morning_activities || [], day1.afternoon_activities || []).map((a: any) => a.attraction_name).join(' / '));
  console.log('[8] Day1 酒店:', day1.accommodation?.hotel_name, day1.accommodation?.estimated_price_per_night_rmb);
  process.exit(0);
})();
