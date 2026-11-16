import jwt from 'jsonwebtoken';
import { secret } from '../api/core.js';
import { cacheDel, hashGetAll, hashSetAll } from '../db/redis.js';
import type { AuthenticatedUserPayload } from './passport.js';

/**
 * 登录态缓存（组员1 · 阶段一「Redis 存登录后的用户信息」）
 *
 * 为什么要有它：
 *   认证阶段 authenticateJwt 每次请求要查 3 张表（api_session + sys_user_role + sys_role_permission），
 *   秒杀场景下 QPS 一高，这三条 SQL 就是数据库的第一道压力。
 *   把「这次登录的用户是谁、有什么角色和权限」缓存进 Redis，命中时 0 次 SQL。
 *
 * 数据源仍然是 MySQL —— Redis 只是缓存，不是真相来源：
 *   - 登录后**首次**带 token 请求时写入缓存（TTL 默认 5 分钟）
 *   - 命中缓存时仍会**重新验签 JWT**，防止伪造/篡改 token 直接读到缓存
 *   - 退出登录立即删 key；改密码/吊销会话最迟在 TTL 后生效
 *
 * key 里直接放 token，是因为 token 本身是不可猜测的签名串；
 * 想更隐蔽可以存 sha256(token)，但那样排障时要多一步计算，这里选可读性。
 */

/** 缓存 TTL（秒），默认 300 秒；可用 AUTH_CACHE_TTL_SECONDS 调整 */
export const AUTH_CACHE_TTL_SECONDS = Number(process.env.AUTH_CACHE_TTL_SECONDS ?? 300);

const cacheKeyOf = (token: string): string => `auth:token:${token}`;

/** 从 Authorization 头里取 token */
export function bearerToken(header: string | undefined): string | null {
  return header?.match(/^Bearer (\S+)$/)?.[1] ?? null;
}

/**
 * 读缓存。返回 null 表示"没有可用的缓存"，调用方应回退到 MySQL。
 * 命中后仍然验签：缓存被伪造/篡改时当作未命中处理，并顺手删掉脏 key。
 */
export async function readCachedUser(token: string): Promise<AuthenticatedUserPayload | null> {
  const data = await hashGetAll(cacheKeyOf(token));
  if (!data || !data.user_id || !data.session_id) return null;

  try {
    jwt.verify(token, secret(), {
      algorithms: ['HS256'],
      issuer: 'travel-agent',
      audience: 'travel-client'
    });
  } catch {
    await cacheDel(cacheKeyOf(token));
    return null;
  }

  try {
    const roles = data.roles ? (JSON.parse(data.roles) as string[]) : [];
    const permissions = data.permissions ? (JSON.parse(data.permissions) as string[]) : [];
    return {
      id: data.user_id,
      phone: data.phone ?? '',
      role: data.role ?? '',
      agency_id: data.agency_id ? Number(data.agency_id) : null,
      roles: Array.isArray(roles) ? roles : [],
      permissions: Array.isArray(permissions) ? permissions : [],
      sessionId: data.session_id
    };
  } catch {
    await cacheDel(cacheKeyOf(token));
    return null;
  }
}

/** 写缓存（登录后首次认证成功时回填） */
export async function writeCachedUser(token: string, user: AuthenticatedUserPayload): Promise<boolean> {
  return hashSetAll(
    cacheKeyOf(token),
    {
      user_id: String(user.id),
      phone: user.phone ?? '',
      role: user.role ?? '',
      agency_id: user.agency_id === null || user.agency_id === undefined ? '' : String(user.agency_id),
      roles: JSON.stringify(user.roles ?? []),
      permissions: JSON.stringify(user.permissions ?? []),
      session_id: user.sessionId
    },
    AUTH_CACHE_TTL_SECONDS
  );
}

/** 退出登录时调用：立即失效，不等 TTL */
export async function dropCachedUser(token: string): Promise<void> {
  await cacheDel(cacheKeyOf(token));
}
