import { canAccessPath, hasAnyPermissionCode, hasPermissionCode } from './permissions';
import {
  deriveVisibleTabs,
  deriveAllowedScreens,
  hasConsoleAccess,
  isScreenAllowed,
  PUBLIC_TAB_KEYS,
  ALL_TAB_KEYS
} from './menuTabs';
import { computeNodeCheckState, collectSubtreeIds } from './permissionTree';
import { newIdempotencyKey } from './idempotency';
import type { AuthPermissions, MenuNode } from './session';
import type { PermissionTreeNode } from './permissionTree';

const permissions: AuthPermissions = {
  menus: [{ permission_id: '20', parent_id: null, name: '线路', code: 'route:line', path: '/routes/lines', icon: null, sort: 1, children: [] }],
  buttons: [{ permission_id: '201', name: '发布线路', code: 'route:line:add', resource_type: 'BUTTON' }]
};

/** 构造菜单节点，字段与 /v1/users/me/permissions 的返回一致 */
const menu = (over: Partial<MenuNode>): MenuNode => ({
  permission_id: '1', parent_id: null, name: '菜单', code: 'menu',
  path: null, icon: null, sort: 1, children: [], ...over
});

const button = (code: string): AuthPermissions['buttons'][number] => ({
  permission_id: code, name: code, code, resource_type: 'BUTTON'
});

const emptyPerms: AuthPermissions = { menus: [], buttons: [] };

/**
 * database/08_rbac_complete.sql 执行后，TOURIST 的 /users/me/permissions 真实形态：
 * 6 个 C 端 BUTTON，后端 visiblePermissionIds() 会把 /chat、/orders、/itineraries
 * 这些祖先菜单一并补进 menus —— 这是上一版「按菜单路径判中台」误判的根源。
 */
const touristPerms: AuthPermissions = {
  menus: [
    menu({ permission_id: '50', code: 'chat', name: '智能体对话', path: '/chat', children: [
      menu({ permission_id: '51', parent_id: '50', code: 'chat:session', name: '会话管理', path: '/chat/sessions' })
    ] }),
    menu({ permission_id: '30', code: 'order', name: '订单管理', path: '/orders', children: [
      menu({ permission_id: '32', parent_id: '30', code: 'order:booking', name: '预订管理', path: '/orders/booking' })
    ] }),
    menu({ permission_id: '40', code: 'itinerary', name: '行程管理', path: '/itineraries', children: [
      menu({ permission_id: '41', parent_id: '40', code: 'itinerary:plan', name: '行程方案', path: '/itineraries/plans' })
    ] })
  ],
  buttons: [
    'chat:session:query', 'chat:message:query', 'chat:message:add',
    'itinerary:plan:add', 'order:booking:add', 'order:booking:query'
  ].map(button)
};

/** 旅行社管理员：05 脚本的 route + order 两棵子树，按钮是管理类码 */
const agencyPerms: AuthPermissions = {
  menus: [
    menu({ permission_id: '20', code: 'route', name: '线路管理', path: '/routes', children: [
      menu({ permission_id: '21', parent_id: '20', code: 'route:line', name: '线路列表', path: '/routes/lines' })
    ] }),
    menu({ permission_id: '30', code: 'order', name: '订单管理', path: '/orders', children: [
      menu({ permission_id: '31', parent_id: '30', code: 'order:manage', name: '订单列表', path: '/orders/manage' })
    ] })
  ],
  buttons: [
    'route:line:add', 'route:line:update', 'route:line:delete', 'route:line:query', 'route:line:export',
    'order:manage:query', 'order:manage:update', 'order:manage:export'
  ].map(button)
};

/** 验收点：取消 AGENCY_ADMIN 的 route:line:add */
const agencyWithoutAdd: AuthPermissions = {
  ...agencyPerms,
  buttons: agencyPerms.buttons.filter((item) => item.code !== 'route:line:add')
};

/** 超级管理员：system 菜单 + 全部按钮 */
const superPerms: AuthPermissions = {
  menus: [menu({ permission_id: '10', code: 'system', name: '系统管理', path: '/admin', children: [
    menu({ permission_id: '11', parent_id: '10', code: 'system:role', name: '角色管理', path: '/admin/roles' })
  ] })],
  buttons: ['system:role:query', 'route:line:add', 'order:manage:query'].map(button)
};

/** 未来若后端下发显式前台 Tab 菜单 → 严格模式 */
const frontPerms: AuthPermissions = {
  menus: [
    menu({ permission_id: '60', code: 'app:plan', name: '计划', path: '/app/plan' }),
    menu({ permission_id: '61', code: 'app:explore', name: '探索', path: '/app/explore' })
  ],
  buttons: []
};

/** 权限树样例：根 → 子菜单 → 两个按钮 */
const treeRoot: PermissionTreeNode = {
  permission_id: '10', name: '系统管理', code: 'system', resource_type: 'MENU',
  children: [{
    permission_id: '11', name: '角色管理', code: 'system:role', resource_type: 'MENU',
    children: [
      { permission_id: '101', name: '新增角色', code: 'system:role:add', resource_type: 'BUTTON' },
      { permission_id: '102', name: '编辑角色', code: 'system:role:update', resource_type: 'BUTTON' }
    ]
  }]
};
const treeLeaf = treeRoot.children![0].children![0];

const keys = (perms: AuthPermissions | null, loggedIn: boolean) =>
  deriveVisibleTabs(perms, loggedIn).map((tab) => tab.key).join(',');

/** 无测试框架依赖：直接跑断言，失败即抛错。由联调脚本或浏览器控制台调用。 */
export const runPermissionUnitTests = () => {
  const checks: Array<[string, boolean]> = [
    // 组员4 原有判定
    ['hasPermissionCode 命中', hasPermissionCode(permissions, 'route:line:add')],
    ['hasPermissionCode 未命中', !hasPermissionCode(permissions, 'route:line:delete')],
    ['hasAnyPermissionCode 或关系', hasAnyPermissionCode(permissions, ['route:line:delete', 'route:line:add'])],
    ['canAccessPath 命中', canAccessPath(permissions, '/routes/lines')],
    ['canAccessPath 拒绝 /admin', !canAccessPath(permissions, '/admin')],

    // 阶段4 验收：游客 2 个 Tab（未登录 + 已登录 TOURIST 都要成立）
    ['游客 Tab 常量 = 2', PUBLIC_TAB_KEYS.length === 2 && ALL_TAB_KEYS.length === 5],
    ['未登录游客 2 个 Tab', keys(null, false) === 'plan,profile' && deriveVisibleTabs(null, false).length === 2],
    ['TOURIST 登录后仍 2 个 Tab', keys(touristPerms, true) === 'plan,profile'],
    ['空权限登录后按游客视角', keys(emptyPerms, true) === 'plan,profile'],
    ['超管看到全部 5 个 Tab', keys(superPerms, true) === 'plan,itinerary,agent,explore,profile'],
    ['社管看到全部 5 个 Tab', keys(agencyPerms, true) === 'plan,itinerary,agent,explore,profile'],
    ['Tab 展示元数据完整', deriveVisibleTabs(superPerms, true).every((tab) => Boolean(tab.label && tab.icon))],

    // 回归：08 脚本补祖先菜单后，游客不得被误判成管理员
    ['游客无中台入口（关键回归）', !hasConsoleAccess(touristPerms)],
    ['游客不能进 admin 屏', !isScreenAllowed(touristPerms, true, 'admin')],
    ['空权限无中台入口', !hasConsoleAccess(emptyPerms) && !hasConsoleAccess(null)],
    ['社管有中台入口', hasConsoleAccess(agencyPerms)],
    ['超管有中台入口', hasConsoleAccess(superPerms)],
    ['超管可以进 admin 屏', isScreenAllowed(superPerms, true, 'admin')],
    ['前台菜单权限不放大成中台入口', !hasConsoleAccess(frontPerms)],

    // 验收点：取消 route:line:add 后按钮级失效，但中台入口仍在（还有 query）
    ['摘掉 route:line:add 后按钮码失效', !hasPermissionCode(agencyWithoutAdd, 'route:line:add')],
    ['摘掉 route:line:add 后中台入口仍在', hasConsoleAccess(agencyWithoutAdd)],

    // 下钻页：Tab 可见性 ≠ 页面可达性，游客点「创建计划」要能进智能体页
    ['游客可下钻智能体页', isScreenAllowed(touristPerms, true, 'agent')],
    ['游客可下钻行程页', isScreenAllowed(touristPerms, true, 'itinerary')],
    ['游客可达屏不含 admin', !deriveAllowedScreens(touristPerms, true).includes('admin')],
    ['超管可达屏含 admin', deriveAllowedScreens(superPerms, true).includes('admin')],
    ['严格前台菜单模式', keys(frontPerms, true) === 'plan,explore,profile'],

    // 分工文档 4.2：权限树父子联动与半选
    ['子树 id 收集完整', collectSubtreeIds(treeRoot).join(',') === '10,11,101,102'],
    ['父节点全勾 → 勾选态', JSON.stringify(computeNodeCheckState(treeRoot, new Set(['10', '11', '101', '102']))) === JSON.stringify({ checked: true, indeterminate: false })],
    ['父节点部分勾 → 半选态', computeNodeCheckState(treeRoot, new Set(['101', '11'])).indeterminate === true],
    ['父节点全不勾 → 空态', JSON.stringify(computeNodeCheckState(treeRoot, new Set())) === JSON.stringify({ checked: false, indeterminate: false })],
    ['叶子勾中 → 勾选态', JSON.stringify(computeNodeCheckState(treeLeaf, new Set(['101']))) === JSON.stringify({ checked: true, indeterminate: false })],

    // 分工文档 4.2：每次保存换新幂等键（长度 8–128）
    ['两次幂等键不同', newIdempotencyKey() !== newIdempotencyKey()],
    ['幂等键长度合规', (() => { const k = newIdempotencyKey(); return k.length >= 8 && k.length <= 128; })()]
  ];

  const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length > 0) throw new Error(`权限单元测试失败：${failed.join('、')}`);
  return checks.length;
};
