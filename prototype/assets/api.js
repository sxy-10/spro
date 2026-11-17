/* ============================================================
 * 旅游规划智能体 · Web 管理端 API 加载器（shared-auth 接入层）
 *
 * 鉴权实现已迁移至项目根目录 shared-auth/ 共享包（与 C 端 frontend/src 共用同一份：
 * 包络剥壳 / Bearer / Idempotency-Key / HMAC 防重放签名 / 401 单飞刷新重放 / RBAC）。
 * 本文件只是经典脚本加载器：动态 import 共享包的浏览器入口 web.js，
 * 就绪后挂载 window.SharedAuth（完整 API）与 window.WebApi（旧版兼容层）。
 *
 * 页面接入方式（关键）：由于动态 import 是异步的，页面初始化代码必须包在
 *   onWebApi(function () { ...原页面脚本... });
 * 里执行；assets/ui.js / nav.js 只在回调期访问 WebApi，无需改动。
 * ============================================================ */
(function (global) {
  "use strict";

  var ready = import("/shared-auth/web.js").then(function (mod) {
    global.SharedAuth = mod.SharedAuth;
    global.WebApi = mod.WebApi;
    return global.WebApi;
  }).catch(function (err) {
    console.error("[api] shared-auth 加载失败，请确认后端与原型服务器已启动", err);
    global.document.body.insertAdjacentHTML("afterbegin",
      '<div style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#f4f7f5">' +
      '<div style="background:#fff;border:1px solid #dbe5dd;border-radius:12px;padding:28px 34px;max-width:420px;text-align:center">' +
      '<div style="font-size:34px">🔌</div><h2 style="font-size:17px;color:#1f3a28;margin:10px 0">共享鉴权包加载失败</h2>' +
      '<p style="font-size:13px;color:#5d7263;line-height:1.8">无法加载 /shared-auth/web.js。<br>请确认使用 prototype/server.cjs 启动（它会同时托管共享包）。</p></div></div>');
    throw err;
  });

  /** 页面等待共享鉴权包就绪后执行初始化 */
  global.onWebApi = function (callback) {
    ready.then(function () { callback(global.WebApi, global.SharedAuth); }).catch(function () { /* 已提示 */ });
  };
})(window);
