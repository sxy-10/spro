import type { AuthPermissions } from './session';

/** 权限码判定集中在这里，页面不直接读取 buttons 数组。 */
/**permissions 当前用户权限对象，可能为 null
 * code 待校验的权限码
 * 返回值--是否拥有该权限（toLowerCase表示大小写不敏感匹配）
 * `hasPermissionCode`：**判断有没有【某一个】权限码**（单个权限）
`hasAnyPermissionCode`：**判断有没有【一堆权限码里任意一个】**（或权限，多选一）**/
export const hasPermissionCode = (permissions: AuthPermissions | null, code: string): boolean =>
  Boolean(permissions?.buttons?.some((button) => button.code.toLowerCase() === code.toLowerCase()));

export const hasAnyPermissionCode = (permissions: AuthPermissions | null, codes: readonly string[]): boolean =>
  codes.some((code) => hasPermissionCode(permissions, code));

/** 动态菜单使用 path；祖先菜单可访问时允许访问其子页面。
 * `canAccessPath`：函数，校验用户是否有权限访问某个路由页面
 */
export const canAccessPath = (permissions: AuthPermissions | null, path: string): boolean => {
  if (!permissions) return false;
  const normalized = path.replace(/\/$/, '') || '/';//路径标准化处理：正则 `\/$` 匹配字符串末尾的斜杠，把末尾斜杠删掉。
  const visit = (nodes: AuthPermissions['menus']): boolean => nodes.some((node) => {
    const nodePath = node.path?.replace(/\/$/, '') || '';
    return (nodePath && (normalized === nodePath || normalized.startsWith(`${nodePath}/`))) || visit(node.children ?? []);
  });
  return visit(permissions.menus);//从最外层根菜单数组开始，启动递归查找。
};

