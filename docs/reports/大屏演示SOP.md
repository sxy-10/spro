# 大屏演示 SOP（第 5 棒 · 组员5）

> 用途：下周检查 / 第 17 周答辩时，「数字大屏（Redis + MQ）」检查项的现场演示脚本。
> 对应老师笔记 B1：**大屏数字真的在动，说得清数据从哪来。**
> 前置：后端已启动（3001）、MySQL + Redis 就绪、`database/11_im.sql` / `12_im_perm.sql` 已迁移
> （没迁移过的话 WS 一律 4004，见《交接-阶段2-IM.md》坑 10）。

---

## 0. 启动（两条终端）

```bash
# 终端 1：后端（会打印 im.ws.listening）
cd backend && npm run dev

# 终端 2：B 端工作台（大屏 + 客服台都在这里，端口 5174）
cd frontend/agency-web && npm run dev
```

浏览器打开 `http://127.0.0.1:5174`。
演示账号：**顾问/管理角色**用户（AGENCY_ADMIN / AGENT，密码见
`backend/scripts/seedDemo.ts` 的 `PASSWORD` 常量）；用游客登录会看到「无权访问」——
这是 RBAC 的正确表现，不是 bug。

---

## 1. 演示动线（约 3 分钟）

### ① 大屏四个数字在动（核心镜头）

1. 登录后左侧点 **「实时大屏」**（权限码 `analytics:live:query`）。
2. 讲数据来源（一句话）：*「大屏不走轮询，后端每 5 秒聚合一条 SQL 通过 SSE 单向推送；
   在线人数来自 Redis `im:online:set`，消息吞吐来自 `im:stat:msg`，订单来自 MySQL。」*
3. **发消息让数字动**：另开一个窗口登录**游客**账号
   （`http://127.0.0.1:5173`，C 端「咨询」Tab）发一条消息 →
   大屏「**消息吞吐**」下一拍（≤5s）+1，折线抬升一格。
4. **在线人数**：再开第三个浏览器窗口（不同浏览器或无痕窗口）登录第二个账号 →
   「在线人数」下一拍 +1；**关掉那个窗口 ≤60s 后回落**（presence TTL 60s）。

### ② 客服台 1s 到达（任务三链路）

1. 切到 **「在线客服」**（权限码 `im:conv:manage`）。
2. 游客窗口发消息 → 客服台 **1s 内**收到（WS 推送），对应会话红点 +1、绿点亮起。
3. 顾问回复 → 游客窗口 1s 内显示；游客回一条，循环互发 2–3 条。

### ③ 断网自愈（加分镜头，可选）

游客窗口 DevTools → Network → Offline 持续 10–20s：
客服台顶部状态变「退避重连中…」，恢复网络后消息自动补齐（sync 增量对账）、无重复。
连续失败 3 次会看到「降级长轮询」黄字（`/v1/im/poll`），恢复后自动切回 WS。

---

## 2. 两个必答口径（答辩别被问住）

| 问题 | 答案 |
|---|---|
| 「秒杀 QPS 是真实 QPS 吗？」 | 不是被限流拦截的请求 QPS，是**最近 10 秒实际成交订单数 ÷ 10** 的下单速率口径（statsRouter 注释原文）。真实拦截 QPS 的 Redis 计数器属第 6 棒性能工作。 |
| 「degraded 是什么？为什么有块会红闪？」 | 后端任何一路数据源拿不到（Redis 挂 / 计数缺失 / MySQL 异常）时，**不中断流**，把降级项写进 `degraded` 字段；前端对受影响块做红闪 + 角标，保证大屏"坏一路不断全屏"。 |

### 现场看 Redis 证据（老师爱看这个）

```bash
redis-cli SCARD im:online:set          # 在线人数来源
redis-cli GET im:stat:msg              # 消息吞吐计数（前缀 z3_ 时加前缀）
redis-cli XLEN im:notify               # 离线通知 MQ 堆积（第 3 棒）
```

### curl 验证 SSE（不开浏览器也能看）

```bash
node backend/scripts/login-token.mjs --mobile=<手机号> --password=<密码>   # 取 token
curl -N -H "Authorization: Bearer <token>" http://127.0.0.1:3001/v1/stats/live
# 每 5s 一行 event: stats，data 里五个数字 + degraded 数组
```

---

## 3. 常见故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 大屏一直「连接中」 | 后端没起 / 5174 代理没配 / 未登录 | 看 Network 里 `/v1/stats/live` 状态码；401 = 先登录 |
| 大屏数字全 0 且 `degraded:["mysql"]` | MySQL 没起 / 表没建 | 起数据库，`npx tsx scripts/migrate.ts` |
| 客服台收不到消息、浏览器报 WS 失败 | vite 代理少了 `ws:true` | agency-web/vite.config.ts 已配，确认没被改动 |
| 游客连 WS 报 `close(4004)` | `12_im_perm.sql` 没执行 | 同上跑 migrate（坑 10） |
| 大屏数字「半天不动然后猛跳」 | Nginx 反代没关缓冲 | 确认 `X-Accel-Buffering: no`（第 2 棒坑 6） |
