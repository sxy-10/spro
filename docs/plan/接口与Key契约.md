# 接口与 Key 契约（阶段一产出）

> 负责人：组员1 ｜ 维护方式：后续阶段新增 key 一律先改本文档，再改代码。
> 目的：让阶段 2/3/5/6 的人不用猜 key 叫什么、TTL 多长、拿不到数据时怎么办。

---

## 一、环境准备

### 1. 安装 Redis（Windows 三选一）

| 方式 | 命令 | 说明 |
|---|---|---|
| Docker | `docker run -d --name redis -p 6379:6379 redis:7` | 最省事，团队可共用一套 compose |
| Memurai | 官网下载安装，自动注册为服务 | 原生 Windows，不依赖虚拟化 |
| WSL2 | `sudo apt install redis-server` 后 `redis-server` | 已装 WSL 的人用 |

验证：

```bash
redis-cli ping          # 期望 PONG
```

### 2. `backend/.env` 需要新增的配置

已经在 `.env` 和 `.env.example` 里加好了，含义如下：

```env
REDIS_HOST=127.0.0.1          # 共享实例时改成对方的局域网 IP
REDIS_PORT=6379
REDIS_PASSWORD=               # 共享实例时必须设置
REDIS_DB=0                    # 多人共享同一实例时，每人用不同 0–15
REDIS_KEY_PREFIX=             # 共享时的 key 前缀，例如 z3_
AUTH_CACHE_TTL_SECONDS=300    # 登录态缓存有效期
DICT_CACHE_TTL_SECONDS=3600   # 字典缓存有效期
REDIS_DISABLED=0              # 置 1 可直接关掉 Redis（排障用）
```

### 3. 多人共享一个 Redis 时怎么不打架

两种隔离方式，任选其一：

```env
# 方式一：不同 DB index
REDIS_DB=3

# 方式二：不同 key 前缀（推荐，排障时 redis-cli KEYS 'z3_*' 一目了然）
REDIS_KEY_PREFIX=z3_
```

> 不隔离的后果：一个人压测把 `stock:12:2026-12-01` 扣到 0，其他人演示时全是"已抢完"。

---

## 二、Key 规范

| Key | 类型 | 写入方 | TTL | 用途 |
|---|---|---|---|---|
| `auth:token:{token}` | Hash | 认证中间件首次认证成功后回填 | 300s | 登录用户信息（uid/phone/role/agency_id/roles/permissions/session_id） |
| `dict:{type}` | String(JSON) | `GET /v1/dict/:type` 首次读库后回填 | 3600s | 基础字典（ethnic/city/style/food/season） |
| `stock:{routeId}:{date}` | String(数字) | 阶段二「库存预热」 | 活动结束时间 | 秒杀可售库存，Lua 脚本读它 |
| `seckill:stream` | Stream | 阶段二生产者 `XADD` | 无 | 秒杀下单消息队列 |
| `seckill:result:{reqId}` | String | 阶段二消费者 | 600s | 抢购结果，前端轮询用 |
| `login_fail_count:{identifier}` | String | `auth/security.ts`（已有） | 900s | 登录失败计数 |

**所有 key 自动加 `REDIS_KEY_PREFIX` 前缀**（`redisKey()` 统一拼接），业务代码里不要手写前缀。

---

## 三、降级规则（写代码的人必须遵守）

| 场景 | 行为 |
|---|---|
| Redis 连不上 | 所有 `redis.ts` 的对外函数返回 `null` / `false`，**绝不抛异常** |
| 字典读不到缓存 | 回查 MySQL，回填失败也照样返回数据 |
| 认证缓存未命中 | 走 passport 验签 + 查 `api_session`（MySQL 始终是权威） |
| 库存预扣拿不到 Redis | `preDeductStock` 返回 `reason='redis_unavailable'`，由调用方决定拒绝或走数据库兜底 |

日志只在**第一次**失败时打一条 `redis.unavailable`，不刷屏。

---

## 四、接口契约

### `GET /v1/dict/:type`

公开接口，无需登录。`type ∈ {ethnic, city, style, food, season}`。

成功：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    { "key": "han", "value": "汉族", "sort": 1 },
    { "key": "yi",  "value": "彝族", "sort": 2 }
  ]
}
```

失败：

| 情况 | HTTP | code | message |
|---|---|---|---|
| 不支持的 type | 400 | 10001 | 不支持的字典类型 |

响应头带 `Cache-Control: public, max-age=3600`。

---

## 五、Lua 脚本契约

文件：`backend/src/db/lua/deduct_stock.lua`

| 参数 | 含义 |
|---|---|
| `KEYS[1]` | 库存 key，例如 `stock:12:2026-12-01`（不含前缀，前缀由 `redisKey()` 加） |
| `ARGV[1]` | 需要扣减的数量（正整数） |

| 返回 | 含义 |
|---|---|
| `1` | 预扣成功 |
| `0` | 库存不足 / key 不存在（未预热或已抢完） |

调用方式（阶段二直接用）：

```ts
import { preDeductStock } from '../db/redis.js';

const result = await preDeductStock(`stock:${routeId}:${date}`, people);
if (!result.ok) {
  if (result.reason === 'sold_out') return reply(res, { status: 'sold_out' });
  if (result.reason === 'redis_unavailable') { /* 按方案决定：拒绝或走数据库 */ }
}
```

`preDeductStock` 内部已处理：key 前缀、脚本加载、异常降级、剩余库存读取。

---

## 六、交接给阶段 2 的说明

1. **`redisKey()` 已经帮你加前缀**，调用时传逻辑 key 即可（`stock:...` 而不是 `z3_stock:...`）。
2. **库存预热**由阶段二实现：数据来自 `route_stock`，写进 `stock:{routeId}:{date}`（String，值为可售数量）。
3. 脚本目前用 `EVAL`（每次把脚本源码发给 Redis）。数据量大时再换 `EVALSHA` 缓存 SHA，语义相同。
4. `auth/security.ts` 里有**另一个** Redis 连接（做登录失败计数），本阶段没动它；后续如需合并，只需让它调用 `getRedis()`。

---

## 七、验收清单（阶段一）

| 项 | 命令 | 期望 |
|---|---|---|
| Redis 可用 | `redis-cli ping` | `PONG` |
| 服务不依赖 Redis | 停掉 Redis 再启动后端 | 服务正常启动，日志一条 `redis.unavailable` |
| 字典接口 | `curl http://127.0.0.1:3001/v1/dict/ethnic` | 9 条民族数据 |
| 字典缓存 | 连续请求两次，看服务端日志 | **第二次没有 SQL**（需要 Redis 在跑） |
| 登录态缓存 | 登录后访问任意需登录接口，再 `redis-cli HGETALL auth:token:<token>` | 能看到 `user_id` / `roles` / `permissions` |
| 登出清除 | 登出后再查 `auth:token:<token>` | key 已删除 |
| Lua 原子性 | 并发扣 10 个库存 100 次 | 最终值 0，不出现负数 |
| 鉴权不回退 | 带 token 访问 `/v1/users/me` | 200，且日志无 SQL 报错 |
