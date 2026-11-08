/**
 * 组员4（阶段三·前端状态流与网络层）
 * 把会话仓库接进 React：useSyncExternalStore 是 React 18 官方推荐的外部状态订阅方式，
 * 比 useEffect + setState 少一次渲染，也不会出现并发渲染下的撕裂。
 *
 * 组员5 可以直接用：
 *   const { permissions } = useAuth();            // { menus, buttons }
 *   const can = usePermission('route:line', 'add')  // 见下方 hasPermission
 */
import { useSyncExternalStore } from 'react';
import { getSession, subscribeSession } from '../lib/session';
import type { AuthPermissions, AuthUser, SessionSnapshot } from '../lib/session';
import { hasPermissionCode } from '../lib/permissions';

export const useSession = (): SessionSnapshot =>
  useSyncExternalStore(subscribeSession, getSession, getSession);

export interface AuthState extends SessionSnapshot {
  isLoggedIn: boolean;
  user: AuthUser | null;
  permissions: AuthPermissions | null;
}

export const useAuth = (): AuthState => {
  const session = useSession();
  return { ...session, isLoggedIn: Boolean(session.accessToken) };
};

/** 权限码判定：permissions 里带 `route:line:add` 这种「模块:资源:操作」码 */
export const hasPermission = (permissions: AuthPermissions | null, code: string): boolean =>
  hasPermissionCode(permissions, code);

export const usePermission = (code: string): boolean => {
  const { permissions } = useAuth();
  return hasPermission(permissions, code);
};
