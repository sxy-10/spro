#!/usr/bin/env node
/**
 * 登录拿 access token（第 2 棒 · 组员1 附加工具）
 *
 * 为什么需要它：
 *   这个项目**所有 POST/PUT/PATCH 都必须带 `Idempotency-Key` 头**，登录也不例外
 *   （core.ts 的 write() 第一行就 parse 它）。少这个头会返回
 *   `400 {"code":10001,"message":"参数为空、格式错误或超出允许范围"}`，
 *   而这条错误信息完全指不到"少了请求头"，排查起来非常费时间。
 *   手写 curl / PowerShell 很容易漏，所以提供这个脚本。
 *
 * 用法：
 *   node scripts/login-token.mjs --mobile=19983207913 --password=你的密码
 *   node scripts/login-token.mjs --mobile=... --password=... --json      # 输出完整 JSON
 *   node scripts/login-token.mjs --mobile=... --password=... | Set-Content .token.txt   # 存文件
 *
 * 可选参数：
 *   --base=http://127.0.0.1:3001   后端地址（默认 127.0.0.1:3001）
 *
 * 输出：一行 access token（默认）；加 --json 则输出 { token, user_id, expires_in, refresh_token }
 * 退出码：0 成功；1 失败（会在 stderr 打印后端返回的 code/message）
 *
 * 注意：token 有效期 30 分钟，过期重跑本脚本即可。
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const [key, value = 'true'] = item.replace(/^--/, '').split('=');
    return [key, value];
  })
);

const mobile = args.mobile;
const password = args.password;
const base = (args.base ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');

if (!mobile || !password) {
  console.error('用法: node scripts/login-token.mjs --mobile=<11位手机号> --password=<密码> [--base=http://127.0.0.1:3001] [--json]');
  process.exit(1);
}
if (!/^1\d{10}$/.test(mobile)) {
  console.error(`手机号格式不对：${mobile}（要求 11 位、以 1 开头）`);
  process.exit(1);
}
if (password.length < 8 || password.length > 72) {
  console.error('密码长度必须在 8~72 之间（后端 zod 规则）');
  process.exit(1);
}

const response = await fetch(`${base}/v1/auth/login`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // 关键：幂等键 8~128 字符，每次请求换一个；复用同一个键会直接回放上次结果
    'Idempotency-Key': globalThis.crypto.randomUUID()
  },
  body: JSON.stringify({ mobile, password })
});

const text = await response.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.error(`后端返回的不是 JSON（status=${response.status}）：${text.slice(0, 200)}`);
  process.exit(1);
}

if (!response.ok || payload.code !== 0) {
  console.error(`登录失败 status=${response.status} code=${payload.code} message=${payload.message}`);
  if (payload.code === 10001) {
    console.error('  提示：10001 有两种可能 —— ① 少了 Idempotency-Key 头（本脚本已带，不该再出现）');
    console.error('        ② 密码不对 / 账号不存在');
  }
  process.exit(1);
}

const data = payload.data ?? {};
if (args.json) {
  console.log(JSON.stringify(data, null, 2));
} else {
  // 默认只输出 token 本体，方便 `$token = node scripts/login-token.mjs ...`
  console.log(data.token);
}
