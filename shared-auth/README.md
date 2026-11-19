# shared-auth · 跨端共享鉴权包

纯 JS ES Module、零构建、零依赖。C 端 React 应用与 Web 管理端原型共用这一份
登录鉴权 + RBAC 实现，消除此前「C 端 lib/ 与 prototype/assets/api.js 两份漂移副本」的问题。

## 模块结构

| 文件 | 职责 |
|---|---|
| `src/config.js` | 全局配置（baseUrl / persist 档位 / storage key），`configureAuth()` 注入 |
| `src/session.js` | 会话仓库：令牌/用户/权限，订阅式快照，三档持久化（none / refresh / full） |
| `src/http.js` | 网络层：包络剥壳、Bearer、Idempotency-Key、HMAC-SHA256 防重放签名、401 单飞刷新+重放 |
| `src/auth.js` | 认证接口：验证码、账号/短信登录、注册、重置密码、资料/权限拉取、登出、会话恢复 |
| `src/rbac.js` | 权限判定纯函数：hasPermissionCode / hasAnyPermissionCode / canAccessPath / 角色码 |
| `src/guard.js` | Web 管理端守卫：登录门禁、页面角色守卫（platform 仅 SUPER_ADMIN / agency 拒纯游客）、无权面板 |
| `index.js` | 公共入口（C 端 import 用） |
| `index.d.ts` | TypeScript 类型声明 |
| `web.js` | 浏览器入口：注入 Web 端配置并挂载 `window.SharedAuth` + `window.WebApi`（旧版兼容层） |

## 两端如何接入

**C 端（frontend/src）**：`lib/config.ts` 启动时 `configureAuth({ baseUrl, persist })`；
`lib/{session,http,auth,permissions,permissionSync}.ts` 全部是从本包 re-export 的薄壳，
组件层代码零改动。令牌默认仅内存；`VITE_AUTH_PERSIST=1` 时仅 refresh_token 存 sessionStorage。

**Web 管理端（prototype）**：`assets/api.js` 是经典脚本加载器，动态 `import('/shared-auth/web.js')`
后挂载兼容层；页面用 `onWebApi(function () { ... })` 包裹初始化代码，等待共享包就绪。
会话持久化用 `persist:'full'`（localStorage：web_tokens / web_me / web_perms，与旧版 key 一致）。
页面守卫：`requireSession()`（登录门禁）+ `checkPageAccess(role)`（角色守卫，越权渲染无权面板）。

## 后端契约要点（backend/src/api/core.ts + API_V1.md）

- 统一包络 `{code, message, data, trace_id}`，`code !== 0` 抛 ApiError；
- 写请求强制 `Idempotency-Key`；登录态写请求需 HMAC 签名：
  `message = METHOD \n /v1路径(含query) \n X-Timestamp \n X-Nonce \n sha256(body)`，key = 当前 token；
- 401（20012）单飞刷新 `/auth/refresh` 后重放一次；403（20013）/429（20014）有语义化 getter。
