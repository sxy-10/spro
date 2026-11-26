# java-web · B 端 / 平台方后台（Spring Boot BFF + React SPA）

**一个 jar 交付**：浏览器打开 `:8080` 就是后台，`/api/**` 与页面同源；Node 仍是唯一写库方。
当前进度：**S2（组员 1）已完成** —— 真实登录、NodeApiClient、B 端 6 页、页面级聚合、埋点透传。
**已追加**：实时大屏（`/agency/bigscreen`）与在线客服（`/agency/livedesk`）已从旧 `frontend/agency-web` 迁入，
由 BFF 中转 SSE（`/api/stats/live`）与 WS 桥接（`/api/im/ws`），浏览器仍只持 Cookie。
**已追加（平台端）**：旅行社管理（`/platform/agencies`）与账号管理（`/platform/users`）两页，
BFF 透传 `/api/platform/**`（机构 CRUD/启停用、账号增改/启停/分配角色/角色下拉），权限码仍由 Node 判定；
super 登录自动落到平台端，机构启停用会同步机构名下管理员账号状态（Node 规则）。

## 结构

```
java-web/
├─ pom.xml                    # frontend-maven-plugin 在 generate-resources 阶段构建 SPA
├─ agency-web/                # SPA（React 18 + Vite 6 + Ant Design 5 + TS）
│  ├─ src/App.tsx             # 路由：/login + /agency/{dashboard,routes,orders,stock,customers,livedesk,bigscreen} + /platform/{agencies,users}
│  ├─ src/lib/http.ts         # 同源请求层：Cookie + X-XSRF-TOKEN；qs() 拼查询串
│  ├─ src/lib/auth.tsx        # /api/me 会话上下文 + can(code) 权限判定
│  ├─ src/lib/statsSse.ts     # 大屏取数：fetch 流式解析 SSE（/api/stats/live），台阶退避重连
│  ├─ src/lib/imWs.ts         # 客服 WS 客户端：/api/im/ws（BFF 桥接，不发 auth 帧）+ 长轮询降级
│  ├─ src/lib/imStore.ts      # 本地消息仓库：seq 排序 + clientMsgId/seq 双去重 + 三态
│  ├─ src/styles/ops.css      # 客服台与大屏的专属样式（类名与 AntD 无交集）
│  ├─ src/lib/types.ts        # Node 返回的 snake_case 结构（只声明用到的）
│  ├─ src/components/         # AppLayout / Permission / RequireAuth / TrendChart
│  └─ src/pages/              # login、agency（8 页：6 业务 + livedesk + bigscreen）、platform（2 页）、error（403/404）
└─ src/main/
   ├─ java/com/example/adminweb/
   │  ├─ config/              SecurityConfig（会话+CSRF）、SpaForwardController、WebMvcConfig、NodeApiConfig
   │  ├─ security/            AdminUser、NodeSession、SessionKeys
   │  ├─ api/                 RequestSigner（HMAC）、NodeApiClient（签名/包络/重试）、NodeStreamClient（SSE/WS）、NodeApiException
   │  ├─ im/                  ImWsBridgeHandler（/api/im/ws ↔ Node 双向桥）、ImWsHandshakeInterceptor
   │  ├─ agency/              B 端聚合接口（dashboard/routes/orders/stock/customers）
   │  └─ web/                 Auth / Me / Events / ImController / LiveStatsController、Sessions、ApiResult、异常与 401·403 出口
   └─ resources/application.yml
```

## 命令

```bash
# 交付/验收：一条命令出 jar（会先构建 SPA）
./mvnw clean package
java -jar target/admin-web-0.1.0-SNAPSHOT.jar        # http://127.0.0.1:8080

# 只改后端：跳过前端构建（前提：target/classes/static 已有产物）
./mvnw package -Dskip.frontend=true

# 单测（10 个用例，离线可跑，不需要 Node/MySQL）
./mvnw test -Dskip.frontend=true

# 开发：后端 + 前端热更新两进程
./mvnw spring-boot:run                               # :8080
cd agency-web && npm install && npm run dev          # :5174，/api 代理到 8080
```

> 启动前需要 Node 在 `:3001`（`NODE_BASE_URL` 可覆盖）。Node 不可达时页面会收到 `503 / 50300`，而不是假装成功。

## 登录链路

```
GET  /api/auth/captcha   → 代理 Node /v1/auth/captcha（返回 SVG + captcha_id）
POST /api/auth/login     → Node /v1/auth/login/account（头 X-Captcha-Id）
                         → Node /v1/users/me + /v1/users/me/permissions
                         → 写 Session（token、profile、menus/buttons）+ 换 session id
GET  /api/me             → 下发 user_id/username/roles/menus/buttons（正文无 token）
POST /api/auth/logout    → 先吊销 Node api_session，再销毁本地会话
```

红线：浏览器只有 `JSESSIONID` 与 `XSRF-TOKEN`；`Authorization`、`X-Signature`、`X-Nonce`、`Idempotency-Key` 全部只在服务端出现。

## 接口一览

完整清单与字段见 `docs/specs/API_V1.md` 的「Java BFF 接口」一节。要点：

| 类别 | 路径 | 备注 |
|---|---|---|
| 会话 | `/api/auth/{captcha,login,logout}`、`/api/me` | 验证码一次性；改角色后需重新登录 |
| 工作台 | `/api/agency/dashboard`、`/api/agency/dashboard-metrics` | 后者固定 4 个数字，S4 大屏轮询它 |
| 线路 | `GET/POST /api/agency/routes`、`PATCH /api/agency/routes/{id}` | `base_price_rmb` 可传数字，BFF 转字符串 |
| 订单 | `GET /api/agency/orders`、`GET /api/agency/orders/{id}`、`POST /api/agency/orders/{id}/confirm` | 详情含后端判定的时间线 |
| 库存 | `GET/PUT /api/agency/stock/{routeId}` | 不提供"触发预热"，那是 S4 的内部接口 |
| 客户 | `GET /api/agency/customers`、`GET /api/agency/customers/{id}`、`PUT /api/agency/customers/{id}/note` | 手机号已脱敏 |
| 埋点 | `POST /api/events` | 透传 Node `/v1/events`，允许匿名 |
| 平台·旅行社 | `GET/POST /api/platform/agencies`、`GET/PUT/PATCH /api/platform/agencies/{id}` | PATCH 启停用同步机构名下管理员状态；列表手机号脱敏 |
| 平台·账号 | `GET /api/platform/users`、`GET /api/platform/roles`、`POST /api/platform/users`、`PUT/PATCH /api/platform/users/{id}` | 新建走 RBAC `/v1/admin/users`（手机号即账号）；PATCH 禁用即撤销全部会话；super 不可禁用 |
| 平台·越权 | 旅行社管理员访问 `/api/platform/**` | 一律 403（Node `requireAction` 判定，BFF 无平行权限） |

## 自检结果（2026-11-25）

| 项 | 方式 | 结果 |
|---|---|---|
| 签名一致性 | `NodeApiClientTest.写请求的签名与Node的write逐字节一致` | 通过（与 `backend/src/api/core.ts` 的 `write()` 同算法） |
| 5xx 重试 | 桩服务第一次 500、第二次 200 | 只重试 1 次，两次复用同一 `Idempotency-Key` |
| 业务错误透传 | 桩返回 401/20012 | 抛 `NodeApiException`，`isUnauthorized()` 为真，message/trace_id 原样 |
| 超时 | 桩 sleep 800ms、读超时 200ms | 抛 `NodeUnavailableException`（页面 503） |
| 登录 → me | MockMvc + 桩 Node | 会话建立，menus/buttons 正常下发 |
| 一页一请求 | 打开订单页 | `/api/agency/orders` 只打 1 次，Node 也只被调用 1 次 |
| 未登录 / 缺验证码 / 密码错误 | MockMvc | 401·20012 / 400·10001 / 400·10001 + Node 原文案 |
| SPA 构建 | `npm run build` | 通过，产物 1.65MB（echarts 按需引入，gzip 530KB） |

> 真库联调（真实账号、真实订单、6 页数据）留待 Node + MySQL 起来后执行，见第 7 节"未验项"。

## 踩坑记录（写下来避免 S3/S4 再踩）

1. **Spring Security 6 不会自动回写 Session**：手动认证后必须 `securityContextRepository.saveContext(...)`，否则出现"Session 里有属性、SecurityContext 却是空"的假登录。
2. **`changeSessionId()` 前必须先 `getSession(true)`**：首次登录请求没有 Session，直接调会抛 `IllegalStateException`。
3. **签名不能用 Spring 的 `ObjectMapper`**：全局配置是 `SNAKE_CASE`，而签名原文要求与 Node 收到的字节一致，`NodeApiClient` 内部用独立 `ObjectMapper`（默认策略、无缩进）。
4. **`base_price_rmb` 是字符串不是数字**：Node 的 `money` 是 `z.string()`，前端传数字会被 400，BFF 统一 `BigDecimal → toPlainString()`。
5. **Node 的分页 `page()` 是 `.strict()`**：多传一个未声明参数就 400，所以 `qs()` 会丢弃空值，聚合接口只转白名单字段。
6. **echarts 全量引入 2.2MB**：改成 `echarts/core` + 按需注册后降到 1.65MB。
7. **`/api/events` 是唯一允许匿名的 `/api/**`**：与 Node 的 `optionalAuthenticate` 对齐，否则游客埋点会被 401。

## 未验项（需要环境）

| 项 | 缺什么 | 怎么补 |
|---|---|---|
| 真实账号登录（`admin` / `staff02`） | MySQL（连接参数见 `backend/.env`）+ Node `:3001` | 起环境后跑一遍登录 → 工作台 |
| 6 页真实数据 | 同上 | 打开每页核对列表与写操作 |
| 图形验证码人工输入 | 同上 | 登录页输入验证码；开发环境页面会显示 `dev_code` |
| 与 S1 内部接口的联动 | S4 才做 | `refresh-stock` 等四个定时任务由 S4 接 |

## 交接给 S3

- 权限码与菜单映射：`docs/plan/权限码与菜单映射.md`（含平台方 9 页的权限码草案）。
- 可复用：`lib/http.ts`、`lib/auth.tsx` 的 `can()`、`components/Permission.tsx`、`AppLayout` 的菜单渲染方式。
- 不要改：`web/AuthController`、`api/NodeApiClient`（签名/包络/重试已冻结，S3 直接注入使用）。
