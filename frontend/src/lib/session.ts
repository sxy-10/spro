/**
 * 组员4（阶段三·前端状态流与网络层）
 * 会话状态仓库：令牌、当前用户、权限（menus/buttons）的唯一真相来源。
 *
 * 设计要点（面试/答辩会被问的）：
 * 1. 不引入 Redux/Vuex：用一个 ~80 行的订阅 + useSyncExternalStore，足够且零依赖；
 * 2. 快照对象每次变更都换引用，React 才能正确重渲染；
 * 3. 令牌默认只放内存（XSS 拿不到 localStorage），可选 sessionStorage 只存 refresh_token；
 * 4. 401 时由网络层调 clearSession({expired:true})，UI 通过订阅自动回到登录页。
 */
import { AUTH_CONFIG } from './config';

export interface AuthUser {
  user_id: string;
  nickname?: string | null;
  mobile?: string | null;
  avatar_url?: string | null;
  role?: string;
  roles?: string[];
  permissions?: string[];
  default_departure_city?: string | null;
  created_at?: string;
}

/** GET /v1/users/me/permissions 返回的菜单节点（组员5 的动态菜单数据源） */
export interface MenuNode {
  permission_id: string;
  parent_id: string | null;
  name: string;
  code: string;
  path: string | null;
  icon: string | null;
  sort: number;
  children: MenuNode[];
}

/** GET /v1/users/me/permissions 返回的按钮节点（组员5 的 <AuthPermission> 数据源） */
export interface PermissionButton {
  permission_id: string;
  name: string;
  code: string;
  resource_type: string;
}

export interface AuthPermissions {
  menus: MenuNode[];
  buttons: PermissionButton[];
}

export interface SessionSnapshot {
  /** 版本号：每次变更 +1，保证快照引用一定变化 */
  version: number;
  accessToken: string;
  refreshToken: string;
  userId: string;
  user: AuthUser | null;
  permissions: AuthPermissions | null;
  /** true 表示「是被 401 踢下线的」，UI 需要提示「登录已失效」 */
  expired: boolean;
}

const readPersisted = (): { refreshToken: string; userId: string } => {
  if (!AUTH_CONFIG.persistSession || typeof window === 'undefined') return { refreshToken: '', userId: '' };
  try {
    const raw = window.sessionStorage.getItem(AUTH_CONFIG.storageKey);
    if (!raw) return { refreshToken: '', userId: '' };
    const parsed = JSON.parse(raw) as { refreshToken?: string; userId?: string };
    return { refreshToken: parsed.refreshToken ?? '', userId: parsed.userId ?? '' };
  } catch {
    return { refreshToken: '', userId: '' };
  }
};

const persisted = readPersisted();

let snapshot: SessionSnapshot = {
  version: 0,
  accessToken: '',
  refreshToken: persisted.refreshToken,
  userId: persisted.userId,
  user: null,
  permissions: null,
  expired: false
};

const listeners = new Set<() => void>();

const persist = () => {
  if (!AUTH_CONFIG.persistSession || typeof window === 'undefined') return;
  try {
    if (snapshot.refreshToken) {
      window.sessionStorage.setItem(
        AUTH_CONFIG.storageKey,
        JSON.stringify({ refreshToken: snapshot.refreshToken, userId: snapshot.userId })
      );
    } else {
      window.sessionStorage.removeItem(AUTH_CONFIG.storageKey);
    }
  } catch {
    /* 隐私模式下 sessionStorage 不可写，忽略即可 */
  }
};

const commit = (patch: Partial<SessionSnapshot>) => {
  snapshot = { ...snapshot, ...patch, version: snapshot.version + 1 };
  persist();
  for (const listener of listeners) listener();
};

export const getSession = (): SessionSnapshot => snapshot;
export const subscribeSession = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 供 React 之外（axios 拦截器）读取 */
export const getAccessToken = (): string => snapshot.accessToken;
export const getRefreshToken = (): string => snapshot.refreshToken;
export const getUserId = (): string => snapshot.userId;
export const isLoggedIn = (): boolean => Boolean(snapshot.accessToken);

/** 登录成功：一次性写入令牌 + 用户 + 权限 */
export const startSession = (payload: {
  accessToken: string;
  refreshToken?: string;
  userId?: string;
  user?: AuthUser | null;
  permissions?: AuthPermissions | null;
}) => {
  commit({
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken ?? snapshot.refreshToken,
    userId: payload.userId ?? snapshot.userId,
    user: payload.user ?? snapshot.user,
    permissions: payload.permissions ?? snapshot.permissions,
    expired: false
  });
};

/** 静默换票成功：只换令牌，不动用户信息 */
export const updateTokens = (accessToken: string, refreshToken?: string) => {
  commit({ accessToken, refreshToken: refreshToken ?? snapshot.refreshToken, expired: false });
};

export const setUser = (user: AuthUser | null) => commit({ user });
export const setPermissions = (permissions: AuthPermissions | null) => commit({ permissions });

/** 退出登录 / 被踢下线 */
export const clearSession = (options: { expired?: boolean } = {}) => {
  commit({
    accessToken: '',
    refreshToken: '',
    userId: '',
    user: null,
    permissions: null,
    expired: Boolean(options.expired)
  });
};
