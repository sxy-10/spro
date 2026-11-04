# 阶段二 · 第二步：授权介入（Casbin 授权层）交付说明

> 交付人：组员 2　｜　阶段：第二阶段（后端安全底座与接口实现）　｜　依赖：组员 1 已交付的 `req.user`
>
> 任务原文：「接入 Casbin，读取数据库权限规则，编写 `requireAction(module, action)` 授权中间件，实现未授权拦截 403。」

---

## 一、这次交付了什么

| 交付物 | 文件 | 说明 |
| --- | --- | --- |
| Casbin 策略引擎 | `backend/src/auth/casbin.ts` | 模型定义 + MySQL 只读适配器 + 引擎缓存 + 判定入口 |
| 权限码折算层 | `backend/src/auth/permissionCode.ts` | 权限码 ⇄ `(obj, act)` 唯一口径，纯函数、可单测 |
| 授权中间件 | `backend/src/auth/rbac.ts` | `requireAction(module, action)` 为核心，保留 `requirePermission` 等旧写法 |
| 接口挂载与缓存失效 | `backend/src/api/rbacRouter.ts` | 全部守卫改成 `requireAction(...)`；写操作成功后立即作废策略缓存 |
| 单元测试 12 例 | `backend/src/auth/rbac.test.ts` | 折算口径 / Casbin 判定 / 守卫三态 / 真实 HTTP 链路 |
| 联调验收脚本 | `backend/src/api/rbacRouter.e2e.ts` | 第 7 段专测「改完权限立即生效」，需真实 MySQL |
| 数据库体检 | `backend/src/db/preflight.ts` | `npm run db:check` 只读检查 `.env`、MySQL、建库脚本是否跑全、种子数据是否够 |
| 依赖 | `backend/package.json` | 新增 `casbin@^5.51`，新增 `test:rbac`、`test:auth`、`e2e:rbac`、`db:check` 脚本 |

一句话结论：**认证（你是谁）在组员 1 那里，授权（你能做什么）现在统一由 Casbin 判定，路由上只写一行 `requireAction(模块:资源, 操作)`。**

---

## 二、依赖与前置

1. **组员 1 的契约**（已就绪）：`authenticateJwt` 校验 JWT 与 `api_session` 后，把下面这个对象挂到 `req.user`：

   ```ts
   { id: string, phone: string, role: string, agency_id: number | null,
     roles: string[],        // sys_user_role → sys_role.code
     permissions: string[],  // sys_role_permission → sys_permission.code
     sessionId: string }
   ```

2. **组员 2 阶段一的产物**：`database/05_rbac_schema.sql`（4 张表 + 种子角色）。Casbin 的策略数据全部来自这里，**没有第二份配置**。

3. 本层不碰密码、不碰 Token、不重复验签，只做「拿 `req.user` → 查策略 → 放行 / 403」。

---

## 三、分层与调用链

```text
请求
 │
 ├─ authenticateJwt（组员1）          验签 + 校验 api_session + 聚合 roles/permissions
 │        └─ 失败 → 401 / 业务码 20012
 │
 ├─ requireAction('route:line', 'add')  ← 本层：路由声明「需要什么」
 │        │
 │        ├─ toPolicyRequest()          权限码 → (obj='route:line', act='add')
 │        ├─ evaluateRequests()         交给 Casbin
 │        │     ├─ getEnforcer()        30s 缓存；写操作后由钩子立即失效
 │        │     │     ├─ g 规则 ← sys_user_role + sys_role
 │        │     │     └─ p 规则 ← sys_role_permission + sys_permission
 │        │     ├─ enforce(userId, obj, act)   角色继承（g 规则）
 │        │     ├─ enforce(roleCode, obj, act) 兼容 req.user.roles 快照
 │        │     └─ 策略表为空/不可用 → 退回 req.user.permissions（同口径）
 │        │
 │        └─ 不通过 → 403 / 业务码 20013「权限不足，禁止访问」+ 服务端日志 rbac.denied
 │
 └─ handler（组员3 的业务逻辑）；数据级隔离（agency_id）仍在 handler 内收口
```

设计上刻意保留**两条退路**，但都指向同一个结论口径：

- **策略表为空**（例如 `05_rbac_schema.sql` 还没执行）：退回认证阶段聚合的权限快照，不至于把全站一刀切拒掉；
- **策略库不可用**（数据库抖动）：同样退回快照，并打印 `rbac.policy.load_failed`，便于发现隐性故障；
- **两者都拿不到 → 拒绝**（fail-closed）。宁可少放行，绝不因为引擎出错就放行。

---

## 四、Casbin 模型

```ini
[request_definition]
r = sub, obj, act          # 谁 · 对哪个资源 · 做什么操作

[policy_definition]
p = sub, obj, act          # 角色 · 拥有哪个资源 · 的什么操作

[role_definition]
g = _, _                   # 用户 → 角色（来自 sys_user_role）

[policy_effect]
e = some(where (p.eft == allow))   # 命中任意一条 allow 即放行（白名单制，默认拒绝）

[matchers]
m = g(r.sub, p.sub) && keyMatch(r.obj, p.obj) && (r.act == p.act || p.act == "*")
```

三处关键语义：

1. `g(r.sub, p.sub)` —— 让「用户 → 角色 → 权限」两跳生效。没有它，角色继承会静默失效（测试里专门对模型文本做了断言，防止被误改）。
2. `keyMatch(r.obj, p.obj)` —— 支持前缀通配：`p, SUPER_ADMIN, route:*, *` 可以覆盖 `route:line` 等整棵子树。**通配只允许出现在「已授予」一侧**，路由声明必须是精确码，避免守卫被写松。
3. `p.act == "*"` —— 允许「全量操作」授权（超管兜底、临时运维授权）。

模型文本内联在 `casbin.ts` 的 `RBAC_MODEL_TEXT` 常量里，而不是放 `.conf` 文件：`tsc` 构建不会拷贝非 TS 资源，放文件容易在部署机上「模型找不到」而静默崩掉。

---

## 五、权限码 ⇄ `(obj, act)` 折算表

数据库里的权限码是 `模块[:资源[:操作]]`，Casbin 需要 `(obj, act)` 两段。折算规则只写一次（`permissionCode.ts`），策略路径与快照路径共用，天然不会漂移。

| 权限码 | 类型 | `obj` | `act` |
| --- | --- | --- | --- |
| `system` | MENU（顶层模块） | `system` | `view` |
| `system:role` | MENU（资源菜单） | `system:role` | `view` |
| `system:role:add` | BUTTON | `system:role` | `add` |
| `route:*` | 通配（模块级） | `route` + `route:*` | `*` |
| `route:line:*` | 通配（资源级） | `route:line` + `route:line:*` | `*` |
| `*` | 全量通配 | `*` | `*` |

两条刻意收紧的规则：

- **菜单级授权只放行 `view`**：持有 `system:role` 不等于持有 `system:role:query`。菜单是「能看见/能进去」，不能悄悄放大成数据操作。
- **大小写不敏感**：统一 `trim + toLowerCase`，前端传 `System:Role` 不会导致 403。

---

## 六、策略从数据库来：两条 SQL + 一个失效钩子

`MySqlRbacAdapter`（只读适配器，不引入 ORM）：

```sql
-- g 规则：用户 → 角色
SELECT CAST(ur.user_id AS CHAR) AS user_id, r.code AS role_code
  FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
 WHERE r.status = 'ENABLED';

-- p 规则：角色 → 权限
SELECT r.code AS role_code, p.code AS permission_code
  FROM sys_role_permission rp
  JOIN sys_role r       ON r.id = rp.role_id
  JOIN sys_permission p ON p.id = rp.permission_id
 WHERE r.status = 'ENABLED' AND p.status = 'ENABLED';
```

**缓存**：引擎实例缓存 30 秒（`RBAC_POLICY_TTL_MS` 可调，设 `0` 表示每次请求都重读），避免每个请求都打两张表。

**失效**：`rbacRouter.ts` 顶部挂了一个路由级钩子——本模块任何非 GET 请求成功返回（状态码 < 400）就调用 `invalidatePolicyCache()`，下一个请求自然重载：

```ts
rbac.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => { if (res.statusCode < 400) invalidatePolicyCache(`${req.method} ${req.originalUrl}`); });
  }
  next();
});
```

写在一个地方，而不是每个 handler 里手写，**不可能漏写**。这解决了 RBAC 最常见的线上诡异现象：「超管刚勾完权限，用户刷新还是 403，等半分钟才好」。

> 为什么不让 Casbin 直接写策略（`savePolicy`）？因为改权限要幂等键、要事务、要补祖先菜单、要拦内置角色，这些都在 `rbacRouter` 的事务里。**写数据一条路，读策略一条路**，不会出现两套写入逻辑打架。

---

## 七、中间件用法（给组员 3 / 组员 6 的对接方式）

```ts
import { requireAction, requireAnyAction } from '../auth/rbac.js';

api.get('/admin/routes',    requireAction('route:line', 'query'),  handler);
api.post('/admin/routes',   requireAction('route:line', 'add'),    handler);
api.put('/admin/routes/:id',requireAction('route:line', 'update'), handler);
api.get('/admin/analytics', requireAction('order:manage', 'query'),handler);

// 同一个接口「编辑或删除都能进」
api.patch('/plans/:id', requireAnyAction(['itinerary:plan', 'update'], ['itinerary:plan', 'add']), handler);
```

兼容旧写法（既有代码一行都不用改，内部走同一套折算与判定）：

```ts
requirePermission('route:line:add');          // 等价 requireAction('route:line', 'add')
requirePermission('system:role:query', 'system:role:export');  // 必须全部持有
requireAnyPermission('a:b:c', 'a:b:d');       // 持有其一即可
requireRole('SUPER_ADMIN');                   // 仅用于「整块业务归属某类主体」的场景
```

同步判断（菜单渲染、业务内联，只看 `req.user` 快照、不打库）：

```ts
hasPermission(req, 'order:manage', 'export');  // true / false
isCodeGranted('system:role:add', req.user.permissions);
```

**操作码必须真实存在**：`action` 写错（例如把 `query` 写成 `find`）不会静默放行，结果是该接口永远 403——这是刻意的 fail-closed，让错误在联调期立刻暴露。

---

## 八、错误码与日志

| 场景 | HTTP | 业务码 | 文案 |
| --- | --- | --- | --- |
| 未登录 / 会话失效 | 401 | 20012 | 请先登录（或策略引擎返回的具体原因） |
| 已登录但缺权限 | 403 | 20013 | 权限不足，禁止访问 |
| 策略库加载失败 | —（不改变响应码） | — | 降级到快照判定，日志 `rbac.policy.load_failed` |

越权响应**不回传**缺失的权限码（不泄露权限模型），只在服务端日志留痕：

```json
{"level":"warn","event":"rbac.denied","guard":"requireAction","trace_id":"…","user_id":"1",
 "roles":["AGENCY_ADMIN"],"required":["system:role:query"],"missing":["system:role:query"],
 "engine":"casbin","path":"/v1/roles"}
```

`engine` 字段说明这次是谁判的：`casbin`（策略）/ `snapshot`（降级）。排障时一眼能看出「策略没加载」这类问题。

---

## 九、验收清单

### 1. 自动化测试（不依赖数据库）

```bash
cd backend
npm run test:rbac     # 12 个用例全绿：折算口径 / Casbin 判定 / 守卫三态 / HTTP 链路
npm run test:auth     # 组员1 的认证测试不受影响
npm test              # 原有接口契约无回归
npx tsc --noEmit      # 类型检查
```

`npm run test:rbac` 的关键用例（对应验收要点）：

- 游客访问 `/v1/admin/routes` → **403 + 20013**，响应包络仍是 `code/message/data/trace_id`；
- 无 token → **401 + 20012**，与 403 严格区分；
- 旅行社管理员持有 `route:line:query` → 放行（**不再依赖 `sys_user.role = 'ADMIN'`**）；
- 只给菜单 `system:role` → 查角色列表仍 403（菜单授权不放大）；
- 只给 `route:line:query` → 新增线路 403（读权限不放大成写权限）；
- `g, 42, AGENCY_ADMIN` 单独生效（证明角色继承真的走了 `sys_user_role`，而不是只信 Token 里的快照）。

### 2. 真实数据库联调（已实跑通过）

**前置体检（只读，不改数据）**：

```bash
cd backend
npm run db:check
```

它会检查 `.env` 是否齐全、MySQL 是否连得上、库是否存在，并按 01 → 04 → 05 → 06 反推「缺哪张表」，最后给出要补的命令。数据库不存在时会直接告诉你「连 01_schema.sql 都没执行过」。

**建库顺序**（在项目根目录执行，顺序不能颠倒）：

```bash
mysql -u root -p --default-character-set=utf8mb4 < database/01_schema.sql
mysql -u root -p --default-character-set=utf8mb4 < database/04_api_v1.sql
mysql -u root -p --default-character-set=utf8mb4 < database/05_rbac_schema.sql
mysql -u root -p --default-character-set=utf8mb4 < database/06_route_stock.sql
```

> Windows 下必须带 `--default-character-set=utf8mb4`。mysql 客户端默认按 GBK 解码，而 05 的种子数据含中文角色名/权限名，会报 `ERROR 1366 Incorrect string value: '\xAE\xA2' for column 'name'`——不是脚本坏了，是客户端编码不对。
>
> `02_seed.sql` 是业务演示数据（POI、线路、订单），联调和 RBAC 验收都不依赖它，可以不执行。

**跑联调**：

```bash
npm run e2e:rbac      # 第 7 段专门验证「改完权限立即生效」
```

脚本开头会**自动准备联调账号**（幂等，可反复执行）：创建/重置 `13800000001`（超管）、`13800000002`（社管）、`13800000003`（游客），密码统一 `Passw0rd!23`，并按 `SUPER_ADMIN / AGENCY_ADMIN / TOURIST` 覆盖式绑定角色。建 ADMIN 账号需要 `agency_id`，而 `sys_user` 上有外键 `fk_user_agency`，所以脚本会先幂等补一条 `travel_agency(id=1)`，不依赖 `02_seed.sql`。

> 为什么不让脚本直接用 `02_seed.sql` 的账号：那份种子里的密码是占位哈希，登录必然失败，而且只建了 2 个账号、没有 `sys_user_role` 绑定。联调要的是「三种角色各一个能登录的账号」，与其手工建号，不如让脚本自己补。

第 7 段做的事：建临时角色 → 只给 `route:line:query` → 引擎判定「查询放行、新增拒绝」→ 补上 `route:line:add` → **不再等待就直接放行** → 打印策略条数（`p`/`g`）→ 删掉临时角色。

**实测结果（2026-11-04，本机 MySQL 8.0.42 / travel_agent_db）**：

```
=== 3. 角色列表的越权拦截 ===
PASS  社管 GET /roles → 403/20013  ->  [403,20013]
PASS  超管 GET /roles → 200  ->  200
=== 7. Casbin 策略热更新（组员2 阶段二验收点）===
{"event":"rbac.policy.invalidated","reason":"PUT /v1/roles/5/permissions"}
{"event":"rbac.policy.loaded","grouping_rules":3,"policy_rules":51}
PASS  Casbin：只给 query → 查询放行  ->  true
PASS  Casbin：只给 query → 新增拒绝（不是只读人就都能写）  ->  false
PASS  Casbin：补完 add 授权后立即生效（缓存已被写操作作废）  ->  true
   策略条数：p=51，g=3
ALL PASS
```

日志里能直接看到证据链：写授权 → `rbac.policy.invalidated` → 下一次判定重新 `rbac.policy.loaded`，策略条数从 50 变 51，所以「立即生效」不是靠等缓存过期。

### 3. 手工自查 SQL（确认策略数据本身是对的）

```sql
-- 某用户的权限码（策略 p 的来源）
SELECT DISTINCT p.code, p.resource_type
  FROM sys_user_role ur
  JOIN sys_role_permission rp ON rp.role_id = ur.role_id
  JOIN sys_permission p       ON p.id = rp.permission_id
 WHERE ur.user_id = 1 AND p.status = 'ENABLED';

-- 某用户的角色码（策略 g 的来源）
SELECT r.code FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
 WHERE ur.user_id = 1 AND r.status = 'ENABLED';
```

如果这里为空，接口必然 403 —— 先查数据，再怀疑中间件。

### 4. 手工联调（两条 curl 就能演示）

```bash
# 1) 旅行社管理员访问角色列表 → 403/20013（没有 system:role:query）
curl -s -H "Authorization: Bearer $AGENCY_TOKEN" http://localhost:3001/v1/roles
# {"code":20013,"message":"权限不足，禁止访问","data":null,"trace_id":"…"}

# 2) 超管操作 PUT /roles/{id}/permissions 给它加上 104(system:role:query) 后，同一个 token 立刻 200
curl -s -H "Authorization: Bearer $AGENCY_TOKEN" http://localhost:3001/v1/roles
```

---

## 十、设计取舍与后续可扩展

| 取舍 | 原因 |
| --- | --- |
| 策略读多写少、只读适配器 | 写策略必须走带幂等/事务/校验的接口，避免两套写入路径 |
| 30s 缓存 + 写操作失效 | 兼顾「改完立即生效」与「正常请求不打库」；多实例部署时靠 TTL 收敛 |
| 认定主体为「用户 ID + 角色码」双候选 | 用户 ID 走 `g` 规则（标准 RBAC）；角色码兜住策略缓存 TTL 内角色刚变更的场景 |
| 菜单只放行 `view` | 防止「能看见页面」被误当成「能操作数据」 |
| fail-closed | 引擎异常时不放行；已有快照兜底，不会因为一次抖动全站 403 |

后续可扩展（不在本阶段范围）：

- **数据级权限**：模型加 `r.dom`（机构 ID），`p = sub, dom, obj, act`，把 `agency_id` 隔离从 handler 里上移到策略层；
- **多实例一致**：把策略版本号放 Redis，写操作后 `INCR`，各实例按版本号失效，替代 30s TTL 兜底；
- **策略审计**：`rbac.denied` 日志已带 `user_id / required / missing / trace_id`，可直接接入日志平台做越权告警。

---

## 十一、文件清单

```text
backend/src/auth/permissionCode.ts    权限码 ⇄ (obj, act) 折算（纯函数）
backend/src/auth/casbin.ts            Casbin 模型 / MySQL 适配器 / 引擎缓存 / 判定入口
backend/src/auth/rbac.ts              requireAction 等守卫中间件
backend/src/auth/rbac.test.ts         12 个用例（含 HTTP 全链路）
backend/src/api/rbacRouter.ts         9 个 RBAC 接口 + 策略缓存失效钩子
backend/src/api/rbacRouter.e2e.ts     真实数据库联调（含策略热更新验收）
backend/src/db/preflight.ts            数据库/配置体检（npm run db:check，只读）
database/05_rbac_schema.sql           阶段一产物：4 张表 + 种子角色（策略数据来源）
API_V1.md                             补充「401/403 与 Casbin 判定」契约说明
```
