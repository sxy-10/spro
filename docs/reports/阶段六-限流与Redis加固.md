# 阶段六加固说明：网关限流 / Redis 原子性 / 消息队列

> 本文对应 `deploy/nginx/nginx.conf` 与 `backend/src/{db,auth,api,mq}` 的改造，
> 以及三个可复跑的验证脚本：`scripts/redis-smoke.ts`、`scripts/seckill-e2e.ts`、`scripts/mq-replay.ts`。

## 一、修了什么（按问题归类）

### 1. 网关限流

| 问题 | 处理 |
|---|---|
| 仓库里没有 `deploy/nginx/`，限流只在文档里 | 新建 `deploy/nginx/nginx.conf`：`events` 块 + `upstream keepalive` + 4 个独立限流桶（秒杀下单 / 结果轮询 / 登录鉴权 / 普通 API）+ `limit_conn` |
| 秒杀下单和结果轮询共用一个桶（前端 1s×10 轮询会把下单挤掉） | 拆成 `seckill_ip` 与 `poll_ip` 两个 zone |
| `limit_req_status 503` 与业务 503 语义冲突、返回纯文本 | 统一 `429 + Retry-After`，并用 `error_page` 返回 JSON（前端 `http.ts` 按 `code` 解析） |
| 缺 `X-Forwarded-For`，后端 `req.ip` 全是 127.0.0.1 | nginx 补 `proxy_set_header`，后端 `.env` 改 `TRUST_PROXY=1`（否则全站共用一个限流桶，120 次/分钟后全站 429） |
| 无 slow-request 超时，AI 接口会 504 | `/v1/(chat|ai)` 单独 `proxy_read_timeout 120s` + `proxy_buffering off`（流式） |

### 2. Redis：怎么存、怎么保证原子性

| 问题 | 处理 |
|---|---|
| `retryStrategy: () => null` → Redis 断一次就永久降级 | 改为指数退避（200ms→3s 封顶）永不放弃；`reconnectOnError` 处理 READONLY/LOADING |
| 登录失败计数 `INCR` + `EXPIRE` 两条命令，中间崩溃 → 账号永久锁死 | 新增 `db/lua/login_fail.lua`：一次 EVAL 完成自增 + 设 TTL，并自愈历史无 TTL 脏 key |
| `auth/security.ts` 另开一个 Redis 客户端、key 不带前缀、明文放手机号 | 统一走 `db/redis.ts` 的客户端与 `redisKey()`；key 改为 `login_fail:<sha256(手机号)前32位>` |
| 登录态缓存 key 用 JWT 原文（会进 RDB / SLOWLOG / MONITOR） | 改为 `auth:sess:<sha256(token)>`，并新增 `auth:user:<id>:sessions` 索引支持"改密码后踢下线" |
| 改密码 / RBAC 改权限后 Redis 缓存仍在，旧 token 5 分钟内照用 | 重置密码、`/admin/users/:id` 写操作后调用 `dropUserSessions()` |
| 秒杀路由用查库版 `authenticate`，完全没吃登录缓存 | 换成 `authenticateJwt`（缓存命中 0 次 SQL），并顺带吃到 `router.ts` 的全局限流 |
| 限流用 MySQL 每分钟计数：每请求 2 条 SQL、非原子、表无限涨（实测 141 行） | 新增 `db/lua/token_bucket.lua` 令牌桶，一次 EVAL 完成补令牌 + 判定；MySQL 只作降级；新增 `api_rate_limit` 定时清理 |
| 库存 key 只在启动预热一次，Redis 重启后一律"售罄" | `deduct_stock.lua` 返回 `not_warmed`；路由发现 key 不存在就从 MySQL 回填后重试；新增 5 分钟一次的对账任务（仅队列空闲时） |
| `hashSetAll` 的 HSET 与 EXPIRE 非原子 | 改用 MULTI/EXEC，避免"永不失业"的授权缓存 |

### 3. 消息队列：要解决什么

| 问题 | 处理 |
|---|---|
| 消费者 `retryStrategy: () => null`，断线后静默死亡 | 指数退避重连；异常写入 `stats.lastError` |
| 没有 PEL 回收，崩溃即丢单 | 新增 `XAUTOCLAIM` 循环（每 30s 认领空闲 > 60s 的消息） |
| 消费者名写死 `consumer-1`，多实例共用 PEL | 改为 `${hostname}-${pid}` |
| `setInterval(1s)` 套 `BLOCK 2000ms` → 消费循环重叠；失败串行 sleep 卡队列 | 改 `while` 循环 + 批量并发（默认 4）+ 指数退避；不可重试错误立刻进死信 |
| `XADD` 无长度上限 | `MAXLEN ~ 10000`；死信 `MAXLEN ~ 2000` |
| 进死信不回补库存 → 库存泄漏 | 死信前 `INCRBY` 回补 |
| `Idempotency-Key` 前端发了但秒杀路由没读，连点生成多个 reqId | reqId = sha256(userId + Idempotency-Key)；另加 `SET NX` 10 秒互斥锁 |
| 结果 key 只有 600s，过期后接口永远返回 pending | TTL 提到 1800s；miss 时回查 `tour_order.req_id`，区分 pending / success |
| 零监控 | 新增 `GET /v1/health/queue`：Stream 长度、PEL 数量、死信长度、Redis 内存与淘汰策略、消费者计数器 |
| 死信无法重放 | 新增 `scripts/mq-replay.ts`（支持 `--dry-run` / `--limit`） |
| `route_stock.seckill_start_at/end_at` 建了没用 | 路由增加活动窗口校验（未开始 409 / 已结束 409） |

### 4. 顺手修的

- `backend/package.json` 删掉 `"travel-agent-system": "file:.."` 自引用（它会让 `node_modules` 出现无限递归 junction，`git status` 刷几百行 `Filename too long`）。
- `backend/scripts/redis-smoke.ts`、`seckill-e2e.ts`、`mq-replay.ts` 三个验证脚本。

## 二、Redis key 一览（都带 `REDIS_KEY_PREFIX`）

| Key | 类型 | TTL | 写入方 | 作用 |
|---|---|---|---|---|
| `auth:sess:<sha256(token)>` | Hash | 300s | passport 首次认证 | 登录态：user_id / role / roles / permissions / session_id |
| `auth:user:<id>:sessions` | Set | 300s | 同上 | 用户 → 会话指纹索引，支持一次性踢下线 |
| `dict:<type>` | String(JSON) | 3600s | `db/dict.ts` | 民族 / 城市 / 风格等基础字典（single-flight 防击穿） |
| `stock:<routeId>:<date>` | String(数字) | 活动结束+1d | `api/stockCache.ts` | 秒杀剩余名额（Lua 原子预扣） |
| `lock:seckill:<uid>:<rid>:<date>` | String | 10s | `api/seckillRouter.ts` | 同人同场次互斥（SET NX） |
| `seckill:result:<reqId>` | String(JSON) | 1800s | 路由 / 消费者 | 排队结果，前端轮询 |
| `seckill:stream` | Stream | MAXLEN~10000 | `mq/producer.ts` | 削峰队列 |
| `seckill:stream:dlq` | Stream | MAXLEN~2000 | `mq/consumer.ts` | 死信，可重放 |
| `rl:<维度>` | Hash | 桶空所需时间 | `db/redis.ts` | 令牌桶（`tokens` / `ts`） |
| `login_fail:<hash>` | String | 900s | `auth/security.ts` | 连续输错次数 |

### 三个 Lua 脚本的分工

| 脚本 | 保证什么 | 返回 |
|---|---|---|
| `deduct_stock.lua` | 库存"查 + 判 + 扣"原子，杜绝超卖 | `{1,剩余}` / `{0,剩余}` / `{-1,-1}`（未预热） |
| `token_bucket.lua` | 补令牌 + 判定 + 扣减原子，零 SQL | `{1,剩余}` / `{0,剩余}` |
| `login_fail.lua` | 自增 + TTL 原子，消除"永久锁死" | `{count, ttlSeconds}` |

## 三、怎么验证

```bash
cd backend

# 0) 编译 + 单测（三套都应通过）
npm run build
npm test          # HTTP 契约 / 幂等 / 订单状态
npm run test:auth # 密码慢哈希 + 锁定
npm run test:rbac # RBAC 12 项

# 1) Redis / Lua 自检（8 项）
npx tsx scripts/redis-smoke.ts

# 2) 秒杀全链路（9 项：认证 → 预扣 → Stream → 落库 → 幂等 → 互斥 → 对账）
npm run dev                       # 另开一个终端
npx tsx scripts/seckill-e2e.ts    # 自动建临时场次，跑完自清理

# 3) 队列可观测性
curl http://127.0.0.1:3001/v1/health/queue

# 4) 死信重放
npx tsx scripts/mq-replay.ts --dry-run
```

网关：

```bash
nginx -c <绝对路径>/deploy/nginx/nginx.conf -t   # 语法检查
nginx -c <绝对路径>/deploy/nginx/nginx.conf
# 之后所有请求走 http://127.0.0.1:8080，后端 3001 不再直接对外
```

## 四、还需要人工确认的两件事

1. **Memurai 的持久化与淘汰策略**：库存 key 是业务数据，建议
   `appendonly yes`、`appendfsync everysec`、`maxmemory-policy noeviction`
   （目前实测 `maxmemory-policy` 已经是 `noeviction`，AOF 需要看 memurai.conf）。
2. **上 CDN / 多级反代时**，nginx 要打开 `set_real_ip_from` + `real_ip_header`，
   否则 `$binary_remote_addr` 拿到的是上一跳 IP，限流会"误伤全楼"。
