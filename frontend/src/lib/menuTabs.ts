/**
 * 组员5（阶段4 · 前端权限）
 *
 * 把 GET /v1/users/me/permissions 下发的 menus / buttons 折算成「能看哪些屏」。
 * 纯函数层：不发请求、不读全局状态、不出现任何角色名（禁止 role 硬编码）。
 *
 * ── 拉取阶段 1~3 代码后的口径修正（重要）──────────────────────────────
 * database/08_rbac_complete.sql 给 TOURIST 授了 6 个 C 端 BUTTON：
 *   chat:session:query / chat:message:query / chat:message:add /
 *   itinerary:plan:add / order:booking:add / order:booking:query
 * 后端 rbacRouter.visiblePermissionIds() 会沿 parent_id 补祖先菜单，于是游客的
 * menus 里**也会出现** /chat、/orders、/orders/booking、/itineraries、/itineraries/plans。
 * 因此：
 *   1. 不能用「菜单 path 是不是 /admin / /orders / /itineraries」判断中台入口 ——
 *      那会把游客误判成管理员（上一版就是这么错的，本版已修）；
 *   2. 管理视角只看「管理类按钮权限码」与 system 菜单，C 端业务权限不算；
 *   3. 后端 menus 是后台菜单树，不是 C 端 Tab，只有显式的前台 Tab 菜单才按菜单严格渲染。
 *
 * 验收口径（docs/plan/下一阶段分工与任务清单.md 4.1 / 阶段4 验收）：
 *   - 游客（未登录 或 仅 C 端权限）→ 底部导航 2 个 Tab；
 *   - 超管 / 社管（有管理类权限）→ 底部导航全部 5 个 Tab + 管理中台入口；
 *   - 「上架新路线」按钮由 AdminScreen 的 <AuthPermission code="route:line:add"> 控制，
 *     配合 permissionSync 重拉权限实现「改权限刷新即生效」。
 */
import type { ActiveTabKey } from '../types';
import type { AuthPermissions, MenuNode } from './session';
import { hasAnyPermissionCode } from './permissions';

/** TabBar 只认识这五个前台 Tab；'admin' 是独立全屏，不进底部导航 */
export type FrontTabKey = Exclude<ActiveTabKey, 'admin'>;

export interface TabDescriptor {
  key: FrontTabKey;
  label: string;
  icon: 'home' | 'calendar' | 'sparkles' | 'compass' | 'user';
}

/** 展示元数据（文案、图标、顺序）的唯一真相源，权限只决定「取哪几项」 */
export const TAB_CATALOG: readonly TabDescriptor[] = [
  { key: 'plan', label: '计划', icon: 'home' },
  { key: 'itinerary', label: '行程', icon: 'calendar' },
  { key: 'agent', label: '智能体', icon: 'sparkles' },
  { key: 'explore', label: '探索', icon: 'compass' },
  { key: 'profile', label: '我的', icon: 'user' }
] as const;

/** 游客可见：计划 + 我的（未登录时「我的」渲染登录页） */
export const PUBLIC_TAB_KEYS: readonly FrontTabKey[] = ['plan', 'profile'];

/** 管理视角可见的全部前台 Tab */
export const ALL_TAB_KEYS: readonly FrontTabKey[] = [
  'plan', 'itinerary', 'agent', 'explore', 'profile'
];

/**
 * 下钻页：不出现在底部导航，但由「计划」等业务入口进入（例如点创建计划 → 智能体页）。
 * Tab 可见性 ≠ 页面可达性，否则游客点「创建计划」会被守卫弹回首页，核心闭环走不通。
 */
export const DRILLDOWN_SCREEN_KEYS: readonly FrontTabKey[] = ['agent', 'itinerary', 'explore'];

/**
 * 管理类按钮权限码：命中才说明是 B 端 / 平台方视角。
 * 注意排除 08 脚本给游客的 order:booking:*、itinerary:plan:add、chat:*。
 * 与 usePermission / hasPermissionCode 完全同源（都是精确比对 buttons[].code）。
 */
export const CONSOLE_BUTTON_CODES: readonly string[] = [
  'system:role:query', 'system:role:add', 'system:role:update', 'system:role:delete', 'system:role:export',
  'system:user:query', 'system:user:add', 'system:user:update', 'system:user:delete', 'system:user:export',
  'system:permission:query', 'system:permission:add', 'system:permission:update', 'system:permission:delete',
  'route:line:query', 'route:line:add', 'route:line:update', 'route:line:delete', 'route:line:export',
  'order:manage:query', 'order:manage:update', 'order:manage:export',
  'itinerary:plan:query', 'itinerary:plan:update', 'itinerary:plan:delete', 'itinerary:plan:export'
];

/** 平台方菜单（system 模块 / /admin 路径）本身也代表管理视角，即使按钮被临时摘掉 */
const CONSOLE_MENU_CODES: readonly string[] = ['system', 'system:role', 'system:user', 'system:permission'];
const CONSOLE_MENU_PATHS: readonly string[] = ['/admin', '/admin/roles', '/admin/users', '/admin/permissions'];

/**
 * 显式前台 Tab 菜单别名。只收带命名空间的前缀，刻意不收 'chat' / 'itinerary' / 'order'
 * 这类单段模块码 —— 它们是后台菜单，游客也会被补到，收进来会误触发严格菜单模式。
 * 08 脚本没有前台 Tab 菜单，所以当前走「权限视角」分支；未来若补，只改这张表。
 */
const FRONT_MENU_ALIASES: Record<FrontTabKey, readonly string[]> = {
  plan: ['/app/plan', 'app:plan', 'c:plan', 'tab:plan', 'page:plan'],
  itinerary: ['/app/itinerary', 'app:itinerary', 'c:itinerary', 'tab:itinerary'],
  agent: ['/app/agent', 'app:agent', 'c:agent', 'tab:agent'],
  explore: ['/app/explore', 'app:explore', 'c:explore', 'tab:explore'],
  profile: ['/app/profile', 'app:profile', 'c:profile', 'tab:profile']
};

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\/+$/, '');

/** 把菜单树拍平，父菜单与子菜单同等参与匹配（后端返回的是已过滤的授权子树） */
export const flattenMenus = (menus: readonly MenuNode[]): MenuNode[] => {
  const result: MenuNode[] = [];
  const visit = (nodes: readonly MenuNode[]) => {
    for (const node of nodes) {
      result.push(node);
      if (node.children?.length) visit(node.children);
    }
  };
  visit(menus);
  return result;
};

/** 从 menus 中识别出「明确授权的前台 Tab」；返回空集合表示后端没有下发前台 Tab 菜单 */
const grantedFrontTabs = (permissions: AuthPermissions | null): Set<FrontTabKey> => {
  const granted = new Set<FrontTabKey>();
  if (!permissions) return granted;
  for (const node of flattenMenus(permissions.menus)) {
    const tokens = [node.code, node.path, node.name]
      .filter((token): token is string => Boolean(token))
      .map(normalize);
    for (const key of Object.keys(FRONT_MENU_ALIASES) as FrontTabKey[]) {
      if (FRONT_MENU_ALIASES[key].some((alias) => tokens.includes(alias))) granted.add(key);
    }
  }
  return granted;
};

/**
 * 「管理中台」入口是否可见：只看管理类 buttons 与 system 菜单，绝不读 user.role，
 * 也绝不看 /orders、/itineraries 这类游客也会拿到的祖先菜单路径。
 */
export const hasConsoleAccess = (permissions: AuthPermissions | null): boolean => {
  if (!permissions) return false;
  const fromMenus = flattenMenus(permissions.menus).some((node) =>
    CONSOLE_MENU_CODES.includes(normalize(node.code ?? '')) ||
    CONSOLE_MENU_PATHS.includes(normalize(node.path ?? ''))
  );
  return fromMenus || hasAnyPermissionCode(permissions, CONSOLE_BUTTON_CODES);
};

/**
 * 按 menus/buttons 折算 TabBar 可见项。
 * @param permissions 会话里的 { menus, buttons }（未登录时为 null）
 * @param isLoggedIn  是否持有 access token
 */
export const deriveVisibleTabs = (
  permissions: AuthPermissions | null,
  isLoggedIn: boolean
): TabDescriptor[] => {
  if (!isLoggedIn) return TAB_CATALOG.filter((tab) => PUBLIC_TAB_KEYS.includes(tab.key));

  const granted = grantedFrontTabs(permissions);
  // 后端明确下发了前台 Tab 菜单 → 严格按菜单（「我的」始终保留作登录/退出入口）
  if (granted.size > 0) {
    return TAB_CATALOG.filter((tab) => tab.key === 'profile' || granted.has(tab.key));
  }
  // 否则按权限视角：有管理类权限看全部，纯 C 端权限（含游客）只看 2 个
  const keys: readonly FrontTabKey[] = hasConsoleAccess(permissions) ? ALL_TAB_KEYS : PUBLIC_TAB_KEYS;
  return TAB_CATALOG.filter((tab) => keys.includes(tab.key));
};

/**
 * 可达屏白名单 = 可见 Tab + 下钻页 +（有管理权限时）admin。
 * 交给 MobileShell 做渲染层守卫，App 用它做越权回退。
 */
export const deriveAllowedScreens = (
  permissions: AuthPermissions | null,
  isLoggedIn: boolean
): ActiveTabKey[] => {
  const screens = new Set<string>([
    ...deriveVisibleTabs(permissions, isLoggedIn).map((tab) => tab.key),
    ...DRILLDOWN_SCREEN_KEYS
  ]);
  if (hasConsoleAccess(permissions)) screens.add('admin');
  return [...screens] as ActiveTabKey[];
};

/** 当前屏是否可达（admin 由 hasConsoleAccess 单独把关） */
export const isScreenAllowed = (
  permissions: AuthPermissions | null,
  isLoggedIn: boolean,
  screen: ActiveTabKey
): boolean => deriveAllowedScreens(permissions, isLoggedIn).includes(screen);
