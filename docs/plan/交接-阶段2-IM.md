# 交接 · IM 第 2 棒（组员1）：WS 底座 + 大屏数据

> 交棒时间：D2.5 前
> 下一棒：第 3 棒 组员3（可靠性：发号 / 幂等 / ACK / 离线同步 / MQ 通知）
> 依据：`第11次课-任务分工(六棒接力版).md` §3 第 2 棒 2.1–2.9

> ⚠️ 文件命名说明：`docs/plan/交接-阶段2.md` 已被上一轮「秒杀后端全链路」阶段占用，
> 为不覆盖历史文档，本棒交接文档命名为 `交接-阶段2-IM.md`。

---

## 一、这一棒干了什么（逐条对账）

| # | 任务 | 状态 | 落点 |
|---|---|---|---|
| 2.1 | 装 `ws` + `@types/ws` | ✅ 依赖里已有（`ws ^8.23.0` / `@types/ws ^8.18.2`），未改动 | `backend/package.json` |
| 2.2 | 协议帧与常量（`v`、`t`、30s/10s、重连台阶） | ✅ | `backend/src/im/protocol.ts` |
| 2.3 | `attachWs(httpServer)`，路径 `/v1/im/ws`，握手验 token → 复用/生成 `deviceId` | ✅ | `backend/src/im/wsServer.ts` |
| 2.4 | 心跳与超时：30s 无 ping / 10s 无 pong → `close(4001)`，日志 `im.ws.heartbeat_timeout` | ✅ | 同上 |
| 2.5 | 连接注册表 + `sendToUser()` / `sendToConv()` | ✅ | `backend/src/im/hub.ts` |
| 2.6 | 在线状态 Redis Hash `im:online:{userId}`（deviceId→lastSeen，TTL 60s，ping 续期） | ✅ | `backend/src/im/presence.ts` |
| 2.7 | `statsRouter` 换成真数据：在线人数 / 今日订单 / 消息吞吐 / 秒杀 QPS | ✅ | `backend/src/api/statsRouter.ts` |
| 2.8 | `http.createServer(app)` → `attachWs(server)` → `server.listen()` | ✅ | `backend/src/server.ts` |
| 2.9 | 交接文档（含三段示例代码） | ✅ | 本文件 |
| 附加 | 冒烟脚本（自动跑完"连上→auth_ok→停 ping→close 4001"） | ✅ | `backend/scripts/ws-smoke.mjs` |

**没动的文件**：`database/*`（本棒不需要新表）、`api/imRouter.ts`、`im/messageService.ts`、`app.ts`、`mq/*`。

---

## 二、怎么跑

```bash
# 1) 起服务（会打印 im.ws.listening）
cd backend
npm run dev            # 或 npm run build && npm start

# 2) 拿一个游客 token —— 用脚本（推荐，自动带 Idempotency-Key）
node scripts/login-token.mjs --mobile=<11位手机号> --password=<8~72位密码>
#    → 直接打印 access token（有效期 30 分钟）

#    等价的 curl 写法（⚠️ 三个坑都在这里）
#    - 入参字段是 mobile，不是 phone（schema .strict()，写错报 10001）
#    - POST/PUT/PATCH 必须带 Idempotency-Key（8~128 字符），登录也一样；
#      漏了它返回的也是 10001「参数为空、格式错误或超出允许范围」，指不到原因
#    - 返回字段叫 data.token，没有 access_token
curl -s -X POST http://127.0.0.1:3001/v1/auth/login \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(powershell -c '[guid]::NewGuid()')" \
  -d '{"mobile":"<11位手机号>","password":"<8~72位密码>"}'

# 3) 冒烟（推荐，一条命令跑完全部验收点）
node scripts/ws-smoke.mjs --token=<token>

# 3') 或者用 wscat 手连（分工文档的验收方式）
npx wscat -c "ws://127.0.0.1:3001/v1/im/ws?token=<token>"
#   连上立刻收到 {"v":1,"t":"auth_ok","userId":"12","deviceId":"...","serverTs":...}
#   不发 ping 等 30s → 服务端日志 im.ws.heartbeat_timeout + 客户端 close(4001)

# 4) 在线状态
redis-cli HGETALL im:online:12        # deviceId → 毫秒时间戳
redis-cli SCARD im:online:set         # 当前在线人数

# 5) 大屏 SSE（每 5s 一行 data）
curl -N -H "Authorization: Bearer <token>" http://127.0.0.1:3001/v1/stats/live
```

**冒烟脚本输出的期望**：

```
[connected]
[auth_ok] userId=12 deviceId=...
[pong] ts=... serverTs=...            ← 每 30s 一次
[stopping ping] 现在开始不发 ping
[closed] code=4001 reason=heartbeat_timeout    ← 30s 后
```

---

## 三、协议帧怎么用（三段示例）

### 1）客户端：连上 → 鉴权 → 每 30s 心跳（第 4 棒照抄）

```ts
import WebSocket from 'ws';

const ws = new WebSocket(`ws://127.0.0.1:3001/v1/im/ws?token=${token}`);

ws.on('open', () => {
  // 用 query token 时服务端会自动出 auth_ok；也可以显式发 auth 帧（推荐，便于多端 deviceId）
  ws.send(JSON.stringify({ v: 1, t: 'auth', token, deviceId: localStorage.getItem('deviceId') ?? undefined }));
  const timer = setInterval(() => ws.send(JSON.stringify({ v: 1, t: 'ping', ts: Date.now() })), 30000);
  ws.on('close', () => clearInterval(timer));
});

ws.on('message', (raw) => {
  const frame = JSON.parse(String(raw));
  switch (frame.t) {
    case 'auth_ok': /* 记下 frame.deviceId，后续重连复用 */ break;
    case 'pong':    /* 10s 内没收到就主动重连 */ break;
    case 'msg':     /* 按 seq 入本地列表 */ break;
    case 'notify':  /* 会话列表红点 */ break;
    case 'error':   /* 按 frame.code 决定是否重试 */ break;
  }
});
```

### 2）服务端：往某个用户推（第 3 棒的通知消费者会用到）

```ts
import { hub } from './im/hub.js';
import { notifyFrame } from './im/protocol.js';

const delivered = hub.sendToUser(userId, notifyFrame('new_message', convId, preview));
if (delivered === 0) {
  // 没人在线 → 这一步交给第 3 棒写 MQ（im:notify），不要在这里阻塞
}
```

### 3）服务端：落库成功后推给整个会话（第 3 棒 `messageService.send()` 最后一步）

```ts
import { sendToConv } from './im/hub.js';
import { PROTOCOL_VERSION } from './im/protocol.js';

await sendToConv(message.conversation_id, {
  v: PROTOCOL_VERSION,
  t: 'msg',
  convId: String(message.conversation_id),
  seq: message.seq,
  clientMsgId: message.client_msg_id,
  senderId: String(message.sender_id),
  type: message.content_type,
  content: message.content,
  ts: Date.now()
});
// 返回 0 表示所有参与者都离线 —— 由第 3 棒决定要不要补 MQ 离线通知
```

---

## 四、踩过的坑（下一棒直接避开）

1. **`app.listen()` 拿不到 http.Server**
   express 的 `app.listen` 内部自己 new 了一个 server，没法挂 `upgrade` 事件。
   必须 `createServer(app)` → `attachWs(server)` → `server.listen()`，**顺序反了**启动瞬间的 upgrade 会被销毁。

2. **`noServer: true` 时必须自己判路径**
   否则任何 `Upgrade` 请求（包括误打过来的）都会被升级成 WS。现在非 `/v1/im/ws` 一律回 404 并 `socket.destroy()`。

3. **`ws` 的常量在类上，不在实例上**
   写 `socket.OPEN` 会得到 `undefined`（`ws` 库与浏览器 WebSocket 行为不同），
   必须 `import { WebSocket } from 'ws'` 然后 `WebSocket.OPEN`。

4. **4096/4001 这类业务关闭码不能被普通 `terminate` 复现**
   `socket.terminate()` 直接砸 TCP，客户端拿不到 close 码，重连策略就失效。
   统一走 `ws.close(code, reason)`，再挂 1s 兜底 `terminate()`（客户端不回 close 帧时）。

5. **原生 ping/pong 与应用层 ping/pong 是两套东西**
   应用层（协议帧 `ping`/`pong`）判"客户端还活着"，原生（`ws.ping()`）判"TCP 还活着"。
   拔网线时应用层可能还能收到缓存里的帧，只有原生 pong 缺失能识别半死连接 —— 两者都要。

6. **SSE 一定要关代理缓冲**
   `X-Accel-Buffering: no`，否则 Nginx 会把 5s 一行的数据攒成一大坨，演示时大屏"半天不动然后猛跳"。

7. **`im:online:set` 会残留僵尸 id**
   进程被 `kill -9` 时来不及 `hdel`，Hash 60s 自然过期，但 Set 里的 id 不会自己消失。
   已加 `startPresenceJanitor()`（30s 一次 `sweepStaleUsers`）。

---

8. **写接口必须带 `Idempotency-Key`，登录也不例外**
   `core.ts` 的 `write()` **第一行**就 `parse(req.get('Idempotency-Key'))`，
   缺了它返回的是 `400 {"code":10001,"message":"参数为空、格式错误或超出允许范围"}` ——
   这条文案完全指不到"少了请求头"，实测能把人卡半小时（本棒就踩了）。
   已提供 `backend/scripts/login-token.mjs` 自动带键，取 token 别再手拼 curl。

9. **已登录之后的写请求还要 HMAC 签名（第 3/4 棒的 HTTP 降级发送会撞上）**
   `important=true` 的写接口（默认）额外要求 `X-Timestamp`（UTC ISO8601）、
   `X-Nonce`（16~128 位字母数字或中划线）、`X-Signature`（64 位小写 hex）：
   ```
   X-Signature = HMAC-SHA256(key = access token)
                 的 hex，消息为下面各行用 \n 连接（末尾无换行）：
   HTTP_METHOD
   /v1/完整路径
   X-Timestamp
   X-Nonce
   sha256(JSON.stringify(body))
   ```
   时间戳 ±5 分钟、nonce 落库防重放；同一个 `Idempotency-Key` 重试会直接回放首次结果。
   规格原文见 `docs/specs/API_V1.md` §HTTP 契约。
10. **`im_*` 表和 IM 权限码必须真的执行过迁移，否则 WS 一律 4004**
    本轮实测发现：`database/11_im.sql` 与 `12_im_perm.sql` 只是**写好了文件**，
    但 `migrate` 从来没跑过 —— `information_schema` 里 `im_*` 一张表都没有，
    `sys_permission` 里也没有任何 `im*` 码。表现是：token 有效，但
    `{"code":"forbidden","msg":"缺少 im:session:query 权限"}` → `close(4004)`，
    很容易被误判成"权限配错了"。
    排查命令（30 秒定位）：
    ```sql
    SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA='travel_agent_db' AND TABLE_NAME LIKE 'im%';      -- 应为 5 张
    SELECT COUNT(*) FROM sys_permission WHERE code LIKE 'im%';             -- 应 > 0
    SELECT p.code FROM sys_role r
      JOIN sys_role_permission rp ON rp.role_id=r.id
      JOIN sys_permission p ON p.id=rp.permission_id
     WHERE r.code='TOURIST' AND p.code LIKE 'im%';                         -- 应含 im:session:query
    ```
    修复：`npx tsx scripts/migrate.ts`（两个文件都是 `IF NOT EXISTS` / `INSERT IGNORE`，可重跑）。
## 五、下一棒（第 3 棒 组员3）从这里开工

**授权你改的**：`backend/src/im/wsServer.ts` 的 `msg` / `ack` / `sync` 三个分支（现在回 `not_implemented`，位置有 `TODO(第3棒)` 标记）。

**直接用的**：

| 你要做的事 | 用这个 |
|---|---|
| 落库后广播给会话所有人 | `sendToConv(convId, frame)` — `backend/src/im/hub.ts` |
| 推给某个人（离线通知走 WS 时） | `hub.sendToUser(userId, frame)` |
| 构造 `msg` / `notify` 帧 | `PROTOCOL_VERSION`、`notifyFrame()`、帧类型 — `backend/src/im/protocol.ts` |
| 判"这个人现在在不在线" | `onlineDevices(userId)` / `onlineUserCount()` — `backend/src/im/presence.ts` |
| 大屏要加"消息吞吐" | 每次发送成功后 `incrBy('im:stat:msg', 1)`（第 3 棒负责加） |

**未完成 / 明确留给第 3 棒**：

- `msg` 帧：发号（`INCR im:seq:{convId}`）→ 事务落库 → 更新 `im_conversation.last_message_seq` → `sendToConv` → 回 `ack_ok`
- `ack` 帧：已读游标 `GREATEST(last_read_seq, ?)`
- `sync` 帧：断线对账（按 `lastSeq` 增量推）
- `im:stat:msg` 计数器（大屏的"消息吞吐"现在读它，没有值时会回退成 MySQL 当日计数，`degraded` 里会标出来）

---

## 六、验收清单（第 3 棒开工前必跑）

```bash
node backend/scripts/ws-smoke.mjs --token=<token>
#   ✅ [auth_ok]                 → 握手鉴权通过
#   ✅ [pong] 每 30s             → 心跳通
#   ✅ [closed] code=4001        → 停 ping 30s 被踢

redis-cli SCARD im:online:set   # ≥1
redis-cli HGETALL im:online:<userId>  # 有 deviceId → lastSeen

curl -N -H "Authorization: Bearer <token>" http://127.0.0.1:3001/v1/stats/live
#   ✅ 每 5s 一行 event: stats，data 里五个数字齐全
```
---

## 七、本轮实测验收记录（2026-11-18）

环境：MySQL `travel_agent_db` + Redis `127.0.0.1:6379` 均就绪；服务 `npm run dev`（端口 3001）。

| 验收点 | 实测结果 |
|---|---|
| `node scripts/login-token.mjs --mobile=19983207913 --password=***` | 成功，token 长度 259 |
| `node scripts/ws-smoke.mjs --token=<token>` | **ALL PASS** |
| ① auth_ok | `[auth_ok] 0.0s userId=3 deviceId=c9365157-...` |
| ② pong | `[pong] 0.0s` / `[pong] 30.0s`（间隔 30s，符合设计） |
| ③ 停 ping → 4001 | `[stopping ping] 35.0s` → `[closed] 60.5s code=4001 reason=heartbeat_timeout` |
| Redis 回收 | 断开后 `im:stat:conn=0`、`im:online:set` 自动消失、无 `im:online:*` 残留 |
| 错误路径 | 无效 token → `error{invalid_token}` + `close(4003)`；不发 auth → `close(4002)@9s`；错误路径 → HTTP 404 |
| 协议帧 | 12 条用例全对（合法帧通过；`invalid_msg`/`unknown_frame`/`unsupported_version`/`frame_too_large` 等拒绝） |

> 第 3 棒开工时把这四行原样复跑一遍即可确认底子没坏。
