import type { AuthPermissions } from './session';

/** 权限码判定集中在这里，页面不直接读取 buttons 数组。 */
export const hasPermissionCode = (permissions: AuthPermissions | null, code: string): boolean =>
  Boolean(permissions?.buttons?.some((button) => button.code.toLowerCase() === code.toLowerCase()));

export const hasAnyPermissionCode = (permissions: AuthPermissions | null, codes: readonly string[]): boolean =>
  codes.some((code) => hasPermissionCode(permissions, code));

/** 动态菜单使用 path；祖先菜单可访问时允许访问其子页面。 */
export const canAccessPath = (permissions: AuthPermissions | null, path: string): boolean => {
  if (!permissions) return false;
  const normalized = path.replace(/\/$/, '') || '/';
  const visit = (nodes: AuthPermissions['menus']): boolean => nodes.some((node) => {
    const nodePath = node.path?.replace(/\/$/, '') || '';
    return (nodePath && (normalized === nodePath || normalized.startsWith(`${nodePath}/`))) || visit(node.children ?? []);
  });
  return visit(permissions.menus);
};

