# Apifox 接口录入清单（组员 6 专用·组员 4 整理）

> 整理人：组员 4　｜　用途：把「认证链路」在 Apifox 里补全，让 Mock 能真正替代后端跑前端
> 现状：用组员 4 的探测，`https://m1.apifoxmock.com/m1/9004136-8812876-default` 这个地址**本身有效**（项目存在），但
> `GET /v1/auth/captcha`、`POST /v1/auth/login`、`/v1/auth/login/account`、`/v1/routes`、`/v1/users/me/permissions` 等**全部返回 404「不存在接口」**。
> 说明 Mock 里目前没有这些接口（或没保存/没开 Mock）。照着下面录 10 个接口，Mock 就能顶替后端了。

---

## 一、公共约定（录之前先统一，否则前端一律报错）

**1）统一响应外壳**（每个接口的「返回响应」都套这一层）

```json
{ "code": 0, "message": "ok", "data": {}, "trace_id": "0f4d6a52-9f0b-4f3e-8c1a-6b2d9e7c5a10" }
```

**2）前端一定会带的请求头**（Mock 里请设为**非必填**，别开严格校验，否则前端会被 400 打回）

| 请求头 | 说明 | 前端是否必带 |
| --- | --- | --- |
| `Authorization: Bearer <token>` | 登录态令牌 | 登录后必带 |
| `Idempotency-Key` | 幂等键（8–128 字符 UUID） | 所有 POST/PUT/PATCH/DELETE 必带 |
| `X-Timestamp` / `X-Nonce` / `X-Signature` | 防重放签名（HMAC-SHA256，密钥=token） | 登录后的写请求必带 |
| `X-Captcha-Id` | 图形验证码 id | 统一账号登录时必带 |

> Mock 不验签名没关系，但**接口定义里不要把这些头标成必填**，也不要给它们加格式校验。

**3）业务码对照（前端靠它区分「该跳登录」还是「该提示无权限」）**

| HTTP | code | 含义 | 前端行为 |
| --- | --- | --- | --- |
| 200 | 0 | 成功 | 正常渲染 |
| 400 | 10001 | 参数/账号密码/验证码错误 | 表单内提示红字 |
| 401 | 20012 | 未登录、会话失效 | **触发静默换票 → 失败则回登录页** |
| 403 | 20013 | 已登录但无权限 | 提示「权限不足，禁止访问」**不跳登录** |
| 409 | 20010 | 余位不足 | 提示重选日期 |
| 429 | 20014 | 限流 | 提示稍后再试 |

---

## 二、要录的 10 个接口

> 目录建议：`认证` / `用户` / `线路`。路径**不要**带 Mock 前缀，只写 `/v1/...`（前缀由 Mock 地址提供）。

### 1. `GET /v1/auth/captcha` 获取图形验证码

- 请求头：无
- 请求参数：无
- 返回 200：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "captcha_id": "6a1f3c2e-8b7d-4a91-9e5c-2f4b8d7a1c33",
    "captcha_image": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNDAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iNDAiIGZpbGw9IiNlZWVlZWUiLz48dGV4dCB4PSIyMCIgeT0iMjgiIGZvbnQtc2l6ZT0iMjIiPmE0azI8L3RleHQ+PC9zdmc+",
    "dev_code": "a4k2"
  },
  "trace_id": "0f4d6a52-9f0b-4f3e-8c1a-6b2d9e7c5a10"
}
```

> `captcha_image` 可以直接放 `data:image/svg+xml;base64,...`（前端两种都支持：SVG 源码或 data URI）。
> 想换图就改这段 base64；`dev_code` 是开发环境答案，前端会显示成提示。

### 2. `POST /v1/auth/login/account` 统一账号登录（密码 + 图形验证码）

- 请求头：`Content-Type: application/json`、`Idempotency-Key`、`X-Captcha-Id`
- 请求体：

```json
{ "account": "13800000003", "password": "Passw0rd!23", "captcha_code": "a4k2" }
```

- 返回 200：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiJ9.mock-access-token",
    "user_id": "3",
    "refresh_token": "eyJhbGciOiJIUzI1NiJ9.mock-refresh-token",
    "expires_in": 1800,
    "login_type": "unified_account"
  },
  "trace_id": "1c7e9b3a-4d2f-4c88-b1a5-7e3f9c2d4b61"
}
```

- 返回 400（账号密码错）：

```json
{ "code": 10001, "message": "账号或密码错误", "data": null, "trace_id": "1c7e9b3a-4d2f-4c88-b1a5-7e3f9c2d4b61" }
```

- 返回 400（验证码错）：

```json
{ "code": 10001, "message": "图形验证码错误或已过期", "data": null, "trace_id": "1c7e9b3a-4d2f-4c88-b1a5-7e3f9c2d4b61" }
```

### 3. `POST /v1/auth/login/sms` 短信验证码登录

- 请求头：`Content-Type`、`Idempotency-Key`
- 请求体：`{ "mobile": "13800000003", "sms_code": "123456" }`
- 返回 200：同 #2（去掉 `login_type`、`refresh_token` 可留可去）
- 返回 400：

```json
{ "code": 10001, "message": "验证码错误或已过期", "data": null, "trace_id": "2d8f1c4b-6e3a-4f77-9d2b-8c5e1a3f7b92" }
```

### 4. `POST /v1/auth/reset-password` 重置密码

- 请求头：`Content-Type`、`Idempotency-Key`
- 请求体：`{ "mobile": "13800000003", "sms_code": "123456", "new_password": "NewPassw0rd!23" }`
- 返回 200（**防枚举：手机号不存在也返回成功**）：

```json
{ "code": 0, "message": "ok", "data": null, "trace_id": "3e9a2b7c-1f4d-4a6e-8b3c-5d7f9a1e2c48" }
```

### 5. `POST /v1/auth/login` 手机号密码登录（旧接口，注册后自动登录用）

- 请求体：`{ "mobile": "13800000003", "password": "Passw0rd!23" }`
- 返回 200：`{ "code": 0, "message": "ok", "data": { "token": "…", "user_id": "3" }, "trace_id": "…" }`

### 6. `POST /v1/auth/register` 注册（只能注册游客）

- 请求体：`{ "mobile": "13800000009", "password": "Passw0rd!23" }`
- 返回 201 / 200：`{ "code": 0, "message": "ok", "data": { "user_id": "9" }, "trace_id": "…" }`

### 7. `POST /v1/auth/logout` 登出

- 请求头：`Authorization`、`Idempotency-Key`
- 请求体：`{}`
- 返回 200：`{ "code": 0, "message": "ok", "data": null, "trace_id": "…" }`

### 8. `POST /v1/auth/refresh` 刷新令牌（静默换票用，**必须录，否则老师的验收点演示不了**）

- 请求体：`{ "refresh_token": "eyJhbGciOiJIUzI1NiJ9.mock-refresh-token" }`
- 返回 200：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiJ9.mock-access-token-renewed",
    "refresh_token": "eyJhbGciOiJIUzI1NiJ9.mock-refresh-token-rotated",
    "expires_in": 1800
  },
  "trace_id": "4f1b3c9d-2a5e-4b8f-9c6d-7a2e4f1b3c95"
}
```

- 返回 401：

```json
{ "code": 20012, "message": "刷新凭证已失效，请重新登录", "data": null, "trace_id": "4f1b3c9d-2a5e-4b8f-9c6d-7a2e4f1b3c95" }
```

### 9. `GET /v1/users/{id}` 当前用户资料（手机号脱敏）

- 请求头：`Authorization`
- 路径参数：`id`（例 `3`）
- 返回 200：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "user_id": "3",
    "nickname": "游客小张",
    "avatar_url": null,
    "role": "TOURIST",
    "default_departure_city": "昆明",
    "mobile": "138****0003",
    "created_at": "2026-11-01T02:10:00.000Z"
  },
  "trace_id": "5a2c4d8e-3b6f-4c19-9e7a-8b1d3f5a2c94"
}
```

### 10. `GET /v1/users/me/permissions` 动态菜单 + 按钮权限（组员 5 的数据源）

- 请求头：`Authorization`
- 返回 200：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "menus": [
      {
        "permission_id": "10",
        "parent_id": null,
        "name": "系统管理",
        "code": "system:menu",
        "path": "/admin",
        "icon": "setting",
        "sort": 10,
        "children": [
          {
            "permission_id": "11",
            "parent_id": "10",
            "name": "角色管理",
            "code": "system:role:menu",
            "path": "/admin/roles",
            "icon": "users",
            "sort": 11,
            "children": []
          }
        ]
      }
    ],
    "buttons": [
      { "permission_id": "21", "name": "新增线路", "code": "route:line:add", "resource_type": "BUTTON" },
      { "permission_id": "22", "name": "导出报表", "code": "report:export", "resource_type": "BUTTON" }
    ]
  },
  "trace_id": "6b3d5e9f-4c7a-4d2b-8f1e-9c2a4b6d8e31"
}
```

### 附：`GET /v1/routes` 与 `GET /v1/routes/{id}/stock`（公开接口，组员 5 的预订页要用）

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": "1", "route_id": "1", "product_no": "RT-2026-0001",
        "title": "云南经典 5 日", "destination": "云南", "default_days": 5,
        "style_tag": "自然", "base_price_rmb": "2680.00",
        "cover_image_url": null, "status": "ON_SALE", "is_active": true,
        "created_at": "2026-11-01T00:00:00.000Z"
      }
    ],
    "total": 1,
    "has_more": false
  },
  "trace_id": "7c4e6f1a-5d8b-4e3c-9a2f-1b3d5e7c9a42"
}
```

```json
{ "code": 0, "message": "ok", "data": { "total_seats": 40, "available_seats": 12, "is_sellable": true }, "trace_id": "8d5f7a2b-6e9c-4f4d-8b3a-2c4e6f8d1b53" }
```

---

## 三、让 Mock 能演示「401 静默换票」（关键一步）

Apifox 默认只会返回「第一个 200 示例」，永远 401 不了，老师的验收点就演不出来。用**高级 Mock**加一段脚本（接口 → Mock → 高级 Mock）：

```js
// 约定：请求头 Authorization 里的 token 为 expired 时，模拟"令牌过期"
const auth = String(request.headers['authorization'] || '');
if (!auth || auth.includes('expired')) {
  mockResponse.status = 401;
  mockResponse.body = JSON.stringify({
    code: 20012,
    message: '请先登录',
    data: null,
    trace_id: 'mock-401-trace'
  });
}
```

演示流程：登录 → 把内存里的 token 改成 `expired`（或让前端把过期令牌发出去）→ 接口返回 401/20012 → 前端自动打 `/v1/auth/refresh` 换票 → 重放成功。**这一条能把「401 → refresh → 重放」整条链路演清楚。**

---

## 四、录完怎么自检（30 秒，复制粘贴即可）

```powershell
$base = "https://m1.apifoxmock.com/m1/9004136-8812876-default"
$posts = @('/v1/auth/login','/v1/auth/login/account','/v1/auth/login/sms','/v1/auth/reset-password','/v1/auth/logout','/v1/auth/refresh')
foreach ($p in $posts) {
  $code = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base$p" -H "Content-Type: application/json" -d '{}'
  "POST $p -> $code"
}
foreach ($p in @('/v1/auth/captcha','/v1/users/me/permissions','/v1/routes')) {
  $code = curl.exe -s -o NUL -w "%{http_code}" "$base$p"
  "GET  $p -> $code"
}
```

**判定标准**：出现 `200` 或 `400`（业务校验错）都算「录进去了」；出现 **404 `不存在接口`** 就是还没录 / 没保存 / Mock 没开。

---

## 五、录好之后前端怎么切（组员 4 来改，不用组员 6 操心）

新建 `frontend/.env.local`：

```bash
VITE_API_BASE_URL=https://m1.apifoxmock.com/m1/9004136-8812876-default
```

然后 `npm run dev`，登录页底部会显示「接口地址：…/v1」，DevTools Network 里能看到请求真的打到 Mock。**换回本地后端只要删掉这一行。**

---

## 六、给组员 6 的一句话总结

> 不用把整个 18 个业务接口都录完，**先把上面 10 个认证/用户接口录上**（预计 10 分钟），Mock 就能让前端独立跑通「登录 → 拉资料/权限 → 401 换票」整条链路；其余线路/订单接口可以后面按需补。
