/**
 * 权限码 ⇄ Casbin 请求三元组 (obj, act) 的唯一转换口径（组员2 · 阶段二）
 *
 * 为什么单独抽一层：
 *   1. 授权判定在两条链路上运行——Casbin 策略（数据库）与登录时聚合的权限快照（req.user.permissions）；
 *      两边的换算口径必须完全一致，否则同一份数据会得出两种结论。抽出来只写一次，天然不会漂移。
 *   2. 本文件是纯函数、零依赖、不碰 IO，可以被单元测试直接覆盖。
 *
 * 权限码形态（与 database/05_rbac_schema.sql 一致）：
 *   单段 `system`            → 顶层模块菜单    → obj=system,          act=view
 *   两段 `system:role`       → 资源级菜单      → obj=system:role,     act=view
 *   三段 `system:role:add`   → 按钮级操作      → obj=system:role,     act=add
 *   通配 `route:*`           → 整个模块放行     → obj=route,  act=*   （另附 obj=route:* 兼顾子资源）
 *        `route:line:*`      → 单个资源全操作   → obj=route:line, act=*
 *
 * 「菜单级权限记为 view」的约定：菜单只代表“能看见/能进入”，不放行任何写操作。
 * 因此持有 system:role 不等于持有 system:role:query，判定上仍会被拒——这是刻意的收紧。
 */

/** 菜单级权限码统一折算成这个操作，避免把 MENU 授权悄悄放大成写权限 */
export const MENU_ACTION = 'view';

/** 通配符：只允许出现在「已授予」一侧（数据库策略或快照），路由声明的权限码必须是精确码 */
export const WILDCARD = '*';

/** 送给 Casbin enforce() 的一次请求 */
export interface PolicyRequest {
  /** Casbin 的 obj：模块:资源，如 system:role */
  obj: string;
  /** Casbin 的 act：操作，如 add */
  act: string;
  /** 原始权限码，仅用于日志与错误展示，不参与判定 */
  code?: string;
}

/** 统一小写去空格：数据库存小写、前端可能传大写，判定不应受大小写影响 */
export function normalizeCode(code: string): string {
  return String(code ?? '').trim().toLowerCase();
}

/**
 * 权限码 → Casbin 策略规则（1~2 条）。
 * 通配码会拆成两条，是因为 Casbin 的 keyMatch 是「前缀通配」语义：
 *   obj=route   只能匹配 route 本身；obj=route:* 才能匹配 route:line 这类子资源。
 * 两条都下发，模块级通配才算真正覆盖整棵子树。
 */
export function toPolicyRules(code: string): PolicyRequest[] {
  const text = normalizeCode(code);
  if (!text) return [];

  const segments = text.split(':');
  const starIndex = segments.indexOf(WILDCARD);

  if (starIndex === -1) {
    if (segments.length === 1) return [{ obj: segments[0], act: MENU_ACTION, code: text }];
    if (segments.length === 2) return [{ obj: text, act: MENU_ACTION, code: text }];
    return [{
      obj: segments.slice(0, -1).join(':'),
      act: segments[segments.length - 1],
      code: text
    }];
  }

  // 通配码：* 之前的段作为前缀，* 及之后的段一律放行
  const prefix = segments.slice(0, starIndex).join(':');
  const rules: PolicyRequest[] = [];
  if (prefix) rules.push({ obj: prefix, act: WILDCARD, code: text });
  // 只剩一个 * 时就是「全量通配」，obj 保持为 *，不能拼成 :*
  rules.push({ obj: prefix ? `${prefix}:${WILDCARD}` : WILDCARD, act: WILDCARD, code: text });
  return rules;
}

/**
 * 路由侧声明 → 单条 Casbin 请求。
 * 支持两种写法：
 *   requireAction('system:role', 'add')   ← 推荐，语义最直白
 *   requirePermission('system:role:add')  ← 兼容既有路由，内部走同一函数折算
 */
export function toPolicyRequest(code: string, action?: string): PolicyRequest {
  if (action !== undefined && action !== null && String(action).trim() !== '') {
    const obj = normalizeCode(code);
    const act = normalizeCode(action);
    return { obj, act, code: `${obj}:${act}` };
  }
  const [primary] = toPolicyRules(code);
  return primary ?? { obj: normalizeCode(code), act: MENU_ACTION, code: normalizeCode(code) };
}

/**
 * Casbin keyMatch 的等价实现（前缀通配）。
 * 与 casbin 内置 keyMatch 保持同一语义，用于「权限快照」兜底判定，
 * 保证快照路径与策略路径的结论一致。
 */
export function keyMatch(resource: string, pattern: string): boolean {
  const index = pattern.indexOf(WILDCARD);
  if (index === -1) return resource === pattern;
  if (resource.length > index) return resource.slice(0, index) === pattern.slice(0, index);
  return resource === pattern.slice(0, index);
}

/** 用一条「已授予」的权限码判定某个 (obj, act) 是否放行 —— 快照路径的唯一入口 */
export function matchPolicyRequest(obj: string, act: string, grantedCode: string): boolean {
  const rules = toPolicyRules(grantedCode);
  return rules.some((rule) => keyMatch(obj, rule.obj) && (rule.act === act || rule.act === WILDCARD));
}

/** 旧口径的字符串匹配（保留给 rbacRouter 的菜单树过滤等只读场景） */
export function matchPermission(required: string, granted: string): boolean {
  const request = toPolicyRequest(required);
  return matchPolicyRequest(request.obj, request.act, granted);
}

/** 日志里展示的权限码：优先用原始码，避免把 view 这种内部口径暴露给排查者 */
export function describeRequest(request: PolicyRequest): string {
  return request.code ?? (request.act === MENU_ACTION ? request.obj : `${request.obj}:${request.act}`);
}
