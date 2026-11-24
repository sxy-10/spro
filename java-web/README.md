# java-web · B 端 / 平台方后台

Spring Boot 3.3 BFF + React SPA，**一个 jar 交付**：浏览器打开 `:8080` 就是后台，`/api/**` 同源。

## 结构

```
java-web/
├─ pom.xml                  # frontend-maven-plugin 在 generate-resources 阶段构建 SPA
├─ mvnw / mvnw.cmd          # Maven Wrapper
├─ agency-web/              # SPA 源码（React 18 + Vite 6 + Ant Design 5 + TS）
│  ├─ src/App.tsx           # 骨架期「环境自检页」
│  ├─ src/lib/http.ts       # 同源请求层：Cookie + X-XSRF-TOKEN，不签名
│  ├─ src/lib/csrf.ts       # 只读 XSRF-TOKEN
│  └─ vite.config.ts        # dev 代理 /api → :8080；build 直接输出到 ../target/classes/static
└─ src/main/
   ├─ java/com/example/adminweb/
   │  ├─ config/            SecurityConfig（会话+CSRF）、SpaForwardController、WebMvcConfig、NodeApiConfig
   │  ├─ security/          AdminUser（UserDetails）
   │  ├─ api/               RequestSigner（HMAC）、NodeProperties
   │  └─ web/               Ping / Me / Auth / DevAuth / ApiResult / 异常与 401·403 出口
   └─ resources/application.yml
```

## 命令

```bash
# 交付/验收：一条命令出 jar
./mvnw clean package
java -jar target/admin-web-0.1.0-SNAPSHOT.jar        # http://127.0.0.1:8080

# 只改后端：跳过前端构建（前提：target/classes/static 已有产物）
./mvnw package -Dskip.frontend=true

# 开发：后端 + 前端热更新两进程
./mvnw spring-boot:run                               # :8080
cd agency-web && npm install && npm run dev          # :5174，/api 代理到 8080
```

> 首次 `mvn package` 会由插件下载受管 Node（v20.18.0，约 25MB）到 `target/node`，不依赖本机 Node 版本。
> 答辩机提前跑一次，或离线用 `-Dskip.frontend=true`。

## 已实现的骨架能力（均已实测）

| 能力 | 验证方式 | 结果 |
|---|---|---|
| SPA 同源托管 | `GET /` | 200，返回 `index.html`，`Cache-Control: no-cache` |
| SPA history 回落 | `GET /agency/orders`、`/platform/roles` | 200，返回 `index.html`（刷新不 404） |
| 静态资源长缓存 | `GET /assets/index-*.js` | `max-age=31536000, public, immutable` |
| 健康探针 | `GET /api/ping` | 200，统一包络 + `trace_id` |
| 未登录拦截 | `GET /api/me` | 401 / `code=20012`（JSON，不重定向） |
| CSRF 生效 | `POST /api/auth/dev-login` 不带 `X-XSRF-TOKEN` | 403 / `code=20013` + CSRF 文案 |
| 会话建立 | 带 token 调 dev-login → `GET /api/me` | 200，返回 user/roles |
| 会话销毁 | `POST /api/auth/logout` → `GET /api/me` | 200 → 401 |
| 未知接口 | `GET /api/nope`（已登录） | 404 / `code=40400` 包络 |
| 签名一致性 | `RequestSignerTest` 固定向量 | 2/2 通过（与 Node 算法逐字符一致） |

## 待接（下一步）

1. **真实登录**：`POST /api/auth/login` → 调 Node `/auth/login/account` + `/users/me/permissions`，把 token 存进 Session、menus/buttons 存 Session；随后**删除 `DevAuthController`**（当前 `spring.profiles.default=dev` 才生效）。
2. **NodeApiClient**：在 `RestClient` 之上做「拼 URL → `RequestSigner` 签名 → 解析包络 → `code!=0` 转异常 → 401 续期」。
3. **聚合控制器**：`agency/*`、`platform/*`（一页一请求，见规范 §5.3）。
4. **页面迁移**：把 `frontend/agency-web` 的登录屏、Layout、客服台、大屏迁进来，换请求层、删 `shared-auth`；**新工程验收通过后**再删旧目录。

> 红线：浏览器只持 `JSESSIONID` + `XSRF-TOKEN`；不得出现 `Authorization`、`X-Signature`、`X-Nonce`，也不得把 token 写进 localStorage。
