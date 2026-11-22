/**
 * scripts/agentDomainE2E.mjs —— 客服接待域端到端验收（真实 HTTP，不走 mock）
 *
 * 覆盖一条完整业务链：
 *   游客发起咨询 → 落到待接入池 → 客服接入 → 双向发消息 → 结束会话
 *   → 游客评价 → 客服看评分 → 重新打开 → 放回队列
 *
 * 为什么要有它：
 *   接待域几乎全是写接口，而本项目的写接口强制「幂等键 + HMAC 签名」，
 *   手敲 curl 极易漏头（漏了只报 400 参数错误，排查成本很高）。
 *   这个脚本把签名、幂等键、token 全处理好，一条命令跑完全链路。
 *
 * 运行（先起后端）：
 *   cd backend && npx tsx src/server.ts        # 另开一个终端
 *   cd backend && node scripts/agentDomainE2E.mjs
 *
 * 可选环境变量：
 *   E2E_BASE=http://127.0.0.1:3001
 *   AGENT_MOBILE / AGENT_PASSWORD      客服账号（默认 staff02 / 13755553310）
 *   TOURIST_MOBILE / TOURIST_PASSWORD  游客账号（默认 tourist01 / 13811115678）
 *   DEMO_PASSWORD                      演示密码（默认 Admin@2026）
 */
import 'dotenv/config';

const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const PASSWORD = process.env.DEMO_PASSWORD || 'Admin@2026';
const AGENT = { mobile: process.env.AGENT_MOBILE || '13755553310', password: process.env.AGENT_PASSWORD || PASSWORD };
const TOURIST = { mobile: process.env.TOURIST_MOBILE || '13811115678', password: process.env.TOURIST_PASSWORD || PASSWORD };

const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];
const encoder = new TextEncoder();
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
const hmac = async (key, message) => {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
};

let passed = 0;
let failed = 0;
const expect = (condition, label, detail) => {
  if (condition) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failed += 1; console.log(`  ✗ ${label}${detail === undefined ? '' : ` → ${JSON.stringify(detail).slice(0, 300)}`}`); }
};

async function api(token, method, path, body) {
  const headers = { Accept: 'application/json' };
  const bodyText = body === undefined
    ? (WRITE.includes(method) ? '{}' : undefined)
    : JSON.stringify(body);
  if (bodyText !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  if (WRITE.includes(method)) {
    headers['Idempotency-Key'] = crypto.randomUUID();
    if (token) {
      const timestamp = new Date().toISOString();
      const nonce = crypto.randomUUID();
      headers['X-Timestamp'] = timestamp;
      headers['X-Nonce'] = nonce;
      headers['X-Signature'] = await hmac(
        token,
        [method, path, timestamp, nonce, await sha256(bodyText ?? '')].join('\n')
      );
    }
  }

  const res = await fetch(BASE + path, { method, headers, body: bodyText });
  const payload = await res.json().catch(() => ({ code: -1, message: '响应不是 JSON' }));
  return { http: res.status, code: payload.code, message: payload.message, data: payload.data };
}

const login = async (account) => {
  const res = await api('', 'POST', '/v1/auth/login', { mobile: account.mobile, password: account.password });
  if (res.code !== 0) throw new Error(`登录失败 ${account.mobile}：${res.code} ${res.message}`);
  return res.data.token;
};

const main = async () => {
  console.log(`\n=== 0. 登录（${BASE}）===`);
  const agentToken = await login(AGENT);
  const touristToken = await login(TOURIST);
  console.log('  ✓ 客服与游客均登录成功');

  console.log('\n=== 1. 游客发起咨询 → 待接入池 ===');
  const created = await api(touristToken, 'POST', '/v1/im/conversations', {});
  expect(created.code === 0 && created.data?.conversation_id, '新建会话成功', created);
  const convId = String(created.data?.conversation_id ?? '');
  if (!convId) throw new Error('没有拿到 conversation_id，后续无法继续');

  const firstMsg = await api(touristToken, 'POST', '/v1/im/messages', {
    conversation_id: convId,
    client_msg_id: `e2e_${Date.now()}_1`,
    content: '你好，我想咨询一下云南 5 天线路还有名额吗？'
  });
  expect(firstMsg.code === 0, '游客发出第一条消息', firstMsg);

  const queue = await api(agentToken, 'GET', '/v1/im/agent/queue?scope=pool&size=50');
  expect(queue.code === 0, '客服可读取待接入队列', queue);
  const poolRow = (queue.data?.list || []).find((row) => row.conversation_id === convId);
  expect(Boolean(poolRow), '新会话出现在待接入池', queue.data?.list?.slice(0, 3));
  if (poolRow) {
    expect(poolRow.assignee_id === null, '池中会话 assignee_id 为空（无人接待）');
    expect(typeof poolRow.wait_seconds === 'number', '返回已等待时长 wait_seconds');
    expect(Boolean(poolRow.counterpart_name), '能看到客户名', poolRow.counterpart_name);
    expect(String(poolRow.counterpart_phone || '').includes('****'), '手机号已脱敏', poolRow.counterpart_phone);
    expect(Boolean(poolRow.last_message_preview), '能看到最后一条消息预览', poolRow.last_message_preview);
  }

  console.log('\n=== 2. 接入（抢单）===');
  const claim = await api(agentToken, 'POST', `/v1/im/agent/conversations/${convId}/claim`, {});
  expect(claim.code === 0 && claim.data?.claimed === true, '客服接入成功', claim);

  const claimAgain = await api(agentToken, 'POST', `/v1/im/agent/conversations/${convId}/claim`, {});
  expect(claimAgain.code === 0 && claimAgain.data?.claimed === false, '重复接入幂等（claimed=false，不报错）', claimAgain);

  // 单坐席口径：不设接待状态与接待上限，接入不再写 im_agent_status
  const queueSorted = await api(agentToken, 'GET', '/v1/im/agent/queue?scope=mine&size=50');
  const times = (queueSorted.data?.list || []).map((row) => new Date(row.last_message_at || 0).getTime());
  expect(times.every((t, i) => i === 0 || times[i - 1] >= t), '队列按最近消息倒序（最近的排最前）', times.slice(0, 5));

  const myQueue = await api(agentToken, 'GET', '/v1/im/agent/queue?scope=mine&size=50');
  expect((myQueue.data?.list || []).some((row) => row.conversation_id === convId), '会话出现在「我的接待」', myQueue.data?.total);

  console.log('\n=== 3. 双向消息 ===');
  const reply = await api(agentToken, 'POST', '/v1/im/messages', {
    conversation_id: convId,
    client_msg_id: `e2e_${Date.now()}_2`,
    content: '在的，12 月 1 日还有 8 个名额，含接送机。'
  });
  expect(reply.code === 0, '客服回复成功', reply);

  const history = await api(touristToken, 'GET', `/v1/im/conversations/${convId}/messages?since_id=0`);
  const historyList = Array.isArray(history.data) ? history.data : history.data?.list || [];
  expect(historyList.length >= 2, '游客能拉到完整对话（≥2 条）', historyList.length);

  console.log('\n=== 4. 在线状态接口 ===');
  const presence = await api(agentToken, 'GET', `/v1/im/presence?user_ids=${poolRow?.counterpart_id ?? ''}`);
  expect(presence.code === 0, '批量在线查询可用', presence);
  expect(Array.isArray(presence.data?.items), '返回 items 数组', presence.data);

  console.log('\n=== 5. 结束会话 → 评价 → 评分汇总 ===');
  const closed = await api(agentToken, 'POST', `/v1/im/agent/conversations/${convId}/close`, { note: 'E2E 验收：已报价，客户考虑中' });
  expect(closed.code === 0 && closed.data?.status === 'CLOSED', '结束会话成功', closed);

  const rating = await api(touristToken, 'POST', `/v1/im/conversations/${convId}/rating`, {
    score: 5, comment: '回复很快，讲解清楚', tags: ['响应快', '讲解清楚']
  });
  expect(rating.code === 0, '游客提交评价成功', rating);

  const ratingAgain = await api(touristToken, 'POST', `/v1/im/conversations/${convId}/rating`, { score: 4 });
  expect(ratingAgain.code !== 0, '重复评价被拒绝（一条会话一次）', ratingAgain);

  const summary = await api(agentToken, 'GET', '/v1/im/agent/ratings');
  expect(summary.code === 0, '客服可查看评分汇总', summary);
  expect(Number(summary.data?.total) >= 1, '评分条数 ≥ 1', summary.data?.total);
  expect(Number(summary.data?.avg_score) > 0, '平均分有值', summary.data?.avg_score);

  console.log('\n=== 6. 重新打开 → 放回队列 ===');
  const reopened = await api(agentToken, 'POST', `/v1/im/agent/conversations/${convId}/reopen`, {});
  expect(reopened.code === 0 && reopened.data?.status === 'ACTIVE', '重新打开成功', reopened);

  const released = await api(agentToken, 'POST', `/v1/im/agent/conversations/${convId}/release`, {});
  expect(released.code === 0 && released.data?.assignee_id === null, '放回待接入队列', released);

  const poolAgain = await api(agentToken, 'GET', '/v1/im/agent/queue?scope=pool&size=50');
  expect((poolAgain.data?.list || []).some((row) => row.conversation_id === convId), '会话回到待接入池', poolAgain.data?.total);

  console.log('\n=== 7. 快捷话术 ===');

  const replies = await api(agentToken, 'GET', '/v1/im/quick-replies');
  expect(replies.code === 0 && (replies.data || []).length >= 7, '公共话术 ≥ 7 条', (replies.data || []).length);

  const newReply = await api(agentToken, 'POST', '/v1/im/quick-replies', { content: `E2E 个人话术 ${Date.now()}`, category: '测试' });
  expect(newReply.code === 0 && newReply.data?.is_shared === false, '新增个人话术', newReply);
  const delReply = await api(agentToken, 'DELETE', `/v1/im/quick-replies/${newReply.data?.id}`);
  expect(delReply.code === 0, '删除自己的话术', delReply);

  console.log('\n=== 8. 权限边界 ===');
  const touristQueue = await api(touristToken, 'GET', '/v1/im/agent/queue?scope=all');
  expect(touristQueue.http === 403 || touristQueue.code === 20013, '游客访问客服队列被拒（403）', touristQueue);

  console.log(`\n=== 结果：${passed} 项通过，${failed} 项失败 ===`);
  if (failed) process.exit(1);
  console.log(`  验收会话 conversation_id = ${convId}（保留在库里，可用于演示）`);
};

main().catch((error) => {
  console.error('\n验收中断：', error?.message ?? error);
  process.exit(1);
});
