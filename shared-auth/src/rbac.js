/**
 * shared-auth · RBAC 权限判定纯函数层
 *
 * 权限真相源在后端 Casbin（GET /users/me/permissions 下发 menus + buttons），
 * 前端隐藏/拦截只是体验层，不做任何 role 硬编码判断（角色码仅用于两端入口分流）。
 * 数据形状：permissions = { menus: MenuNode[], buttons: {code, name, resource_type}[] }
 */
import { getSession } from './session.js';

/** 判断有没有【某一个】权限码（大小写不敏感精确比对 buttons[].code） */
export const hasPermissionCode = (permissions, code) =>
  Boolean(permissions?.buttons?.some((button) => button.code.toLowerCase() === String(code).toLowerCase()));

/** 判断有没有【一堆权限码里任意一个】（或权限） */
export const hasAnyPermissionCode = (permissions, codes) =>
  codes.some((code) => hasPermissionCode(permissions, code));

/** 把菜单树拍平，父菜单与子菜单同等参与匹配（后端返回的是已过滤的授权子树） */
export const flattenMenus = (menus) => {
  const result = [];
  const visit = (nodes) => {
    for (const node of nodes || []) {
      result.push(node);
      if (node.children?.length) visit(node.children);
    }
  };
  visit(menus);
  return result;
};

/**
 * 动态菜单使用 path；祖先菜单可访问时允许访问其子页面。
 * 路径标准化：去末尾斜杠后做前缀匹配。
 */
export const canAccessPath = (permissions, path) => {
  if (!permissions) return false;
  const normalized = path.replace(/\/$/, '') || '/';
  const visit = (nodes) => nodes.some((node) => {
    const nodePath = node.path?.replace(/\/$/, '') || '';
    return (nodePath && (normalized === nodePath || normalized.startsWith(`${nodePath}/`))) || visit(node.children ?? []);
  });
  return visit(permissions.menus);
};

/* ------------- 当前登录人的角色/权限便捷读取（Web 端用） ------------- */

/** 任意 user 对象 → 角色码数组（兼容 roles 为字符串或 {code} 对象两种形态） */
export const roleCodesOf = (user) => {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.map((r) => (typeof r === 'string' ? r : r?.code)).filter(Boolean);
};

/** 当前会话用户的角色码数组 */
export const currentRoleCodes = () => roleCodesOf(getSession().user);

/** 当前会话是否有某个按钮权限码 */
export const currentPerm = (code) => hasPermissionCode(getSession().permissions, code);

/** 当前会话是否平台超级管理员 */
export const currentIsAdmin = () => currentRoleCodes().indexOf('SUPER_ADMIN') >= 0;
