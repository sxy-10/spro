/**
 * 人工咨询全链路自检：新游客 → 自动建会话 → 消息落库 → 客服待接入池可见。
 *
 * 跑法（后端已启动在 3001）：
 *   node backend/scripts/test/imConsultFlow.mjs
 *
 * 它守住的是「断裂修复」里最容易回退的一环：ConsultChatScreen 首屏拿不到会话时
 * 必须自动建一条，否则新游客的每条消息都会 404（原来的盲退 DEFAULT_CONV_ID='1'）。
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

const API = 'http://127.0.0.1:3001/v1';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const randomId = () => randomBytes(18).toString('hex');

const post = async (path, body, token) => {
  const bodyText = JSON.stringify(body ?? {});
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // 全项目写接口统一要求幂等键（8~128 位），缺了直接 400
    'Idempotency-Key': randomId()
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    // 带登录态的写请求必须 HMAC 签名，否则后端 400/403
    headers['X-Timestamp'] = new Date().toISOString();
    headers['X-Nonce'] = randomId();
    const signedPath = `/v1${path}`;
    const content = ['POST', signedPath, headers['X-Timestamp'], headers['X-Nonce'], sha256(bodyText)].join('\n');
    headers['X-Signature'] = createHmac('sha256', token).update(content).digest('hex');
  }

  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers,
    body: bodyText
  });
  return { status: response.status, body: await response.json() };
};

const get = async (path, token) => {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
};

const run = async () => {
  // 1. 注册一个全新游客（手机号必须 1 开头 11 位）
  const mobile = `189${String(Date.now()).slice(-8)}`;
  const registered = await post('/auth/register', { mobile, password: 'Test123456' });
  console.log('① 注册新游客:', registered.status, JSON.stringify(registered.body).slice(0, 120));

  const login = await post('/auth/login', { mobile, password: 'Test123456' });
  // /auth/login 返回的字段名是 token（不是 access_token），refresh_token 用于续期
  const touristToken = login.body?.data?.token;
  if (!touristToken) {
    console.log('② 登录失败:', login.status, JSON.stringify(login.body));
    return;
  }
  console.log('② 游客登录成功, userId =', login.body.data.user_id);

  // 2. 新游客的会话列表必须为空（这正是原来盲退到会话 1 的触发条件）
  const before = await get('/im/conversations?size=1', touristToken);
  const beforeCount = (before.body?.data?.list ?? []).length;
  console.log('③ 会话列表(建会话前):', before.status, 'total =', beforeCount);

  // 3. 走前端同样的自动兜底：没有会话就创建
  const created = await post('/im/conversations', {}, touristToken);
  const convId = created.body?.data?.conversation_id;
  console.log('④ 自动建会话:', created.status, 'convId =', convId, JSON.stringify(created.body).slice(0, 200));
  if (!convId) return;

  // 4. 往新会话发第一条消息，验证不再是 404
  const sent = await post('/im/messages', {
    conversation_id: String(convId),
    client_msg_id: `cmsg_verify_${Date.now()}`,
    content: '【联调】新游客的第一条咨询'
  }, touristToken);
  console.log('⑤ 首条消息发送:', sent.status, 'seq =', sent.body?.data?.seq, sent.status === 200 || sent.status === 201 ? '✅ 不再是 404' : '❌');

  // 5. 客服侧待接入池应能看到这条会话
  // 13800000002 = demoAuthorization.mjs 里准备的社管/客服账号，密码统一 Passw0rd!23
  const staffLogin = await post('/auth/login', { mobile: '13800000002', password: 'Passw0rd!23' });
  const staffToken = staffLogin.body?.data?.token;
  if (!staffToken) {
    console.log('⑥ 客服账号登录失败(跳过池校验):', staffLogin.status, JSON.stringify(staffLogin.body).slice(0, 150));
    return;
  }
  const queue = await get('/im/agent/queue?scope=pool&size=20', staffToken);
  const ids = (queue.body?.data?.list ?? []).map((row) => String(row.conversation_id));
  console.log('⑥ 客服待接入池:', queue.status, 'pool total =', queue.body?.data?.total, '| 含本次会话 =', ids.includes(String(convId)) ? '✅' : '❌');
};

run().catch((error) => console.error('联调脚本异常:', error));
