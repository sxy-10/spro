/**
 * 组员4（阶段三·前端状态流与网络层）
 * 兼容层：老代码一直 `import { request } from '../api'`，这里保持旧签名不变，
 * 内部全部转发到 lib/http（Axios 实例 + 拦截器）与 lib/auth（认证接口）。
 *
 * 新代码建议直接：
 *   import { request } from './lib/http';        // 通用接口
 *   import { loginByAccount } from './lib/auth'; // 认证接口
 */
import { request as httpRequest } from './lib/http';
import { loginWithPassword } from './lib/auth';
import { clearSession as clearSessionState, isLoggedIn as hasSession } from './lib/session';
import type { AuthUser } from './lib/session';

export const request = httpRequest;

/** 是否已登录（内存里有 access token） */
export const isLoggedIn = (): boolean => hasSession();

/** 清空会话；被 401 踢下线时传 { expired: true } */
export const clearSession = clearSessionState;

/** 手机号 + 密码登录（旧的 /v1/auth/login） */
export const login = (mobile: string, password: string): Promise<AuthUser> =>
  loginWithPassword(mobile, password);

/** 注册（只能注册游客 TOURIST） */
export const register = (mobile: string, password: string) =>
  httpRequest<{ user_id: string }>('/auth/register', 'POST', { mobile, password });

/** 退出登录：先撤销服务端会话，再清本地状态 */
export async function logout(): Promise<void> {
  try {
    await httpRequest('/auth/logout', 'POST', {});
  } catch {
    // 令牌已失效也要保证本地清干净
  } finally {
    clearSessionState();
  }
}

export type { AuthUser };
