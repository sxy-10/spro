/* ============================================================
 * 旅游规划智能体 · Web 端后台导航（公共封装 · 业务版）
 * 两端菜单、顶栏、激活态统一由本文件渲染。
 * 页面调用：AdminLayout.mount({ role, active, title, crumb })
 * 升级点（业务逻辑注入阶段）：
 *   - 登录门禁：无会话自动跳 login.html（WebApi.requireSession）
 *   - 菜单权限化：按 /users/me/permissions 的按钮码过滤菜单项，
 *     权限真相源在后端 Casbin，前端隐藏只是体验层
 *   - 顶栏用户区显示当前登录人（/users/me），点击弹出菜单（退出登录）
 *   - 通知铃铛/搜索保留占位提示
 * 依赖：assets/api.js 需在本文件之前加载。
 * ============================================================ */
(function (global) {
  "use strict";

  var MENUS = {
    agency: [
      { group: "经营概览", items: [
        { key: "dashboard", label: "旅行社工作台", href: "agency-dashboard.html", icon: "grid", perm: "order:manage:query" },
        { key: "ai", label: "AI 智能规划", href: "agency-ai-plan.html", icon: "spark", perm: "route:line:add" }
      ]},
      { group: "业务管理", items: [
        { key: "products", label: "旅游产品管理", href: "agency-products.html", icon: "box", perm: "route:line:query" },
        { key: "orders", label: "订单管理", href: "agency-orders.html", icon: "order", perm: "order:manage:query" },
        { key: "customers", label: "客户管理", href: "agency-customers.html", icon: "user", perm: "customer:customer:query" },
        { key: "guides", label: "导游与团队管理", href: "agency-guides.html", icon: "team", perm: "guide:guide:query" }
      ]},
      { group: "其他", items: [
        { key: "finance", label: "财务管理", href: "agency-finance.html", icon: "wallet", perm: "finance:agency:query" },
        { key: "settings", label: "旅行社设置", href: "agency-settings.html", icon: "gear", perm: "agency:member:query" }
      ]}
    ],
    platform: [
      { group: "运营概览", items: [
        { key: "dashboard", label: "平台工作台", href: "platform-dashboard.html", icon: "grid", perm: "order:manage:query" },
        { key: "analytics", label: "数据分析中心", href: "platform-analytics.html", icon: "chart", perm: "order:manage:query" }
      ]},
      { group: "治理与交易", items: [
        { key: "agencies", label: "旅行社管理", href: "platform-agencies.html", icon: "shop", perm: "system:agency:query" },
        { key: "audit", label: "产品审核管理", href: "platform-audit.html", icon: "shield", perm: "route:line:audit" },
        { key: "users", label: "用户管理", href: "platform-users.html", icon: "user", perm: "system:user:query" },
        { key: "orders", label: "订单与交易管理", href: "platform-orders.html", icon: "order", perm: "order:manage:query" },
        { key: "finance", label: "财务与结算", href: "platform-finance.html", icon: "wallet", perm: "finance:platform:query" }
      ]},
      { group: "平台配置", items: [
        { key: "ai-service", label: "AI 智能服务管理", href: "platform-ai-service.html", icon: "spark", perm: "ai:service:query" },
        { key: "system", label: "权限与系统管理", href: "platform-system.html", icon: "gear", perm: "system:role:query" }
      ]}
    ]
  };

  var ICONS = {
    grid: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    spark: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
    box: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
    order: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2h12l2 4v16H4V6z"/><path d="M4 6h16"/><path d="M9 12h6M9 16h6"/></svg>',
    user: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/></svg>',
    team: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 15.6c2.2.3 3.7 1.6 4.5 3.9"/></svg>',
    wallet: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l2-3h11l3 3"/><circle cx="16.5" cy="12" r="1.3"/></svg>',
    gear: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>',
    chart: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    shop: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v11H4z"/><path d="M9 20v-6h6v6"/></svg>',
    shield: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/></svg>'
  };

  function esc(s) { return String(s == null ? "" : s); }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast"; el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  function renderSidebar(role, active, allowed) {
    var groups = MENUS[role] || [];
    var html = '<aside class="sidebar">' +
      '<div class="brand"><div class="brand-logo">旅</div>' +
      '<div><div class="brand-name">' + (role === "platform" ? "平台管理后台" : "旅行社后台") + '</div>' +
      '<div class="brand-sub">旅游规划智能体</div></div></div>' +
      '<nav class="menu">';
    groups.forEach(function (g) {
      var items = g.items.filter(function (it) { return !it.perm || allowed[it.perm]; });
      if (!items.length) return;
      html += '<div class="menu-group-label">' + esc(g.group) + "</div>";
      items.forEach(function (it) {
        var cls = "menu-item" + (it.key === active ? " active" : "");
        html += '<a class="' + cls + '" href="' + it.href + '">' +
          (ICONS[it.icon] || ICONS.grid) +
          '<span class="label">' + esc(it.label) + "</span></a>";
      });
    });
    html += "</nav><div class='sidebar-foot'>旅游规划智能体 · B/Web 端</div></aside>";
    return html;
  }

  function renderTopbar(opts, me) {
    var roleName = "";
    if (me && Array.isArray(me.roles) && me.roles.length) roleName = me.roles[0].name;
    return '<header class="topbar">' +
      '<div class="crumb">' + esc(opts.crumb || "") + ' / <b>' + esc(opts.title) + "</b></div>" +
      '<div class="topbar-right">' +
        '<span class="topbar-icon" data-act="search" title="全局搜索">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
        "</span>" +
        '<span class="topbar-icon" data-act="bell" title="通知"><span class="dot"></span>' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/></svg>' +
        "</span>" +
        '<div class="user-chip" data-act="user">' +
          '<div class="avatar">' + esc(((me && me.nickname) || "管").slice(0, 1)) + "</div>" +
          '<div class="user-meta"><div class="name">' + esc((me && me.nickname) || "管理员") + "</div>" +
          '<div class="role">' + esc(roleName) + "</div></div>" +
        "</div>" +
      "</div></header>";
  }

  function bindTopbarActions(root) {
    root.querySelectorAll("[data-act]").forEach(function (el) {
      el.addEventListener("click", function () {
        var act = el.getAttribute("data-act");
        if (act === "bell") toast("暂无新通知");
        else if (act === "search") toast("全局搜索占位：可从左侧菜单进入对应页面");
        else if (act === "user") showUserMenu(el);
      });
    });
  }

  function showUserMenu(anchor) {
    var old = document.getElementById("user-menu");
    if (old) { old.remove(); return; }
    var menu = document.createElement("div");
    menu.id = "user-menu";
    menu.style.cssText = "position:fixed;background:#fff;border:1px solid var(--border);border-radius:10px;" +
      "box-shadow:0 10px 30px rgba(0,0,0,.12);padding:6px;min-width:150px;z-index:70";
    menu.innerHTML =
      '<div style="padding:8px 12px;font-size:12px;color:var(--text-muted)" class="um-info">—</div>' +
      '<button class="btn btn-outline btn-sm" style="width:100%;justify-content:center;border:none;color:var(--danger)" data-act="logout">退出登录</button>';
    document.body.appendChild(menu);
    var r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + "px";
    menu.style.right = (window.innerWidth - r.right) + "px";
    var api = global.WebApi;
    var me = api && api.me;
    menu.querySelector(".um-info").textContent = (me && (me.nickname + (me.phone ? " · " + String(me.phone).replace(/^(\d{3})\d+(\d{4})$/, "$1****$2") : ""))) || "已登录";
    menu.querySelector('[data-act="logout"]').addEventListener("click", function () {
      api.logout().then(function () {
        global.location.href = "login.html";
      });
    });
    setTimeout(function () {
      document.addEventListener("click", function onDoc(e) {
        if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) {
          menu.remove();
          document.removeEventListener("click", onDoc);
        }
      });
    }, 0);
  }

  function mount(opts) {
    opts = opts || {};
    var api = global.WebApi;
    if (!api || !api.requireSession()) return;

    var role = opts.role === "platform" ? "platform" : "agency";
    var content = document.getElementById("pageContent");

    var wrap = document.createElement("div");
    wrap.className = "layout";
    // 先渲染占位（sidebar 为 fixed 定位，.main 自带 margin-left）
    wrap.innerHTML = '<div class="main"><div class="topbar-placeholder" style="height:var(--topbar-h)"></div></div>';
    document.body.prepend(wrap);

    var allowed = {};
    api.loadSession().then(function () {
      var perms = api.perms;
      (perms.buttons || []).forEach(function (b) { allowed[b.code] = true; });
      // 菜单权限码本身也可能是 MENU 节点：menus 树里的 code 也计入
      function walk(nodes) {
        (nodes || []).forEach(function (n) {
          if (n.code) allowed[n.code] = true;
          walk(n.children);
        });
      }
      walk(perms.menus);
      wrap.innerHTML = renderSidebar(role, opts.active, allowed) +
        '<div class="main">' + renderTopbar(opts, api.me) + "</div>";
      bindTopbarActions(wrap);
      if (content) wrap.querySelector(".main").appendChild(content);
    }).catch(function (err) {
      if (err && err.status === 401) { api.clearSession(); global.location.replace("login.html?expired=1"); return; }
      // 权限/网速异常时不吞掉整个骨架：仍然渲染侧栏与顶栏（可点、可退出），只把错误以 toast 提示
      wrap.innerHTML = renderSidebar(role, opts.active, {}) +
        '<div class="main">' + renderTopbar(opts, api.me) + "</div>";
      bindTopbarActions(wrap);
      if (content) wrap.querySelector(".main").appendChild(content);
      global.toast((err && err.message) || "会话加载失败");
    });
  }

  global.AdminLayout = { mount: mount };
  global.toast = toast;
})(window);
