# 交接 · IM 第 3 棒（组员3）：可靠性四件事 + MQ 离线通知

> 交棒时间：2026-11-20 晚
> 上一棒：第 2 棒 组员1（WS 底座 + SSE 大屏）
> 下一棒：第 4 棒 组员4（游客端聊天界面）
> 依据：`docs/plan/第11次课-任务分工.md` §3 第 3 棒 3.1–3.9

> ⚠️ 文件命名说明：`docs/plan/交接-阶段3.md` 已被上一轮「授权后端」阶段占用（组员2），
> 为不覆盖历史文档，本棒交接文档命名为 `交接-阶段3-IM.md`（与 `交接-阶段2-IM.md` 同一命名规则）。

---

## 一、这一棒干了什么（逐条对账）

| # | 任务 | 状态 | 落点 |
|---|---|---|---|
| 3.1 | `msg` 帧：发号 + 落库 + 回 ACK + 广播 + 全员离线走 MQ | ✅ | `backend/src/im/wsServer.ts` `case 'msg'` |
| 3.2 | `ack` 帧：已读游标推进（`GREATEST` 只进不退，双表同事务） | ✅ | 同上 `case 'ack'` |
| 3.3 | `sync` 帧：断线重连按 `lastSeq` 增量重放 | ✅ | 同上 `case 'sync'` |
| 3.4 | `ackOkFrame` 工厂函数（协议里原来只有类型没有工厂） | ✅ | `backend/src/im/protocol.ts` |
| 3.5 | `listSince` 补 `m.seq` 列（sync 重放必须带 seq） | ✅ | `backend/src/im/messageService.ts` |
| 3.6 | MQ 生产：新 topic `im:notify` + `publishImNotify()`（带 MAXLEN 防膨胀） | ✅ | `backend/src/mq/producer.ts` |
| 3.7 | MQ 消费：`imNotifyConsumer.ts`（XREADGROUP → 在线跳过/离线 `INCR im:offline:{uid}` → XACK） | ✅ | `backend/src/mq/imNotifyConsumer.ts`（新建） |
| 3.8 | 启停钩子：`startImNotifyConsumer()` / `stopImNotify()` | ✅ | `backend/src/server.ts` |
| 3.9 | 自测脚本：幂等重发 + 批量已读压测 | ✅ | `backend/scripts/test/dupSend.mjs`、`backend/scripts/bench/batchRead.mjs` |
| 附加 | 群聊扩散选型文档 | ✅ | `docs/plan/im-群聊扩散选型.md` |

**没动的文件**：`database/*`（不需要新表）、`api/imRouter.ts`（REST 侧第 2 棒前已由组员2落地）、`im/hub.ts`、`im/presence.ts`、`mq/consumer.ts`（`seckill:stream` 一字未改）、`api/statsRouter.ts`。

---

## 二、验收命令（逐条跑，全过才算真正交棒）

```bash
# 1) Redis（离线通知 / 在线状态依赖）
docker start redis
docker exec redis redis-cli ping                        # 期望 PONG

# 2) 重新构建并起服务（本机 tsx 不可靠，必须 build 后跑 node）
cd backend
npm run build                                           # 期望零错误
node dist/server.js                                     # 日志有 im.ws.listening，且无 redis.unavailable

# 3) 幂等验证（同一 clientMsgId 发两次）
node scripts/test/dupSend.mjs
#   期望：第1次/第2次 seq 相同，输出「✅ 幂等 PASS：两次返回同一 seq = X，库里仅 1 条」

# 4) 批量已读压测（逐条 vs 一条 GREATEST 批量）
node scripts/bench/batchRead.mjs
#   期望：逐条 ~800ms / 批量 ~30ms / 加速比 20+ 倍；跑完自动清理 bench_ 用户

# 5) WS 双连接冒烟（两个终端各跑一次 wscat，流程见下）
```

### WS 双连接冒烟步骤（wscat，注意 5 秒鉴权窗口）

```bash
# ① 先拿 token（两个账号各一次）
curl -s -X POST http://127.0.0.1:3001/v1/auth/login \
  -H "Content-Type: application/json" -H "Idempotency-Key: handover-login-001" \
  -d "{\"mobile\":\"13811115678\",\"password\":\"Admin@2026\"}"
#    → 取返回 data.token（tourist01，user_id=11）

# ② 终端 A
npx wscat -c "ws://127.0.0.1:3001/v1/im/ws"
#   连上 5 秒内粘贴（提前拼好）：
{"t":"auth","token":"<token>","deviceId":"handover-a-0001"}
#   期望 {"v":1,"t":"auth_ok","userId":"11",...}

# ③ 发消息（测试会话 convId=1，参与者 11/12）
{"t":"msg","convId":"1","clientMsgId":"handover-msg-0001","content":"第3棒交接验证"}
#   期望 {"t":"ack_ok","clientMsgId":"handover-msg-0001","seq":<n>}

# ④ 终端 B 用 tourist02（13522220917）的 token 连上 auth 后，应实时收到广播 msg 帧
# ⑤ 终端 B 发已读
{"t":"ack","convId":"1","seq":<n>}
# ⑥ 终端 B 断开后，A 再发一条 → 消费者应 INCR 离线计数，可查：
docker exec redis redis-cli GET "im:offline:12"    # 默认无前缀（REDIS_KEY_PREFIX 为空）；若 .env 设了前缀则形如 "z3_im:offline:12"
```

### 本机实测结果（2026-11-20，留档）

| 项 | 结果 |
|---|---|
| `npm run build` | 零错误 |
| `dupSend.mjs`（3001） | 连跑两次均 PASS（seq=4、seq=5，库里各仅 1 条） |
| `batchRead.mjs`（5000 人） | 逐条 867ms / 批量 33ms / **26 倍** |
| WS 冒烟（3019 临时实例） | A 收 `ack_ok(seq=1)`、在线 B 收广播、幂等重发同 seq、`im_read_cursor.last_read_seq` 写入、`sync(lastSeq=0)` 重放 2 条 ✓ |

---

## 三、协议速查（第 4 棒对接必看）

### 3.1 客户端 → 服务端

| 帧 | 字段 | 约束 |
|---|---|---|
| `auth` | `token`（min 10）、`deviceId?`、`platform?` | 必须是**第一帧**，5 秒内发出，否则 `close(4002)` |
| `ping` | `ts?` | 客户端每 30s 一次；服务端回 `pong` |
| `msg` | `convId`（字符串或数字均可）、`clientMsgId`（**8~64 位**）、`content`（1~5000）、`type?`（TEXT/SYSTEM） | 同一 `clientMsgId` 重发不会产生第二条 |
| `ack` | `convId`、`seq` | 只推进不清零，乱序到达也不会回退 |
| `sync` | `convId`、`lastSeq?` | 服务端重放 `seq > lastSeq` 的消息（单次最多 200 条） |

### 3.2 服务端 → 客户端

| 帧 | 说明 |
|---|---|
| `auth_ok` | `{userId, deviceId, serverTs}` |
| `pong` | 心跳回执 |
| `ack_ok` | `{clientMsgId, seq}`，**发送方拿到它才认为消息已落库** |
| `msg` | 广播帧：`{convId, seq, clientMsgId, senderId, type, content, ts}`，也是 sync 重放用的同一种帧 |
| `error` | `{code, msg}`，常见 `not_authenticated` / `invalid_json` / `msg_failed` / `ack_failed` |
| `notify` | 离线通知（`notifyFrame`，由第 2 棒协议定义） |

### 3.3 关闭码

`4001` 心跳超时 / `4002` 鉴权超时 / `4003` 鉴权失败 / `4004` 无权限 / `4005` 服务端停机。

---

## 四、给第 4 棒（游客端聊天界面）的注意事项

1. **鉴权顺序**：连上必须先发 `auth`，且 5 秒内；开发期可以先从 `?token=` 走 query 鉴权（`ws://host/v1/im/ws?token=xxx`），生产建议用 auth 帧。
2. **发送语义**：前端先把消息以"发送中"状态上屏（乐观更新），收到同 `clientMsgId` 的 `ack_ok` 再把状态改成"已发送"并回填 `seq`；超时（如 5s）未收 `ack_ok` 就重发**同一个 clientMsgId**，服务端幂等，不会产生两条。
3. **重连**：断线按 1/2/4/8/16/30s 退避重连（协议已给 `backoffDelayMs`），重连成功后对当前会话发一次 `sync`（带本地最大 `lastSeq`）补齐断线期间的消息。
4. **sync 结束标识**：服务端**不发** `sync_done` 帧（只在服务端打 `im.ws.sync_done` 日志）。前端判断"重放结束"的方式：收到的 `msg` 帧 `seq` 不再递增、或收到下一条实时帧为止；也可用 300ms 静默窗口。**若前端确实需要显式结束帧，与本棒确认后再加，不要自己猜协议。**
5. **REST 兜底通道**：`POST /v1/im/messages`（body：`conversation_id`（**字符串**）、`client_msg_id`、`content`），WS 不可用时前端降级长轮询 + REST 发送。
6. **写接口通用规则**：`Idempotency-Key` ≥8 字符；登录态写接口还需 HMAC 三件套（`X-Timestamp` / `X-Nonce` / `X-Signature`，密钥 = access token，算法见 `scripts/test/dupSend.mjs` 的 `signedHeaders()`）。前端 `lib/http.ts` 已自动处理，手写脚本需自己算。
7. **会话创建**：`POST /v1/im/conversations` 需要 `im:conv manage` 权限，**游客没有**——会话由后台/客服侧创建，游客端只收发消息。
8. **测试数据**：`convId=1`（参与者 `user_id` 11=tourist01 / 12=tourist02）已建好，可直接联调。

---

## 五、已知问题 / 待办（不阻塞第 4 棒）

1. **sync 取数方式偏粗**：`listSince(convId, userId, 0)` 先取 200 条再内存按 `seq > lastSeq` 过滤；单会话消息超 200 条后会漏重放。修法：`listSince` 增加 `sinceSeq` 参数，SQL 直接 `AND m.seq > ?`（本次未改是为了不动组员2的签名，已在代码注释里标注）。
2. **离线计数是"提醒语义"的近似**：消费者按会话给所有离线参与者 `INCR`，不是精确未读数；精确未读数请用 `im_participant.last_read_seq` 与 `im_conversation.last_message_seq` 求差（REST 未读接口已是这个口径）。
3. **MQ 重复消费**：`INCR` 非严格幂等，Redis 抖动重投时可能多计一次；对"有新消息提醒"场景可接受，若做精准推送需改为"按 `(convId, seq, uid)` 去重"。
4. **`:3001` 老进程**：长时间挂着旧构建时，`msg` 会回 `not_implemented`——改完代码务必 `npm run build` 后重启。
5. **`im_device` 无 `online` 字段**：在线状态以 Redis `im:online:{uid}` hash 为准（`im/device` 表只记设备最近活跃时间）。
