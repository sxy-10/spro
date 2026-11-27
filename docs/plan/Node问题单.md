# Node 侧问题单

> 记录纪律（R1）：Node/数据库域的问题不自行修改，统一登记本单交组员3 执行。
> 每条问题一个编号，状态只有三种：`待处理` / `已处理` / `已绕过`。处理完把状态改掉并填"执行人/执行时间/验证方式"。

---

## #1 [S3] `analytics:platform:query` 权限码未种子化，平台方 4 页对超管 403

| 项 | 内容 |
|---|---|
| 登记人 | 组员2（S3） |
| 日期 | 2026-11-26 |
| 执行人 | 组员3 |
| 状态 | **待处理** |
| 优先级 | 高（阻塞 S3 的演示脚本第 1 条与出口判据「平台方 9 页真实数据」） |

### 现象（已实测复现）

超管 13800000001 登录 `http://localhost:5174` 后，平台方 9 页中 4 页报 403：

| 页面 | 地址 | 现象 |
|---|---|---|
| 平台总览 | `/platform/overview` | `总览加载失败 · 权限不足，禁止访问（HTTP 403 / code 20013）`，KPI 全 0 |
| 订单监督 | `/platform/orders` | `权限不足，禁止访问`，表格空 |
| 数据分析 | `/platform/analytics` | `分析数据加载失败 · 权限不足`，漏斗全 0 |
| 内容审核 | `/platform/audits` | `权限不足，禁止访问`，待审核列表空 |

其余 5 页（财务结算/旅行社管理/账号管理/AI 服务/系统参数）正常，有真实数据。
截图证据：`docs/plan/11.24 第12次课/体检截图/01~09-*.png`（01、02、04、07 为 403 现场）。

### 根因

`backend/src/api/platformRouter.ts` 四个接口共用同一个守卫：

| 行号 | 接口 | 守卫 |
|---|---|---|
| 52 | `GET /platform/overview` | `requireAction('analytics:platform', 'query')` |
| 187 | `GET /platform/audits` | 同上 |
| 317 | `GET /platform/orders` | 同上 |
| 502 | `GET /platform/analytics` | 同上 |

守卫把码拆成 `obj=analytics:platform, act=query` 去 Casbin 判定，而 Casbin 策略由
`sys_role_permission JOIN sys_permission` 生成（`backend/src/auth/casbin.ts:103`）。
**`sys_permission` 里不存在 `analytics:platform` / `analytics:platform:query` 两条记录**
（已全库检索 `database/` 下所有 SQL 均未种子化），策略无此行 → fail-closed → 超管也 403。

补充事实（写 SQL 时不要踩）：
- `sys_permission` 当前 `MAX(id) = 620`，共 102 条；**595/596 已被占用**
  （`chat:message:add`、`order:booking:add`），写死这两个 id 会报 `ERROR 1062 Duplicate entry`。
- 所以下面 SQL 用「当前最大 id + 1」自动取号，已用事务 + ROLLBACK 试跑验证（2026-11-26，跑出 621/622）。

### 修复 SQL（组员3 直接照抄执行）

```bash
cd backend
set -a && . ./.env && set +a
MYSQL_PWD="$DB_PASSWORD" mysql -uroot -h 127.0.0.1 --default-character-set=utf8mb4 travel_agent_db
```

进入 `mysql>` 后粘贴（**必须带 `--default-character-set=utf8mb4`**，中文会报 1366）：

```sql
-- 0. 先确认码确实不存在（期望 0 行；有行就跳过本单，说明已被处理）
SELECT id, code FROM sys_permission WHERE code LIKE 'analytics:platform%';

-- 1. 补两条权限（自动取号，不写死 id，避免 1062 撞号）
SET @pid := (SELECT COALESCE(MAX(id), 0) + 1 FROM sys_permission);
INSERT INTO sys_permission (id, parent_id, name, code, resource_type, path, icon, sort) VALUES
  (@pid,     NULL, '平台运营数据', 'analytics:platform',       'MENU',   '/platform/overview', 'chart', 12),
  (@pid + 1, @pid, '平台数据查询', 'analytics:platform:query', 'BUTTON', NULL, NULL, 1);

-- 2. 授给超级管理员（role_id=3）
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT 3, id FROM sys_permission WHERE code IN ('analytics:platform', 'analytics:platform:query');
```

### 执行后验证（两步，缺一不可）

1. **SQL 层**（期望 3 行全出现）：

   ```sql
   SELECT p.code FROM sys_permission p
   JOIN sys_role_permission rp ON rp.permission_id = p.id AND rp.role_id = 3
   WHERE p.code IN ('analytics:platform:query','system:permission:query','system:role:query');
   ```

2. **页面层**：执行人告知组员2 → 组员2 **退出重新登录**（`passport.ts:117` 把权限在登录时快照进
   `req.user.permissions`，不重登不生效；Casbin 另有进程内 30s 策略缓存，`casbin.ts:170`）
   → 访问 4 个页面，全部出真实数据 → 把 `docs/plan/11.24 第12次课/组员2-S3实施教程.md` 0-7 体检表补勾。

### 影响范围（给排期用）

- **只影响这 4 个页面"看数据"**，不阻塞 S3 的任何开发步骤：日志三页用 `system:permission:query`、
  角色页用 `system:role:*`，与本单无关。
- 不影响 e2e / npm test（这些用例不依赖该码）。
- 组员2 的兜底死线：**S3 第 3 步（RolesPage）结束时若本单仍是"待处理"，向组员3 确认排期；
  演示前一天仍未执行，经组员3 口头同意后由组员2 代为执行并回填本单状态。**

---

## #2 [S3] Java BFF 对 query 参数二次编码，时间范围筛选必报 10001

| 项 | 内容 |
|---|---|
| 登记人 | 组员2（S3） |
| 日期 | 2026-11-27 |
| 执行人 | 组员2 代改（**需组员1 复核**，`NodeApiClient` 是 S2 建的文件） |
| 状态 | **已处理**（单元测试 + 临时实例端到端验证通过；8080 需重启生效） |
| 优先级 | 中（阻塞日志三页的"时间过滤"验收项，不影响其他接口） |

### 现象

日志页不带日期查询正常；一旦选时间范围点「查询」，页面红条报
`参数为空、格式错误或超出允许范围`，`code: 10001`。

### 根因（Spring 6.1.15 实测确认）

1. 前端 `toISOString()` → `2026-11-25T16:00:00.000Z`
2. 前端 `qs()` 用 `URLSearchParams` → `%3A`
3. Tomcat 解码 → Java 拿到 `2026-11-25T16:00:00.000Z`
4. `PlatformController.query()` 的 `urlEncode()` 又编一次 → `%3A`
5. `NodeApiClient.execute()` 用 `client.method(method).uri(path)`，
   `RestClient` 默认 `EncodingMode=TEMPLATE_AND_VALUES`，把 `%3A` **再编成 `%253A`**
6. Node 收到字面量 `2026-11-25T16%3A00%3A00.000Z`，zod `datetime({offset:true})` 拒绝 → 10001

实测（`DefaultUriBuilderFactory`）：

```
uriString(path).build()              → from=2026-11-25T16%253A00%253A00.000Z   （坏）
UriComponentsBuilder...build(true)   → from=2026-11-25T16%3A00%3A00.000Z       （好）
```

**为什么其他接口没暴露**：`status=PAID`、`type=system` 这类纯字母数字参数，编一次和两次结果相同。

### 修法（已执行，2026-11-27 二次修正）

文件：`java-web/src/main/java/com/example/adminweb/api/NodeApiClient.java`

> ⚠️ **第一版修法是错的，已废弃**。`UriComponentsBuilder.fromUriString(path).build(true).toUri()`
> 只保证"不再编码"，产物是**相对 URI**（无 scheme）；`RestClient.uri(URI)` 不会套用 builder 上的
> `baseUrl`，直接抛 `IllegalArgumentException: URI with undefined scheme`。
> 后果：**所有经 NodeApiClient 的请求 500**，最直观的就是登录页图形验证码空白（`/api/auth/captcha` 500）。

最终写法：自己拼绝对地址，`URI.create` 只解析不编码。

```java
// 字段 + 构造器
private final String baseUrl;

public NodeApiClient(RestClient nodeRestClient, RequestSigner requestSigner, NodeProperties properties) {
    this.client = nodeRestClient;
    this.signer = requestSigner;
    String configured = properties.baseUrl() == null ? "" : properties.baseUrl();
    this.baseUrl = configured.endsWith("/") ? configured.substring(0, configured.length() - 1) : configured;
}

// execute() 内
URI target = URI.create(baseUrl + path);
RestClient.RequestBodySpec spec = client.method(method).uri(target).headers(h -> headers.forEach(h::set));
```

两个约束同时满足：`%XX` 不被二次编码（`URI.create` 不编码），且 URI 带 scheme（拼了 baseUrl）。

### 验证

1. 单元测试（新增回归用例）：`./mvnw -q test -Dskip.frontend=true -Dtest=NodeApiClientTest` → 5 个用例全绿。
   其中 `相对path能拼上baseUrl且已编码的百分号不被二次编码` 断言 `getRawQuery()` 为 `from=2026-11-25T16%3A00%3A00.000Z`（不是 `%253A`）。
2. 重启 Java（`./mvnw spring-boot:run -Dskip.frontend=true`），重新登录；
3. 登录页应能看到图形验证码（`/api/auth/captcha` 200，`data.captcha_image` 为 SVG 字符串）；
4. 日志页选一个时间范围 → 点查询 → 期望表格只剩范围内行，无红条；
5. 回归：随便点开财务结算、旅行社管理（带 keyword 的查询接口）确认未受影响。

实测记录（临时实例 8099，与 8080 同一套代码）：

```
GET  /api/auth/captcha                     → 200，data.captcha_image 以 <svg 开头
POST /api/auth/login (X-Captcha-Id+CSRF)   → 200，roles=["AGENCY_ADMIN","SUPER_ADMIN"]
GET  /api/platform/roles                   → 200，6 个角色
GET  /api/platform/roles/11/permissions     → [10,13,124]
PUT  ... {"permission_ids":["10","13"]}     → 200，回读 [10,13]（生效）
PUT  ... {"permissionIds":["10"]}           → 10001（旧前端写法，复现用户"点保存没反应"）
```

### 影响面

- 全局受益：所有 GET 的 query 参数不再被二次编码（中文 keyword、ISO 时间、含 `/` 的路径参数都正确）；
- 写请求签名不受影响：`RequestSigner` 用的仍是原始 `path` 字符串，与本次改动无关；
- 构造器签名变化：`NodeApiClientTest#client()` 已同步传 `NodeProperties`。

---

## #3 [S3] `AuthFlowTest` 4 个用例因 IM WebSocket 配置起不来上下文（既有失败，非本次改动）

| 项 | 内容 |
|---|---|
| 登记人 | 组员2（S3） |
| 日期 | 2026-11-27 |
| 执行人 | **组员4**（`ImWebSocketConfig` 属 IM 域） |
| 状态 | **待处理** |
| 优先级 | 低（不影响 S3 验收；影响的是 `mvn test` 整体绿灯） |

### 现象

`./mvnw -q test -Dskip.frontend=true` 结果 `Tests run: 11, Failures: 0, Errors: 4`，4 个 Error 全部来自 `AuthFlowTest`：

```
Caused by: BeanCreationException: Error creating bean with name 'webSocketContainer'
  defined in .../config/ImWebSocketConfig.class:
  Attribute 'jakarta.websocket.server.ServerContainer' not found in ServletContext
```

通过的是 `NodeApiClientTest`(5) + `RequestSignerTest`(2)。

### 根因

`AuthFlowTest` 用 `@SpringBootTest + @AutoConfigureMockMvc`（MockMvc 不启动真实 Tomcat，ServletContext 里没有
`jakarta.websocket.server.ServerContainer` 属性）；而 `ImWebSocketConfig` 里声明了 `webSocketContainer` /
`ServerEndpointExporter` 这类**只有真实容器才提供**的 bean，于是整块 ApplicationContext 刷新失败。
IM 代码来自提交 `78d45e5`，与 S3 的 `NodeApiClient` 改动无关。

### 建议修法（组员4 任选其一）

1. `ImWebSocketConfig` 的 bean 加条件：`@ConditionalOnWebApplication(type = SERVLET)` 不足以解决（MockMvc 也是 servlet），
   应在 bean 方法里判断 `servletContext.getAttribute(ServerContainer.class.getName()) == null` 时不注册；
2. 或把 `AuthFlowTest` 改为 `@SpringBootTest(webEnvironment = RANDOM_PORT)`（起真实容器，注释里已有"真实 Node 联调"的取向）；
3. 或在 `AuthFlowTest` 上加 `@MockBean` 顶掉 `webSocketContainer`。

### 影响

- S3 的验收证据不受影响：`NodeApiClientTest` 5/5 通过，登录/验证码/角色权限均已用真实实例端到端验证（见 #2 的实测记录）。
