/**
 * 权限码判定薄壳：实现已迁移至 shared-auth/src/rbac.js（跨端共享）。
 * 页面不直接读取 buttons 数组，一律通过这里判定。
 */
export {
  hasPermissionCode,
  hasAnyPermissionCode,
  canAccessPath,
  flattenMenus
} from '../../../shared-auth/index.js';
