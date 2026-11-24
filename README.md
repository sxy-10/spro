# 智能旅游规划平台 · 前后端分离

Node/Express/TypeScript 业务 API（唯一写库方）+ MySQL(MariaDB) + Java Spring Boot BFF（承载 B 端旅行社 + 平台方 Web）+ C 端 Kotlin 原生 App。

> 三端职责、服务边界与实施步骤见 **`docs/三端实施方案.md`（v3）**。
> B 端/平台方已定为 **React SPA，源码在 `java-web/agency-web`**，由 Spring Boot **同源托管**（`:8080`），`java -jar` 一个包即可运行。
本仓库当前完成度：**前后端已打通并联调通过**（19/20 冒烟断言，唯一未过项为演示数据中已无待确认订单）。

## 仓库结构

```
backend/          Node/Express/TS 业务 API，唯一写库方，监听 :3001
java-web/         Spring Boot 3.3 BFF + B端/平台方 SPA（一个 jar）
  └─ agency-web/  React 18 + Vite + Ant Design 源码（原 frontend/agency-web 迁入）
android-app/      C 端 Kotlin 原生 App（本轮新建，交付物）
database/         SQL 迁移脚本 01→13
deploy/           docker-compose（mysql/redis/kafka/flink）+ 可选 nginx.conf
docs/             三端实施方案、specs/API_V1.md、plan/ 分工与交接
prototype/        旧静态原型（旅行社/平台端 18 页），冻结为视觉参照，不再维护
frontend/src/     C 端 React 参照版（不交付）
frontend/android/ Capacitor 参照物（不交付）
shared-auth/      仅 C 端参照版与旧原型使用，B 端不再引用
```

## 快速启动

### 1. 数据库（本机 MariaDB/MySQL）

- 服务名 `mysqlzt`，监听 `127.0.0.1:3307`（注意端口是 3307）
- 数据库名 `travel_agent_db`，账号 root

### 2. 后端配置 `backend/.env`

```ini
DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=root
DB_PASSWORD=<你的密码>
DB_NAME=travel_agent_db
JWT_SECRET=<32 位以上随机串>
PORT=3001
NODE_ENV=development
REDIS_DISABLED=1
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:3000,http://127.0.0.1:3000,null   # B 端 SPA 同源经 Java(:8080)，不需要列入
```

### 2.1 接入 DeepSeek 大模型（可选，未配置则自动回退模板引擎）

**密钥只从环境变量读取，不落库、不写前端、不进代码。**

```bash
# Windows（用户级，双击 start-backend.bat 也能读到；设置后需重开命令行/资源管理器）
setx DEEPSEEK_API_KEY "sk-你的密钥"

# macOS / Linux
export DEEPSEEK_API_KEY="sk-你的密钥"
```

可选变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容接口地址 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 模型名；账号不支持时自动降级 `deepseek-chat` |
| `DEEPSEEK_THINKING` | `0` | 置 `1` 开启思考模式（长 JSON 输出容易被思考 token 截断，默认关闭） |
| `AI_DISABLED` | `0` | 置 `1` 强制关闭大模型，全部走本地模板 |

生效范围：AI 智能规划页（`POST /admin/plan-drafts`、`PATCH /plans/:id`）、C 端 `POST /plans`。
平台端「AI 智能服务管理」页顶部展示模型接入状态，并提供**测试连接**按钮（`POST /platform/ai-service/test`）；
该页配置的人设与 `温度 x · 最大长度 n` 会真实作用于生成请求（60 秒缓存）。

验证：`cd backend && npx tsx scripts/ai-e2e.ts`（登录 → 模型自检 → 真实生成一段行程并落库）。

### 3. 迁移 + 演示数据 + 启动

```bash
cd backend
npx tsx scripts/migrate.ts     # 01→02→04→05→06→07_dict→07_web→08→09，幂等可重跑
npx tsx scripts/seedDemo.ts    # 演示账号与数据，幂等可重跑
npx tsx scripts/seedGuidesTeams.ts  # 导游与团队演示数据（6 导游/7 团队、成员自洽），幂等可重跑
npx tsx src/server.ts          # API 监听 http://127.0.0.1:3001
```

### 4. B 端 / 平台方 Web（`java-web`，Spring Boot + React SPA）

**交付形态（一个 jar，无需 Nginx、无需另起前端进程）**

```bash
cd java-web
./mvnw -q clean package                  # Maven 前端插件自动 npm ci && npm run build
java -jar target/admin-web-*.jar         # 打开 http://127.0.0.1:8080
```

> 首次构建会由插件下载受管 Node（v20.18.0，约 25MB）到 `target/node`，与本机 Node 版本无关；
> 只改后端或离线时可跳过前端：`./mvnw package -Dskip.frontend=true`（前提是 `target/classes/static` 已有产物）。
> 骨架期自带 dev-only 登录口 `POST /api/auth/dev-login`，接入 Node 真实登录后随 `DevAuthController` 一起删除。

**开发形态（前后端分进程，前端热更新）**

```bash
cd java-web && ./mvnw spring-boot:run            # 后端 :8080
cd java-web/agency-web && npm run dev            # 前端 :5174，vite 把 /api 代理到 8080
```

登录后按角色进入 `/agency/*`（旅行社管理员）或 `/platform/*`（平台超级管理员）。
浏览器只持 `JSESSIONID` 与 `XSRF-TOKEN` 两个 Cookie，不保存任何 token，也不做 HMAC 签名。

> **旧原型 `prototype/`**（旅行社端 8 页 + 平台端 9 页，纯静态）已冻结为视觉参照，仅用于对照版式；
> 新功能一律做在 `java-web/agency-web`，不要再往 `prototype/` 加页面。
> `frontend/agency-web` 迁移完成后先与新工程并行比对，**确认新工程通过验收后再删除**。
> 若要打开参照原型，请另起静态服务在 `:8081`（`npx serve -l 8081 prototype`），避免与 Java 的 `:8080` 冲突。

## 演示账号（密码均为 `Admin@2026`）

| 账号 | 角色 | 登录后落地页（SPA 路由 / 原型页面） |
|---|---|---|
| `super` | 平台超级管理员 | `/platform/dashboard`（原型 `platform-dashboard.html`） |
| `admin` | 四川山水行 · 旅行社管理员 | `/agency/dashboard`（原型 `agency-dashboard.html`） |
| `staff02` | 四川山水行 · 业务专员（只读子集） | `/agency/dashboard` |
| `yun_admin` | 云南风 · 旅行社管理员 | `/agency/dashboard` |
| `tourist01`~`tourist04` | 游客（C 端 API） | 被拦截并提示（B 端后台不面向游客） |

> 下表左列是**原型页面名**（`prototype/`，仅作参照）；正式版对应 SPA 路由：`/agency/*`、`/platform/*`，接口由 Java `/api/**` 聚合后转发。

## 页面与接口对照

- 旅行社端：`agency-dashboard / orders / products / customers / guides / finance / settings / ai-plan`
  → `GET /admin/dashboard`、`/admin/orders(+confirm)`、`/admin/routes /admin/specialties`、
  `/admin/customers`、`/admin/guides /admin/teams`、`/admin/finance/*`、`/admin/settings /admin/members`、
  `/admin/plan-drafts`、`/plans`
- 平台端：`platform-dashboard / analytics / agencies / audit / users / orders / finance / ai-service / system`
  → `/platform/overview /analytics /agencies /audits /users /orders /finance/* /settlements /ai-service /system-meta`
  及 RBAC：`/roles /permissions /admin/users`
- 前端契约：统一包络 `{code,message,data,trace_id}`；写请求带 `Idempotency-Key`；401 单飞刷新重放。
- **签名归属**：B 端 SPA **不做 HMAC 签名**（浏览器只发 `JSESSIONID` + `XSRF-TOKEN`），签名由 Java 的 `RequestSigner` 在服务端完成；需要签名的只有 C 端 Kotlin App 与 Java 自己。

## 冒烟验证

```bash
cd backend && npx tsx scripts/smoke.ts
```

覆盖登录三角色、平台端 7 接口、旅行社端 8 接口、游客越权拒绝、订单确认幂等写。

## 已知限制（本机环境）

- 本机 Redis 带密码且未配置 `REDIS_PASSWORD`：秒杀缓存预热 / 过期锁位任务会打印
  `NOAUTH / STOCK_EXPIRY_FAILED / seckill.consumer.error` 日志，**不影响本平台功能**（秒杀属组员 3 模块）。
- `09_stock_version.sql` 的 `ADD COLUMN IF NOT EXISTS` 为 MySQL 8 语法，MariaDB 由
  `scripts/migrate.ts` 的兼容路径按需补列（MariaDB 10.4 亦支持该语法，通常直接走通）。
- MariaDB 10.4 不支持 `utf8mb4_0900_ai_ci`，migrate.ts 读取 SQL 时运行时替换为 `utf8mb4_general_ci`
  （不改动 SQL 源文件）。
