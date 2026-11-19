/**
 * shared-auth · 会话状态仓库
 *
 * 令牌、当前用户、权限（menus/buttons）的唯一真相来源，订阅式（零依赖）：
 * - 快照对象每次变更都换引用（version + 1），订阅方（React useSyncExternalStore / 页面脚本）可正确感知；
 * - 持久化由 config.persist 决定：
 *     'none'    → 纯内存；
 *     'refresh' → sessionStorage 仅存 {refreshToken, userId}（C 端）；
 *     'full'    → localStorage 存完整令牌 + 用户/权限缓存（Web 管理端跨页面跳转），
 *                 key 沿用 prototype 历史值（web_tokens / web_me / web_perms），老登录态无缝兼容。
 * - 401 被踢下线时网络层调 clearSession({expired:true})，UI 订阅 expired 自动回登录页。
 */
import { getAuthConfig, getStorage } from './config.js';

export const createEmptySnapshot = () => ({
  version: 0,
  accessToken: '',
  refreshToken: '',
  userId: '',
  user: null,
  permissions: null,
  expired: false
});

let snapshot = createEmptySnapshot();
const listeners = new Set();
let hydrated = false;

const persistTokens = () => {
  const cfg = getAuthConfig();
  const storage = getStorage();
  if (!storage) return;
  try {
    if (cfg.persist === 'refresh') {
      // C 端口径：只落 refresh_token（access token 永不落盘）
      if (snapshot.refreshToken) {
        storage.setItem(cfg.storageKey, JSON.stringify({ refreshToken: snapshot.refreshToken, userId: snapshot.userId }));
      } else {
        storage.removeItem(cfg.storageKey);
      }
    } else if (cfg.persist === 'full') {
      // Web 管理端口径：完整令牌（兼容 prototype 旧结构 {token, refresh_token, user_id}）
      if (snapshot.accessToken) {
        storage.setItem(cfg.cacheKeys.tokens, JSON.stringify({
          token: snapshot.accessToken,
          refresh_token: snapshot.refreshToken,
          user_id: snapshot.userId
        }));
      } else {
        storage.removeItem(cfg.cacheKeys.tokens);
        storage.removeItem(cfg.cacheKeys.me);
        storage.removeItem(cfg.cacheKeys.perms);
      }
    }
  } catch {
    /* 隐私模式下 storage 不可写，忽略 */
  }
};

const persistCache = (kind, value) => {
  const cfg = getAuthConfig();
  if (cfg.persist !== 'full') return;
  const storage = getStorage();
  if (!storage) return;
  try {
    if (value == null) storage.removeItem(kind === 'me' ? cfg.cacheKeys.me : cfg.cacheKeys.perms);
    else storage.setItem(kind === 'me' ? cfg.cacheKeys.me : cfg.cacheKeys.perms, JSON.stringify(value));
  } catch {
    /* 忽略写入失败 */
  }
};

/** 从持久层恢复会话（configureAuth 时调用，幂等：只在快照为空时执行一次） */
export function hydrateSession() {
  if (hydrated) return;
  const cfg = getAuthConfig();
  const storage = getStorage();
  if (!storage || cfg.persist === 'none') {
    hydrated = true;
    return;
  }
  const patch = {};
  try {
    if (cfg.persist === 'refresh') {
      const raw = storage.getItem(cfg.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        patch.refreshToken = parsed.refreshToken ?? '';
        patch.userId = parsed.userId ?? '';
      }
    } else if (cfg.persist === 'full') {
      const rawTokens = storage.getItem(cfg.cacheKeys.tokens);
      if (rawTokens) {
        const tokens = JSON.parse(rawTokens);
        patch.accessToken = tokens.token ?? '';
        patch.refreshToken = tokens.refresh_token ?? '';
        patch.userId = tokens.user_id ?? '';
      }
      const rawMe = storage.getItem(cfg.cacheKeys.me);
      if (rawMe) patch.user = JSON.parse(rawMe);
      const rawPerms = storage.getItem(cfg.cacheKeys.perms);
      if (rawPerms) patch.permissions = JSON.parse(rawPerms);
    }
  } catch {
    /* 缓存损坏视为无会话 */
  }
  hydrated = true;
  if (Object.keys(patch).length) commit(patch);
}

const commit = (patch) => {
  snapshot = { ...snapshot, ...patch, version: snapshot.version + 1 };
  if (patch.accessToken !== undefined || patch.refreshToken !== undefined || patch.userId !== undefined) {
    persistTokens();
  }
  for (const listener of listeners) listener();
};

export const getSession = () => snapshot;
export const subscribeSession = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** 供网络层与任意脚本读取 */
export const getAccessToken = () => snapshot.accessToken;
export const getRefreshToken = () => snapshot.refreshToken;
export const getUserId = () => snapshot.userId;
export const isLoggedIn = () => Boolean(snapshot.accessToken);

/** 登录成功：一次性写入令牌 + 用户 + 权限 */
export const startSession = (payload) => {
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
export const updateTokens = (accessToken, refreshToken) => {
  commit({ accessToken, refreshToken: refreshToken ?? snapshot.refreshToken, expired: false });
};

export const setUser = (user) => {
  commit({ user });
  persistCache('me', user);
};

export const setPermissions = (permissions) => {
  commit({ permissions });
  persistCache('perms', permissions);
};

/** 退出登录 / 被踢下线 */
export const clearSession = (options = {}) => {
  commit({
    accessToken: '',
    refreshToken: '',
    userId: '',
    user: null,
    permissions: null,
    expired: Boolean(options.expired)
  });
};
