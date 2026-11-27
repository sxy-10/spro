# 接口规范落地说明

后端入口为 `/v1`，实现新版规范第 6 章的全部 18 个接口（含余位查询），另有 `/v1/health`、`/v1/auth/logout`、机构隔离的管理端接口和聊天会话接口。旧 `/api` 原型路由不再挂载。公开接口以第 6 章清单为准：注册、登录、线路、余位和景点查询无需登录。

## 启动

1. 新数据库执行 `database/01_schema.sql`，按需执行 `database/02_seed.sql`；已有数据库不要重跑带 DROP 的初始化脚本。
2. 对数据库依次执行增量迁移 `database/04_api_v1.sql`、`database/05_rbac_schema.sql`、`database/06_route_stock.sql`、`database/08_rbac_complete.sql`，新增会话、幂等、限流、RBAC权限、日期库存锁位和审计表。
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

管理端与后台接口统一由 RBAC 授权：401 表示未登录或会话失效（业务码 20012），403 表示已登录但缺少权限（业务码 20013，文案固定「权限不足，禁止访问」），两者不得混用。判定由 Casbin 完成，路由上声明 `requireAction('模块:资源', '操作')`，权限数据来自 `sys_role`、`sys_permission`、`sys_role_permission`、`sys_user_role` 四张表；修改角色授权或用户角色后立即生效，无需重启服务。越权响应不回传缺失的权限码，只在服务端日志（`rbac.denied`）中留痕。详见 `docs/组员2-阶段二-Casbin授权层交付说明.md`。

组员2补充接口：`GET /health` 无需登录并返回标准包络中的 `data.status = "ok"`；聊天接口为 `GET /chat/sessions`、`GET /chat/sessions/{id}/messages`、`POST /chat/sessions`（创建会话并写入首条用户消息）。游客获得 6 个按钮权限：会话查询、消息查询/发送、创建行程、创建/查询预订。管理端补齐 `PATCH /admin/routes/{id}`、`GET /admin/orders`，订单与统计按当前旅行社隔离；订单联系手机号脱敏。线路新增/修改与请求追踪号写入 `sys_audit_log`。写请求继续使用幂等键及 HMAC 签名约定。

## 第 12 次课 Node 接口

- `POST /events`：匿名可用；单条或最多 50 条事件；若带 Bearer 登录态，`userId` 必须与当前登录用户一致；接受后异步送入 Kafka `rec.events`（key=`userId`），返回 202。
- `GET /admin/audit/logs`：需 `system:permission:query`；`type=login|operation|system`，可按 `level`、`from`、`to`、`page`、`size` 查询。系统日志读取 Node pino JSON 文件尾部。
- `POST /internal/timers/{expire-orders,refresh-stock,seckill-toggle,dashboard-preagg}`：私网 + HMAC-SHA256；使用独立 `INTERNAL_API_SECRET`，头为 `X-Timestamp`（epoch 毫秒）、`X-Nonce`、`X-Internal-Key`（HMAC 摘要）。±5 分钟时间窗，Redis nonce 去重 5 分钟。详见 `docs/plan/内部接口契约.md`。
- 秒杀仍使用原 `/seckill/{routeId}` 和 `/seckill/result/{reqId}` HTTP 语义，内部队列迁至 Kafka：`seckill` → `seckill.retry`（最多 3 次，退避 1/5/30 秒）→ `seckill.dlt`。IM `im:notify` 仍使用 Redis Stream。

Node 登录日志、业务操作日志分别写入 `sys_login_log`、`sys_operation_log`；权限变更同时扩展写入 `sys_audit_log`。不写入密码、token、手机号原文、Authorization、签名头或请求体。新迁移：`database/14_logs.sql`、`database/15_seckill_window.sql`。

## Java BFF 接口（java-web，同源 `/api`）

浏览器只访问这一层。全部返回同一包络 `{code,message,data,trace_id}`；认证靠 `JSESSIONID` 会话 Cookie，写请求另需 `X-XSRF-TOKEN`（取自 `XSRF-TOKEN` Cookie）。`/api/events` 允许匿名，其余 `/api/**` 未登录一律 `401 / 20012`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 健康探针（公开） |
| GET | `/api/auth/captcha` | 代理 Node 图形验证码，返回 `captcha_id` + SVG |
| POST | `/api/auth/login` | 体 `{account,password,captcha_code}`，头 `X-Captcha-Id`；成功后建会话并缓存 menus/buttons |
| POST | `/api/auth/logout` | 吊销 Node `api_session` 并销毁本地会话 |
| GET | `/api/me` | `user_id/username/roles/menus/buttons`，正文无任何 token |
| GET | `/api/agency/dashboard` | 工作台：KPI + 14 天趋势 + Top 线路 + 待办 + 最近订单（一次请求） |
| GET | `/api/agency/dashboard-metrics` | 大屏只读：固定 4 个数字 `onsale_count/today_orders/pending_confirms/today_amount` + `generated_at`（S4 轮询） |
| GET | `/api/agency/routes` | 线路列表，`page/size/sort/keyword/status` |
| POST | `/api/agency/routes` | 新建线路，`base_price_rmb` 可传数字，BFF 转字符串 |
| PATCH | `/api/agency/routes/{id}` | 改线路（白名单字段：title/destination/default_days/style_tag/base_price_rmb/status/description） |
| GET | `/api/agency/orders` | 订单列表，`page/size/sort/status/keyword` |
| GET | `/api/agency/orders/{id}` | 订单详情 + 后端判定的时间线 |
| POST | `/api/agency/orders/{id}/confirm` | 确认订单，体 `{remark?}`（≤200 字） |
| GET | `/api/agency/stock/{routeId}` | 某线路未来 14 天名额 |
| PUT | `/api/agency/stock/{routeId}` | 改名额，体 `{travel_date,total_seats}`；不得低于已锁定+已售出 |
| GET | `/api/agency/customers` | 客户列表，`page/size/sort/keyword` |
| GET | `/api/agency/customers/{id}` | 客户详情：画像、历史订单、回访备注 |
| PUT | `/api/agency/customers/{id}/note` | 保存回访备注（≤500 字，允许清空） |
| POST | `/api/events` | SPA 埋点透传 Node `/v1/events`，登录态自动补 Bearer |

鉴权分工：**Node 是权限唯一裁决点**（`requireAction`）；Java 只做会话与透传，前端按 `buttons` 里的权限码决定入口与按钮是否渲染。错误映射：Node `10001` → 400、`20012` → 401（同时销毁本地会话）、`20013` → 403；Node 不可达或超时 → `503 / 50300`。

## 即时通讯接口（阶段 1 骨架）

所有接口都需 Bearer token。`11_im.sql` 创建 `im_conversation`、`im_participant`、`im_message`、`im_device`、`im_read_cursor`；`12_im_perm.sql` 为 TOURIST 授予前三个即时通讯权限，为 AGENCY_ADMIN / AGENT 授予全部四个 IM 权限及实时统计权限。

| 方法 | 路径 | 权限 | 请求/查询 |
|---|---|---|---|
| GET | `/im/conversations` | `im:session:query` | page、size |
| POST | `/im/conversations` | `im:conv:manage` | `title`、`member_ids` |
| POST | `/im/conversations/{id}/participants` | `im:conv:manage` | `user_ids`；校验 OWNER |
| GET | `/im/conversations/{id}/messages` | `im:message:query` | `since_id` |
| POST | `/im/messages` | `im:message:send` | `conversation_id`、`client_msg_id`、`content` |
| POST | `/im/messages/{id}/read` | `im:message:send` | 校验会话成员 |
| GET | `/im/conversations/{id}/unread` | `im:message:query` | 校验会话成员 |

即时通讯接口已实现：会话与成员管理、消息发送、历史消息读取、已读游标及未读数均落库并校验会话归属。写接口使用幂等键和请求签名约束，重复的 `client_msg_id` 不会重复生成消息。实时统计 `GET /stats/live` 每 5 秒查询当前有效登录会话、今日订单数和今日即时消息数并通过 SSE 推送。

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

## 平台方 BFF 聚合接口（/api/platform/*，S3）

浏览器经 Spring Boot BFF（java-web，端口 8080）访问平台方能力；BFF 只做 Session 认证、CSRF 校验、HMAC 签名与字段透传，权限判定全部在 Node 的 `requireAction`。响应包络与 /v1 一致（`code/message/data/trace_id`）。本节由组员2追加（T8 文档同步，D10 纪律：代码合并前文档先改）。

| 方法 | 路径 | Node 权限码 | 说明 |
|---|---|---|---|
| GET | `/api/platform/logs` | system:permission:query | 日志三页统一入口；query：type(login/operation/system 必填)、level(仅 system)、from/to(ISO-8601 含时区)、page、size；返回 {list,total,has_more} |
| GET | `/api/platform/permissions` | system:permission:query | 权限树 + 按钮清单（角色页数据源） |
| GET | `/api/platform/roles/{id}/permissions` | system:role:query | 角色已授权 permission_id 列表 |
| PUT | `/api/platform/roles/{id}/permissions` | system:role:update | 全量覆盖授权；body: **{permission_ids:[...]}**（snake_case，发驼峰会被 Java 的 SNAKE_CASE 策略丢掉→10001）；Node 自动补祖先菜单 |
| GET | `/api/platform/overview` 等其余 9 页聚合接口 | 见各页 | 与 PlatformController 一一对应，字段透传 snake_case |

写接口均需 CSRF 头 `X-XSRF-TOKEN`（前端 `lib/http.ts` 自动携带）；幂等键与 HMAC 签名由 BFF 服务端补齐，浏览器不接触任何令牌（Cookie 仅 `JSESSIONID` + `XSRF-TOKEN`）。

实现注意（踩坑记录，详见 `docs/plan/Node问题单.md`）：
- BFF 转发一律 `URI.create(baseUrl + path)` 自拼绝对地址：`uri(String)` 会二次编码 `%XX`（时间参数 → 10001），`uri(相对URI)` 不套 baseUrl（→ `URI with undefined scheme` 500）。
- 日志时间口径：库里 `created_at` 为 UTC 墙钟（mysql2 `timezone:'Z'`），from/to 传 UTC ISO；展示层由前端转本机时区。
