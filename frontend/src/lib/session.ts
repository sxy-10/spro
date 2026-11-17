/**
 * 组员4（阶段三·前端状态流与网络层）
 * 会话仓库薄壳：运行时实现已迁移至 shared-auth/src/session.js（跨端共享）。
 *
 * 本文件保留 C 端 TS 类型定义（AuthUser / MenuNode / AuthPermissions / SessionSnapshot），
 * 供 hooks/useAuth 等组件使用；函数全部 re-export 自共享包——
 * 会话快照、订阅、持久化（persist='refresh' 时仅 refresh_token 存 sessionStorage）逻辑
 * 与 Web 管理端共用同一份实现，不再有两份漂移副本。
 *
 * 设计要点不变：
 * 1. 不引入 Redux/Vuex：共享包内置 ~100 行订阅式仓库，零依赖；
 * 2. 快照对象每次变更都换引用，React 才能正确重渲染；
 * 3. 令牌默认只放内存（XSS 拿不到 localStorage），可选 sessionStorage 只存 refresh_token；
 * 4. 401 时由网络层调 clearSession({expired:true})，UI 通过订阅自动回到登录页。
 */
import type { ConfigureAuthOptions, SessionSnapshot as SharedSessionSnapshot } from '../../../shared-auth/index.js';

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

export interface SessionSnapshot extends Omit<SharedSessionSnapshot, 'user' | 'permissions'> {
  user: AuthUser | null;
  permissions: AuthPermissions | null;
}

/** 共享包配置项类型转发（供需要时引用） */
export type { ConfigureAuthOptions, SharedSessionSnapshot };

export {
  getSession,
  subscribeSession,
  getAccessToken,
  getRefreshToken,
  getUserId,
  isLoggedIn,
  startSession,
  updateTokens,
  setUser,
  setPermissions,
  clearSession
} from '../../../shared-auth/index.js';
