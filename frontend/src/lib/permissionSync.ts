/**
 * 组员5（阶段4 · 前端权限）
 *
 * 权限同步：管理员在后台改完角色权限后，用户侧要「刷新即生效」。
 * 会话仓库（lib/session.ts）是唯一真相源，这里只负责重新拉一次
 * GET /v1/users/me/permissions 并写回会话，TabBar / 按钮守卫订阅会话后自动重渲染。
 *
 * 注意：这里只同步权限数据，不碰任何业务数据接口（业务接口留给下一轮统一处理）。
 */
import { loadPermissions } from './auth';
import { getSession, setPermissions } from './session';
import type { AuthPermissions } from './session';

/**
 * 重新拉取并覆盖会话中的 menus / buttons。
 * 失败（网络异常 / 接口 404）时返回 null 且**保留旧权限**，避免一次抖动把管理员界面清空。
 */
export const refreshPermissions = async (): Promise<AuthPermissions | null> => {
  if (!getSession().accessToken) return null;
  const next = await loadPermissions();
  if (!next) return null;
  setPermissions(next);
  return next;
};

/**
 * 页面重新可见 / 窗口重新聚焦时同步一次权限。
 * 返回取消订阅函数，供 useEffect 清理；未登录时不会发任何请求。
 */
export const watchPermissionChanges = (): (() => void) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;

  const sync = () => { void refreshPermissions(); };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') sync();
  };

  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    window.removeEventListener('focus', sync);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
};
