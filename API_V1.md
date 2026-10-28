# 接口规范落地说明

后端入口为 `/v1`，实现新版规范第 6 章的全部 18 个接口（含余位查询），另有 `/v1/auth/logout` 和机构隔离的 `/v1/admin/routes`、`/v1/admin/analytics`。旧 `/api` 原型路由不再挂载。公开接口以第 6 章清单为准：注册、登录、线路、余位和景点查询无需登录。

## 启动

1. 新数据库执行 `sql/01_schema.sql`，按需执行 `sql/02_seed.sql`；已有数据库不要重跑带 DROP 的初始化脚本。
2. 对数据库依次执行增量迁移 `sql/04_api_v1.sql`、`sql/05_route_stock.sql`，新增逻辑删除、出行日期、会话、幂等、防重放、限流、评论、日期库存及订单锁位字段。各迁移仅执行一次，已执行 04 时只执行 05。
3. 复制 `backend/.env.example` 为 `backend/.env`，配置 MySQL 和至少 32 字符的随机 `JWT_SECRET`。
4. 在 backend、frontend 分别运行 `npm install`。后端运行 `npm run dev`，前端运行 `npm run dev`。验证命令为后端 `npm test`、两端 `npm run build`。

已有 seed 账号的密码占位哈希不能用于登录，请从页面注册真实账号。注册只能创建 TOURIST；管理员由数据库运维授予，并必须关联 agency_id。

## HTTP 契约

JSON 响应固定为 `code/message/data/trace_id`，DELETE 成功为 204 空响应。字段 snake_case，ID 和金额为字符串，时间 UTC ISO8601。订单内部 PENDING/CANCELLED 映射为 CREATED/CANCELED；历史订单还可能为 COMPLETED/REFUNDED。手机号仅在单独鉴权的资料/订单详情中脱敏返回。列表接受 page（1–100）、size（1–100）、白名单 sort；不允许任意过滤字段或深翻页。行程列表只返回摘要，详情读取完整版本快照。

所有 POST、PUT、PATCH 携带 `Idempotency-Key`（8–128 字符）。相同登录会话、路径、方法和键的重复请求返回相同业务结果；换请求体返回 409。登录和注册也需要此请求头。登录使用 `{mobile,password}`，返回 `{token,user_id}`。令牌仅放 `Authorization: Bearer ...`，有效期 30 分钟，登出立即撤销会话。前端只在内存保存令牌，刷新后重新登录。

登录后的写请求另携带 `X-Timestamp`（UTC ISO8601）、`X-Nonce`（16–128 字符字母数字或中划线）、`X-Signature`。签名为 HMAC-SHA256 小写十六进制，密钥为当前 Bearer token，消息为下列各行以换行符连接，末尾无换行：

```text
HTTP_METHOD
/v1/完整请求路径
X-Timestamp
X-Nonce
SHA256(JSON.stringify(请求体))
```

时间窗为 ±5 分钟，nonce 持久化防复用。JSON 签名以解析后对象的 JSON.stringify 为准；前端 api.ts 已实现。使用同一幂等键重试可读取先前结果。DELETE 逻辑删除天然幂等，重复删除返回 204。

PUT `/users/{id}` 完整资料字段为 nickname、avatar_url（可 null）、default_departure_city（可 null）。PATCH `/plans/{id}` 接受 title 和/或 instruction。评论体为 content、rating（1–5）。新增业务码：20014 限流、20015 重复资源或幂等键冲突、20016 防重放失败、50001 服务暂不可用。

## 部署及验证边界

生产环境必须经可信 TLS 代理；配置 PUBLIC_API_ORIGIN 和 CORS_ORIGINS。仅在代理正确清除外部 forwarding headers 时设置 TRUST_PROXY=1；生产 HTTP 返回 308 并开启 HSTS。数据库连接使用 UTC，DECIMAL 和 BIGINT 保留字符串。请求 JSON 上限 64KB，开启 gzip，私有响应 no-store，网络请求超时 30 秒。

数据库会话、幂等和 nonce 使用唯一约束及事务；并发请求等候相同记录锁。api_idempotency 存储期间保留首次结果，不自动清除。运维需按保留策略清理过期 api_session、api_nonce 和 api_rate_limit；不要在网络重试窗口内删除幂等记录。

自动测试使用受控数据库替身验证真实 HTTP 调用，覆盖响应结构、越权、签名、并发幂等、取消状态、错误脱敏。它不能替代 MySQL 实际迁移和多实例并发验证。P99 目标、压测环境及监控采集后端未在原规范中给定，仍需部署后验收。

当前智能体工具仍为原有模拟实现，行程响应如实返回 is_estimated=true。PATCH 沿用原有优化器，其能力是记录调整要求和更新提示，尚无真实地图或大模型重算。

## 日期余位

`GET /v1/routes/{id}/stock?travel_date=2026-12-01` 匿名查询可售线路，返回 total_seats、available_seats、is_sellable。日期必须是有效 YYYY-MM-DD；无该日期库存时返回 0/0/false，线路不存在或已下架时返回 404。余位实时计算，响应禁止缓存。

route_stock 以 route_id、travel_date 为联合主键，数据库约束 locked_seats + sold_seats 不超过 total_seats。运营需为每个可订日期显式配置库存，不自动生成名额，例如：

```sql
INSERT INTO route_stock(route_id, travel_date, total_seats)
VALUES (1, '2026-12-01', 40);
```

创建订单在同一事务中执行带剩余名额条件的原子 UPDATE，再插入订单。无库存或不足返回 HTTP 409、code=20010、message=该日期余位不足；失败回滚，幂等重试不再次锁位。取消订单同时释放 locked_seats。历史订单迁移后 is_stock_locked=false，不会错误释放未占用的名额。

后端启动后每 10 秒扫描一批最多 100 个过期订单，15 分钟到期后取消并释放锁位。多个实例通过 FOR UPDATE SKIP LOCKED 协作。大批量到期时可能存在扫描延迟，应监控任务错误和积压；勿仅启动 app.ts 而绕过 server.ts 的调度。

内部 `settlePaidOrder(orderId)` 仅供未来已验证的支付提供商回调使用，锁住订单后把 locked_seats 转入 sold_seats，并更新 PAID；重复回调不重复扣减，过期或取消订单拒绝支付。规范未定义支付 HTTP 接口，当前未接入支付渠道，不提供客户端自行标记支付成功的接口。

前端“我的”页面新增线路预订，先查余位，再提交订单；提交时后端仍独立校验。新测试覆盖余位查询、非法日期、无库存、并发抢余位、幂等锁位、创建失败回滚、取消释放、超时释放、过期支付和重复支付。测试使用数据库替身，真实 MySQL 行锁和迁移需另行联调。

本次验证：前后端构建及 HTTP 测试通过；当前 MySQL 连接不可用，增量迁移和真实持久化尚未执行。依赖兼容修复后，前端审计为零漏洞；后端审计仍报告 qs/express 链上的两项 moderate 漏洞，需在升级依赖后重新审计。
