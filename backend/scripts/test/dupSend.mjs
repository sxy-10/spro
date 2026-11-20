// 验证幂等：同一 client_msg_id 发两次（两个不同的 Idempotency-Key）→ 两次返回同一 seq，库里只有一条
// 关键点：写接口走 write() 中间件（important=true），除 Idempotency-Key 外还必须带 HMAC 三件套：
//   X-Timestamp（ISO UTC 时间）、X-Nonce（16+ 位随机串）、X-Signature = HMAC-SHA256(token, "METHOD\npath\ntimestamp\nnonce\nsha256(body)")
// 签名密钥就是当前 access token（与前端 lib/http.ts 的逻辑一致）。
import 'dotenv/config';
import http from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3001';
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const req = (method, path, bodyStr, headers = {}) => new Promise((res, rej) => {
  const r = http.request(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json',
      ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...headers }
  }, (resp) => { let b = ''; resp.on('data', (c) => (b += c)); resp.on('end', () => { try { res(JSON.parse(b)); } catch { res({ raw: b }); } }); });
  r.on('error', rej);
  if (bodyStr) r.write(bodyStr);
  r.end();
});

// 构造一次带签名的写请求头。每次调用换新的 Idempotency-Key 和 Nonce（Nonce 复用会被 20016 拦）。
function signedHeaders(method, path, bodyStr, token, keyLabel) {
  const timestamp = new Date().toISOString();          // 2026-11-20T11:03:15.123Z，zod datetime({offset:false}) 接受
  const nonce = randomUUID().replace(/-/g, '');        // 32 位十六进制，匹配 [A-Za-z0-9-]{16,128}
  const signature = createHmac('sha256', token)
    .update(`${method}\n${path}\n${timestamp}\n${nonce}\n${sha256(bodyStr)}`)
    .digest('hex');
  return { 'Idempotency-Key': keyLabel, 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Signature': signature };
}

// ---- 1. 登录 ----
const loginBody = JSON.stringify({ mobile: '13811115678', password: 'Admin@2026' });
const login = await req('POST', '/v1/auth/login', loginBody,
  { 'Idempotency-Key': 'dupsend-login-' + Date.now() });
const token = login.data?.token;
if (!token) { console.error('登录失败:', login); process.exit(1); }

// ---- 2. 同一 client_msg_id 发两次（故意用不同的 Idempotency-Key，
//         才能真正走到 send() 的"撞 UNIQUE(sender_id, client_msg_id) 预检"分支，
//         而不是被通用幂等缓存直接回放） ----
const CONV_ID = 1; // 已建好的测试会话（tourist01 + tourist02）
const clientMsgId = 'dup-test-' + Math.random().toString(36).slice(2, 10);
const msgBody = JSON.stringify({ conversation_id: String(CONV_ID), client_msg_id: clientMsgId, content: '幂等验证' });

const runSuffix = Date.now().toString(36); // 每次运行唯一的后缀：幂等指纹含 sessionId，固定 key 跨次运行会撞 20015

const r1 = await req('POST', '/v1/im/messages', msgBody,
  { Authorization: `Bearer ${token}`, ...signedHeaders('POST', '/v1/im/messages', msgBody, token, 'dupsend-key-1-' + runSuffix) });
const r2 = await req('POST', '/v1/im/messages', msgBody,
  { Authorization: `Bearer ${token}`, ...signedHeaders('POST', '/v1/im/messages', msgBody, token, 'dupsend-key-2-' + runSuffix) });

console.log('第1次: code =', r1.code, 'seq =', r1.data?.seq, r1.code !== 0 ? JSON.stringify(r1).slice(0, 160) : '');
console.log('第2次: code =', r2.code, 'seq =', r2.data?.seq, r2.code !== 0 ? JSON.stringify(r2).slice(0, 160) : '');

// ---- 3. 查库确认只有一条 ----
let dbCount = '?';
try {
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'travel_agent_db'
  });
  const [rows] = await conn.query('SELECT COUNT(*) c FROM im_message WHERE sender_id=? AND client_msg_id=?',
    [login.data.userId ?? 11, clientMsgId]);
  dbCount = rows[0].c;
  await conn.end();
} catch (e) { console.log('(查库失败，跳过：', e.message, ')'); }

if (r1.data?.seq !== undefined && r1.data.seq === r2.data?.seq && Number(dbCount) === 1) {
  console.log(`✅ 幂等 PASS：两次返回同一 seq = ${r1.data.seq}，库里仅 ${dbCount} 条`);
} else {
  console.log(`❌ FAIL（库里条数 = ${dbCount}）：检查上方响应`);
}
