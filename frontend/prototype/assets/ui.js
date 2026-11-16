/* ============================================================
 * 旅游规划智能体 · Web 端后台通用 UI 组件
 * 依赖：assets/common.css 的既有类（card/filters/table/tag/drawer/toast…）
 * 组件：日期与金额格式化、状态字典标签、表格渲染、分页器、
 *       弹窗（含表单弹窗）、确认框、抽屉、CSV 导出、SVG 折线图、条形图。
 * ============================================================ */
(function (global) {
  "use strict";

  /* ---------------- 格式化 ---------------- */
  function money(value) {
    if (value == null || value === "") return "—";
    var n = Number(value);
    if (isNaN(n)) return String(value);
    return "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function moneyShort(value) {
    var n = Number(value);
    if (isNaN(n)) return String(value);
    return "¥" + n.toLocaleString("zh-CN");
  }
  function date(value) {
    if (!value) return "—";
    return String(value).slice(0, 10);
  }
  function dateTime(value) {
    if (!value) return "—";
    var s = String(value);
    // 后端返回 UTC（Z 结尾或 +00:00），转本地展示
    var d = new Date(s);
    if (isNaN(d.getTime())) return s.replace("T", " ").slice(0, 16);
    var p = function (n) { return ("0" + n).slice(-2); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function plusDays(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    var p = function (x) { return ("0" + x).slice(-2); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 300);
    };
  }
  function query(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== "") parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  /* ---------------- 状态字典 ---------------- */
  var DICTS = {
    ORDER: {
      PENDING: { label: "待支付", cls: "tag-warn" },
      PAID: { label: "待确认", cls: "tag-warn" },
      CONFIRMED: { label: "已确认", cls: "tag-info" },
      COMPLETED: { label: "已完成", cls: "tag-success" },
      CANCELLED: { label: "已取消", cls: "tag-muted" },
      REFUNDED: { label: "已退款", cls: "tag-danger" }
    },
    PRODUCT: {
      DRAFT: { label: "草稿", cls: "tag-muted" },
      ON_SALE: { label: "已上架", cls: "tag-success" },
      OFF_SALE: { label: "已下架", cls: "tag-muted" }
    },
    AUDIT: {
      NONE: { label: "未提交", cls: "tag-muted" },
      PENDING: { label: "待审核", cls: "tag-warn" },
      APPROVED: { label: "已通过", cls: "tag-success" },
      REJECTED: { label: "已驳回", cls: "tag-danger" }
    },
    TEAM: {
      RECRUITING: { label: "待成团", cls: "tag-warn" },
      FULL: { label: "已成团", cls: "tag-info" },
      DEPARTED: { label: "出行中", cls: "tag-info" },
      FINISHED: { label: "已结束", cls: "tag-success" }
    },
    GUIDE: {
      ACTIVE: { label: "在职", cls: "tag-success" },
      DISABLED: { label: "停用", cls: "tag-muted" }
    },
    ACCOUNT: {
      ACTIVE: { label: "正常", cls: "tag-success" },
      DISABLED: { label: "禁用", cls: "tag-muted" }
    },
    SETTLE: {
      PENDING: { label: "待结算", cls: "tag-muted" },
      SETTLED: { label: "已结算", cls: "tag-success" },
      REJECTED: { label: "已驳回", cls: "tag-danger" }
    }
  };
  function tag(dictName, status) {
    var item = (DICTS[dictName] || {})[status] || { label: status || "—", cls: "tag-muted" };
    return '<span class="tag ' + item.cls + '">' + esc(item.label) + "</span>";
  }

  /* ---------------- 表格 / 分页 ---------------- */
  function fillTbody(tbodySel, rows, rowHtml) {
    var tbody = typeof tbodySel === "string" ? document.querySelector(tbodySel) : tbodySel;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:28px 0">暂无数据</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(rowHtml).join("");
  }
  function pagination(containerSel, state) {
    var box = typeof containerSel === "string" ? document.querySelector(containerSel) : containerSel;
    var totalPages = Math.max(1, Math.ceil(state.total / state.size));
    var pages = [];
    var from = Math.max(1, state.page - 2), to = Math.min(totalPages, from + 4);
    for (var i = from; i <= to; i++) pages.push(i);
    box.innerHTML =
      '<span>共 ' + state.total + " 条</span><span class=\"spacer\"></span>" +
      '<button class="page-btn" data-p="' + Math.max(1, state.page - 1) + '" ' + (state.page <= 1 ? "disabled" : "") + ">‹</button>" +
      pages.map(function (n) {
        return '<button class="page-btn' + (n === state.page ? " active" : "") + '" data-p="' + n + '">' + n + "</button>";
      }).join("") +
      '<button class="page-btn" data-p="' + Math.min(totalPages, state.page + 1) + '" ' + (state.page >= totalPages ? "disabled" : "") + ">›</button>";
    box.querySelectorAll(".page-btn[data-p]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = Number(btn.getAttribute("data-p"));
        if (target !== state.page) state.onPage(target);
      });
    });
  }

  /* ---------------- 弹窗 ---------------- */
  function modal(opts) {
    var mask = document.createElement("div");
    mask.className = "drawer-mask";
    mask.style.zIndex = "60";
    var panel = document.createElement("div");
    panel.className = "modal-panel";
    panel.innerHTML =
      '<div class="drawer-head"><div class="title">' + esc(opts.title || "操作") + '</div><button class="close">×</button></div>' +
      '<div class="modal-body"></div>' +
      (opts.footer === false ? "" : '<div class="modal-footer"></div>');
    document.body.appendChild(mask);
    document.body.appendChild(panel);
    var body = panel.querySelector(".modal-body");
    var footer = panel.querySelector(".modal-footer");
    function close() {
      mask.remove(); panel.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    mask.addEventListener("click", close);
    panel.querySelector(".close").addEventListener("click", close);
    if (opts.body) opts.body(body, close);
    if (opts.buttons) {
      (opts.buttons || []).forEach(function (b) {
        var btn = document.createElement("button");
        btn.className = "btn " + (b.style || "btn-outline");
        btn.textContent = b.label;
        btn.addEventListener("click", function () { b.onClick(close, btn); });
        footer.appendChild(btn);
      });
    }
    return { close: close, body: body, footer: footer };
  }

  function confirmDialog(message, onOk, danger) {
    modal({
      title: "操作确认",
      body: function (body) { body.innerHTML = '<p style="margin:4px 0 8px">' + esc(message) + "</p>"; },
      buttons: [
        { label: "取消", style: "btn-outline", onClick: function (close) { close(); } },
        { label: "确定", style: danger ? "btn-danger" : "btn-primary", onClick: function (close, btn) { btn.disabled = true; onOk(close); } }
      ]
    });
  }

  /* 表单弹窗：fields = [{key,label,type:text|textarea|select|date|number|password,options,required,value,placeholder,span}] */
  function formModal(opts) {
    var html = '<div class="form-grid">';
    (opts.fields || []).forEach(function (f) {
      var control;
      if (f.type === "select") {
        control = '<select name="' + f.key + '">' +
          (f.options || []).map(function (o) {
            var v = typeof o === "string" ? o : o.value;
            var l = typeof o === "string" ? o : o.label;
            return '<option value="' + esc(v) + '"' + (String(f.value) === String(v) ? " selected" : "") + ">" + esc(l) + "</option>";
          }).join("") + "</select>";
      } else if (f.type === "textarea") {
        control = '<textarea name="' + f.key + '" rows="' + (f.rows || 3) + '" placeholder="' + esc(f.placeholder || "") + '">' + esc(f.value || "") + "</textarea>";
      } else if (f.type === "checkbox") {
        control = '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="' + f.key + '"' + (f.value ? " checked" : "") + "> " + esc(f.checkboxLabel || "") + "</label>";
      } else {
        control = '<input type="' + (f.type || "text") + '" name="' + f.key + '" value="' + esc(f.value == null ? "" : f.value) + '" placeholder="' + esc(f.placeholder || "") + '">';
      }
      html += '<div class="field"' + (f.span === 2 ? ' style="grid-column:span 2"' : "") + "><label>" + esc(f.label) + (f.required ? ' <b style="color:var(--danger)">*</b>' : "") + "</label>" + control + "</div>";
    });
    html += "</div>";
    var handle = modal({
      title: opts.title,
      body: function (body) {
        body.innerHTML = html;
        if (opts.note) {
          var note = document.createElement("div");
          note.className = "muted";
          note.style.cssText = "font-size:12px;margin-bottom:8px";
          note.textContent = opts.note;
          body.prepend(note);
        }
      },
      buttons: [
        { label: "取消", style: "btn-outline", onClick: function (close) { close(); } },
        {
          label: opts.submitLabel || "保存", style: "btn-primary",
          onClick: function (close, btn) {
            var values = {};
            var missing = [];
            (opts.fields || []).forEach(function (f) {
              var input = handle.body.querySelector('[name="' + f.key + '"]');
              if (!input) return;
              values[f.key] = input.type === "checkbox" ? input.checked : input.value.trim();
              if (f.required && (values[f.key] === "" || values[f.key] == null)) missing.push(f.label);
            });
            if (missing.length) { global.toast("请填写：" + missing.join("、")); return; }
            btn.disabled = true;
            Promise.resolve(opts.onSubmit(values)).then(function () { close(); })
              .catch(function (err) { btn.disabled = false; global.toast(err.message || "提交失败"); });
          }
        }
      ]
    });
    return handle;
  }

  /* ---------------- 抽屉 ---------------- */
  function drawer(titleHtml, bodyHtml, onClose) {
    var mask = document.createElement("div");
    mask.className = "drawer-mask open";
    var aside = document.createElement("aside");
    aside.className = "drawer open";
    aside.innerHTML = '<div class="drawer-head"><div class="title">' + titleHtml + '</div><button class="close">×</button></div>' +
      '<div class="drawer-body">' + bodyHtml + "</div>";
    document.body.appendChild(mask);
    document.body.appendChild(aside);
    function close() {
      mask.remove(); aside.remove();
      if (onClose) onClose();
    }
    mask.addEventListener("click", close);
    aside.querySelector(".close").addEventListener("click", close);
    return { close: close, body: aside.querySelector(".drawer-body") };
  }

  /* ---------------- CSV 导出 ---------------- */
  function downloadCsv(name, columns, rows) {
    var lines = [columns.map(function (c) { return c.label; }).join(",")];
    rows.forEach(function (r) {
      lines.push(columns.map(function (c) {
        var v = typeof c.value === "function" ? c.value(r) : r[c.key];
        var s = String(v == null ? "" : v);
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(","));
    });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + "_" + plusDays(0).replaceAll("-", "") + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- SVG 折线图（原型同款风格） ---------------- */
  function lineChart(el, series, labels) {
    var W = 600, H = 180, pad = 10;
    var max = 1;
    series.forEach(function (s) { s.data.forEach(function (v) { if (v > max) max = v; }); });
    var n = Math.max(...series.map(function (s) { return s.data.length; }), 2);
    function x(i) { return pad + (i * (W - pad * 2)) / (n - 1); }
    function y(v) { return H - 30 - (v / max) * (H - 55); }
    var grid = [150, 100, 50].map(function (yy) {
      return '<line x1="0" y1="' + yy + '" x2="' + W + '" y2="' + yy + '" stroke="#e8eee9"/>';
    }).join("");
    var lines = series.map(function (s) {
      var pts = s.data.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ");
      return '<polyline fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 2.5) + '" points="' + pts + '"/>';
    }).join("");
    var legend = series.map(function (s) {
      return '<span><i style="background:' + s.color + '"></i>' + esc(s.label) + "</span>";
    }).join("");
    el.innerHTML = '<div class="legend">' + legend + "</div>" +
      '<svg class="line-chart" viewBox="0 0 600 180" preserveAspectRatio="none" role="img">' + grid + lines + "</svg>" +
      (labels ? '<div class="muted" style="font-size:11px;display:flex;justify-content:space-between"><span>' + esc(labels[0] || "") + "</span><span>" + esc(labels[labels.length - 1] || "") + "</span></div>" : "");
  }

  /* ---------------- 条形图 ---------------- */
  function bars(el, rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    el.innerHTML = rows.map(function (r) {
      var w = Math.round((r.value / max) * 100);
      return '<div class="bar-row"><span>' + esc(r.label) + '</span><div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div><span class="val">' + esc(r.display != null ? r.display : r.value) + "</span></div>";
    }).join("");
  }

  /* ---------------- 错误处理 ---------------- */
  function toastError(err) {
    var msg = err && err.message ? err.message : "请求失败，请稍后重试";
    global.toast(msg);
    if (global.console && err && err.traceId) console.warn("[traceId]", err.traceId);
  }
  /** 统一包裹页面数据加载：错误写进容器，避免整页空白。
   *  注意：加载中"插入"指示条而非清空容器——容器内的静态骨架（筛选器、表格、表单等）必须保留，
   *  否则 render() 里按 id 取子节点会拿到 null。 */
  function buildLoadingNode(box) {
    var isRowCtx = box.tagName === "TBODY" || box.tagName === "THEAD" || box.tagName === "TFOOT" || box.tagName === "TR";
    if (isRowCtx) {
      var table = box.closest ? box.closest("table") : null;
      var cols = 8;
      if (table) {
        var headRow = table.querySelector("thead tr");
        if (headRow && headRow.cells.length) cols = headRow.cells.length;
        else if (box.rows && box.rows[0] && box.rows[0].cells.length) cols = box.rows[0].cells.length;
      }
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = cols;
      td.className = "muted";
      td.style.textAlign = "center";
      td.textContent = "加载中…";
      tr.appendChild(td);
      return tr;
    }
    var div = document.createElement("div");
    div.className = "muted";
    div.style.cssText = "padding:16px;text-align:center";
    div.textContent = "加载中…";
    return div;
  }
  function removeNode(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }

  function loadInto(containerSel, promiseFactory, render) {
    var box = typeof containerSel === "string" ? document.querySelector(containerSel) : containerSel;
    var loading = buildLoadingNode(box);
    box.insertBefore(loading, box.firstChild);
    return promiseFactory().then(function (data) {
      removeNode(loading);
      render(data);
    })
      .catch(function (err) {
        removeNode(loading);
        box.innerHTML = '<div style="padding:28px;text-align:center">' +
          '<div style="color:var(--danger);margin-bottom:8px">' + esc(err.message || "加载失败") + "</div>" +
          (err.traceId ? '<div class="muted" style="font-size:11px">traceId: ' + esc(err.traceId) + "</div>" : "") +
          (err.stack ? '<div class="muted" style="font-size:11px;margin-top:4px">' + esc(String(err.stack).split("\n").slice(1, 3).join(" | ")) + "</div>" : "") +
          '<div style="margin-top:12px"><button class="btn btn-outline btn-sm" onclick="location.reload()">重试</button></div></div>';
        if (err.status === 401) window.WebApi.requireSession();
      });
  }

  global.UI = {
    money: money, moneyShort: moneyShort, date: date, dateTime: dateTime, plusDays: plusDays,
    esc: esc, debounce: debounce, query: query,
    tag: tag, fillTbody: fillTbody, pagination: pagination,
    modal: modal, confirmDialog: confirmDialog, formModal: formModal,
    drawer: drawer, downloadCsv: downloadCsv, lineChart: lineChart, bars: bars,
    toastError: toastError, loadInto: loadInto, DICTS: DICTS
  };
})(window);
