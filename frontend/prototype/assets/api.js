/* ============================================================
 * 旅游规划智能体 · Web 端后台 API 客户端
 * 与后端契约逐字节对齐（backend/src/api/core.ts + API_V1.md）：
 *   - 统一包络 {code, message, data, trace_id}，code !== 0 视为业务错误
 *   - 写请求自动携带 Idempotency-Key（后端 write() 强制校验）
 *   - 写请求 HMAC-SHA256 防重放签名：
 *       message = METHOD \n /v1原始路径(含query) \n X-Timestamp \n X-Nonce \n sha256(body)
 *       key     = 当前 access token；时间戳必须以 Z 结尾（后端 zod offset:false）
 *   - 401 单飞刷新：并发 401 只发起一次 /auth/refresh，成功后重放原请求一次
 * 会话：localStorage 保存 token / me / permissions（演示环境；生产建议 sessionStorage）。
 * ============================================================ */
(function (global) {
  "use strict";

  var TOKENS_KEY = "web_tokens";
  var ME_KEY = "web_me";
  var PERMS_KEY = "web_perms";
  var BASE_KEY = "web_api_base";

  var BASE = global.localStorage.getItem(BASE_KEY) || "http://127.0.0.1:3001/v1";

  function readJson(key) {
    try { return JSON.parse(global.localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function writeJson(key, value) {
    if (value == null) global.localStorage.removeItem(key);
    else global.localStorage.setItem(key, JSON.stringify(value));
  }

  var tokens = readJson(TOKENS_KEY);
  var me = readJson(ME_KEY);
  var perms = readJson(PERMS_KEY);

  /* ---------------- crypto helpers ---------------- */
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }
  function sha256Hex(text) {
    return global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(hex);
  }
  function hmacHex(keyText, message) {
    return global.crypto.subtle.importKey(
      "raw", new TextEncoder().encode(keyText), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    ).then(function (key) {
      return global.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    }).then(hex);
  }
  function uuid() {
    if (global.crypto.randomUUID) return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /* ---------------- errors ---------------- */
  function ApiError(status, code, message, traceId) {
    this.status = status; this.code = code; this.message = message; this.traceId = traceId || "";
  }
  ApiError.prototype = Object.create(Error.prototype);

  /* ---------------- refresh single-flight ---------------- */
  var refreshing = null;
  function refreshTokens() {
    if (!tokens || !tokens.refresh_token) return Promise.reject(new ApiError(401, 20012, "登录已失效，请重新登录"));
    if (!refreshing) {
      refreshing = global.fetch(BASE + "/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ refresh_token: tokens.refresh_token })
      }).then(function (res) { return res.json(); }).then(function (env) {
        if (env.code !== 0 || !env.data || !env.data.token) {
          clearSession();
          throw new ApiError(401, 20012, "登录已失效，请重新登录");
        }
        tokens = { token: env.data.token, refresh_token: env.data.refresh_token, user_id: tokens.user_id };
        writeJson(TOKENS_KEY, tokens);
        return tokens.token;
      }).finally(function () { refreshing = null; });
    }
    return refreshing;
  }

  function clearSession() {
    tokens = null; me = null; perms = null;
    writeJson(TOKENS_KEY, null); writeJson(ME_KEY, null); writeJson(PERMS_KEY, null);
  }

  /* ---------------- core request ---------------- */
  function request(path, method, body, opts) {
    opts = opts || {};
    method = (method || "GET").toUpperCase();
    var sep = path.indexOf("?") >= 0 ? "&" : "?";
    var url = BASE + path + (opts._retry ? sep + "_r=1" : "");
    var headers = { "Accept": "application/json" };
    var bodyText = method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body || {});
    if (bodyText !== undefined) headers["Content-Type"] = "application/json";
    if (tokens && tokens.token) headers["Authorization"] = "Bearer " + tokens.token;

    var signPromise = Promise.resolve();
    var isWrite = method !== "GET";
    headers["Idempotency-Key"] = opts.idempotencyKey || uuid();
    if (isWrite && tokens && tokens.token && !opts.skipSign) {
      headers["X-Timestamp"] = new Date().toISOString();
      headers["X-Nonce"] = uuid();
      signPromise = sha256Hex(bodyText || "")
        .then(function (digest) {
          // 后端 req.originalUrl 带 /v1 前缀（BASE 以 /v1 结尾）
          var signedPath = "/v1" + path;
          return hmacHex(tokens.token, method + "\n" + signedPath + "\n" + headers["X-Timestamp"] + "\n" + headers["X-Nonce"] + "\n" + digest);
        })
        .then(function (sig) { headers["X-Signature"] = sig; });
    }

    return signPromise.then(function () {
      return global.fetch(url, { method: method, headers: headers, body: bodyText });
    }).then(function (res) {
      return res.json().catch(function () { return { code: -1, message: "响应解析失败" }; }).then(function (env) {
        if (res.status === 401 && tokens && tokens.refresh_token && !opts._retry) {
          return refreshTokens().then(function () {
            return request(path, method, body, Object.assign({}, opts, { _retry: true }));
          });
        }
        if (res.status >= 400 || env.code !== 0) {
          var err = new ApiError(res.status, env.code, env.message || "请求失败", env.trace_id);
          if (res.status === 401 && opts._retry) clearSession();
          throw err;
        }
        return env.data;
      });
    });
  }

  /* ---------------- session ---------------- */
  function loadSession() {
    return Promise.all([
      request("/users/me", "GET"),
      request("/users/me/permissions", "GET")
    ]).then(function (results) {
      me = results[0];
      perms = results[1];
      writeJson(ME_KEY, me);
      writeJson(PERMS_KEY, perms);
      return { me: me, perms: perms };
    });
  }

  /* 登录需要 X-Captcha-Id 请求头，request() 未暴露自定义头 —— 单独实现 */
  function doLogin(account, password, captchaCode, captchaId) {
    var bodyText = JSON.stringify({ account: account, password: password, captcha_code: captchaCode });
    return sha256Hex(bodyText).then(function () {
      return global.fetch(BASE + "/auth/login/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", "Accept": "application/json",
          "Idempotency-Key": "login-" + uuid(),
          "X-Captcha-Id": captchaId || ""
        },
        body: bodyText
      });
    }).then(function (res) { return res.json(); }).then(function (env) {
      if (env.code !== 0) throw new ApiError(400, env.code, env.message || "登录失败", env.trace_id);
      tokens = { token: env.data.token, refresh_token: env.data.refresh_token, user_id: env.data.user_id };
      writeJson(TOKENS_KEY, tokens);
      return loadSession();
    });
  }

  function logout() {
    var p = tokens ? request("/auth/logout", "POST", {}).catch(function () { /* 会话已失效也允许登出 */ }) : Promise.resolve();
    return p.then(function () { clearSession(); });
  }

  function perm(code) {
    if (!perms || !Array.isArray(perms.buttons)) return false;
    return perms.buttons.some(function (b) { return b.code === code; });
  }
  function roleCodes() {
    if (!me || !Array.isArray(me.roles)) return [];
    return me.roles.map(function (r) { return r.code; });
  }
  function isAdmin() { return roleCodes().indexOf("SUPER_ADMIN") >= 0; }
  function requireSession() {
    if (!tokens || !tokens.token) {
      global.location.replace("login.html?expired=1");
      return false;
    }
    return true;
  }

  global.WebApi = {
    get BASE() { return BASE; },
    setBase: function (value) { BASE = value; global.localStorage.setItem(BASE_KEY, value); },
    call: request,
    login: doLogin,
    logout: logout,
    loadSession: loadSession,
    clearSession: clearSession,
    get me() { return me; },
    get perms() { return perms; },
    perm: perm,
    roleCodes: roleCodes,
    isAdmin: isAdmin,
    requireSession: requireSession,
    ApiError: ApiError,
    uuid: uuid
  };
})(window);
