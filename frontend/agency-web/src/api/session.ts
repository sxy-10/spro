/**
 * 会话状态：access token 只放内存（不落盘），refresh_token 放 sessionStorage。
 * 与 C 端 frontend/src/lib/session.ts 同一套语义，模块级单例 + 订阅。
 *
 * 管理端是后台场景，刷新页面后用 refresh_token 静默续期一次；
 * 续期失败 → 清空会话 → 回登录页（expired 状态会带提示文案）。
 *
 * 快照对象只在状态变化时重建（引用稳定），供 useSyncExternalStore 消费。
 */
import type { TokenPair } from '../types';

const STORAGE_KEY = 'travel-agency.auth';

export interface SessionSnapshot {
  version: number;
  loggedIn: boolean;
  hasAccessToken: boolean;
  expiredNotice?: string;
}

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
}

let state: SessionState = { accessToken: null, refreshToken: null, userId: null };
let version = 0;
let snapshot: SessionSnapshot = { version: 0, loggedIn: false, hasAccessToken: false };
const listeners = new Set<() => void>();

const readStorage = (): { refresh_token?: string; user_id?: string } => {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as { refresh_token?: string; user_id?: string };
  } catch {
    return {};
  }
};

const persist = () => {
  const { refreshToken, userId } = state;
  if (refreshToken) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ refresh_token: refreshToken, user_id: userId }));
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
};

/** 模块加载时先从 sessionStorage 恢复 refresh_token（access token 不持久化） */
(() => {
  const saved = readStorage();
  state.refreshToken = saved.refresh_token ?? null;
  state.userId = saved.user_id ?? null;
})();

function emit() {
  version += 1;
  snapshot = {
    version,
    loggedIn: Boolean(state.accessToken || state.refreshToken),
    hasAccessToken: Boolean(state.accessToken),
    expiredNotice: expiredNotice
  };
  listeners.forEach((fn) => fn());
}

let expiredNotice: string | undefined;

export const getSessionSnapshot = (): SessionSnapshot => snapshot;
export const getAccessToken = (): string | null => state.accessToken;
export const getRefreshToken = (): string | null => state.refreshToken;
export const getUserId = (): string | null => state.userId;

export const setTokens = (tokens: Pick<TokenPair, 'token' | 'refresh_token' | 'user_id'>) => {
  state = { ...state, accessToken: tokens.token, refreshToken: tokens.refresh_token, userId: tokens.user_id };
  expiredNotice = undefined;
  persist();
  emit();
};

export const clearSession = (opts?: { expired?: boolean }) => {
  state = { accessToken: null, refreshToken: null, userId: null };
  expiredNotice = opts?.expired ? '登录状态已失效，请重新登录' : undefined;
  persist();
  emit();
};

export const setExpiredNotice = (text?: string) => {
  expiredNotice = text;
  emit();
};

/** useSyncExternalStore 订阅用 */
export const subscribeSession = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
