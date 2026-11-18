#!/usr/bin/env node
/**
 * IM WS 冒烟脚本（第 2 棒 · 组员1）
 *
 * 一条命令跑完第 2 棒的全部验收点：
 *   ① 连上 WS → 收到 auth_ok（握手 + 权限校验）
 *   ② 每 30s 发一次 ping → 收到 pong（心跳通）
 *   ③ 到点停发 ping → 30s 后被服务端 close(4001)（心跳超时）
 *
 * 用法：
 *   node scripts/ws-smoke.mjs --token=<access token>
 *   node scripts/ws-smoke.mjs --token=<token> --host=127.0.0.1 --port=3001 \
 *        --ping=30 --stop-after=35 --mode=auth-frame
 *
 * 参数：
 *   --token       必填，登录拿到的 access token（可用 scripts/login-token.mjs 生成）
 *   --host        默认 127.0.0.1
 *   --port        默认 3001
 *   --ping        心跳间隔秒数，默认 30
 *   --stop-after  多少秒后停止发 ping（用来观察 4001），默认 35
 *   --mode        query（默认，token 放 URL）| auth-frame（连上后发 auth 帧）
 *   --timeout     整体超时秒数，默认 90，超时自行退出
 *
 * 退出码：0 = 三个验收点全过；1 = 有验收点没过
 *
 * 实现要点（踩过）：
 *   心跳必须**等 auth_ok 之后**才开始发。之前是在 on('open') 里立刻 ping，
 *   结果 ping 先于服务端鉴权完成抵达，被回一帧 `not_authenticated`，
 *   紧接着鉴权完成再回 forbidden/4004 —— 看起来像"权限不足"，
 *   实际是脚本自己抢跑。见 2026-11 排查记录。
 */

import WebSocket from 'ws';

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const [key, value = 'true'] = item.replace(/^--/, '').split('=');
    return [key, value];
  })
);

const token = args.token;
if (!token) {
  console.error('缺少 --token=<access token>');
  console.error('可先执行：node scripts/login-token.mjs --mobile=<手机号> --password=<密码>');
  process.exit(1);
}

const host = args.host ?? '127.0.0.1';
const port = Number(args.port ?? 3001);
const pingSeconds = Number(args.ping ?? 30);
const stopAfterSeconds = Number(args.stopAfter ?? 35);
const mode = args.mode ?? 'query';
const overallTimeoutSeconds = Number(args.timeout ?? 90);
/** 等 auth_ok 的上限：超过就判定握手失败 */
const AUTH_WAIT_SECONDS = 10;

const url = mode === 'auth-frame'
  ? `ws://${host}:${port}/v1/im/ws`
  : `ws://${host}:${port}/v1/im/ws?token=${encodeURIComponent(token)}`;

const results = { authOk: false, gotPong: false, closed4001: false };
const startedAt = Date.now();
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1);

console.log(`[connecting] ws://${host}:${port}/v1/im/ws  mode=${mode}  token=***`);

const ws = new WebSocket(url);
let pingTimer = null;
let stopTimer = null;
let authWaitTimer = null;
let heartbeatStarted = false;
let finished = false;

const sendPing = () => {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ v: 1, t: 'ping', ts: Date.now() }));
};

/** 只在 auth_ok 之后调用：立刻打一次心跳，然后按间隔打；到点停 */
const startHeartbeat = () => {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  sendPing();
  pingTimer = setInterval(sendPing, pingSeconds * 1000);
  stopTimer = setTimeout(() => {
    clearInterval(pingTimer);
    console.log(`[stopping ping] ${elapsed()}s —— 现在开始不发 ping，等 30s 后被 close(4001)`);
  }, stopAfterSeconds * 1000);
};

const finish = () => {
  if (finished) return;
  finished = true;
  clearInterval(pingTimer);
  clearTimeout(stopTimer);
  clearTimeout(authWaitTimer);

  const passed = results.authOk && results.gotPong && results.closed4001;
  console.log('\n========== 冒烟结果 ==========');
  console.log(`① auth_ok                : ${results.authOk ? 'PASS' : 'FAIL'}`);
  console.log(`② pong（心跳）            : ${results.gotPong ? 'PASS' : 'FAIL'}`);
  console.log(`③ 停 ping 后 close(4001)  : ${results.closed4001 ? 'PASS' : 'FAIL'}`);
  console.log(`结论：${passed ? 'ALL PASS' : 'FAIL'}`);
  try {
    ws.close();
  } catch {
    /* 已经关了 */
  }
  process.exit(passed ? 0 : 1);
};

ws.on('open', () => {
  console.log(`[connected] ${elapsed()}s`);
  if (mode === 'auth-frame') {
    ws.send(JSON.stringify({
      v: 1, t: 'auth', token,
      deviceId: 'smoke-' + Math.random().toString(16).slice(2, 10)
    }));
  }
  // 等 auth_ok，超时就判失败（不再抢跑发 ping）
  authWaitTimer = setTimeout(() => {
    if (!results.authOk) {
      console.log(`[auth timeout] ${elapsed()}s 未收到 auth_ok，可能 token 过期或无 im:session:query 权限`);
      finish();
    }
  }, AUTH_WAIT_SECONDS * 1000);
});

ws.on('message', (raw) => {
  let frame;
  try {
    frame = JSON.parse(String(raw));
  } catch {
    console.log(`[bad frame] ${String(raw).slice(0, 120)}`);
    return;
  }

  switch (frame.t) {
    case 'auth_ok':
      results.authOk = true;
      clearTimeout(authWaitTimer);
      console.log(`[auth_ok] ${elapsed()}s userId=${frame.userId} deviceId=${frame.deviceId}`);
      startHeartbeat();
      break;
    case 'pong':
      results.gotPong = true;
      console.log(`[pong] ${elapsed()}s ts=${frame.ts} serverTs=${frame.serverTs}`);
      break;
    case 'error':
      console.log(`[error] ${elapsed()}s code=${frame.code} msg=${frame.msg}`);
      break;
    default:
      console.log(`[${frame.t}] ${elapsed()}s ${JSON.stringify(frame).slice(0, 160)}`);
  }
});

ws.on('close', (code, reason) => {
  const text = reason?.toString() || '';
  console.log(`[closed] ${elapsed()}s code=${code} reason=${text}`);
  if (code === 4001) results.closed4001 = true;
  finish();
});

ws.on('error', (error) => {
  console.error(`[ws error] ${error.message}`);
});

setTimeout(() => {
  console.log(`\n[timeout] ${overallTimeoutSeconds}s 到点，主动收尾`);
  finish();
}, overallTimeoutSeconds * 1000).unref?.();
