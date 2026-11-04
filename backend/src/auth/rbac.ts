import { Request, Response, NextFunction, RequestHandler } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { ApiError } from '../api/core.js';
import type { AuthenticatedUserPayload } from './passport.js';

/**
 * RBAC 授权层（Authorization）—— 组员2 交付
 *
 * 与认证（Authentication）的分工：
 *   组员1 的 authenticateJwt 负责「你是谁」，验签 + 校验会话，把身份与权限集合挂到 req.user；
 *   本模块负责「你能做什么」，只读 req.user.permissions 做判定，不重复查库、不重复验签。
 *
 * 权限码约定（与 05_rbac_schema.sql 种子数据一致）：
 *   MENU   = 模块:资源           例：system:role
 *   BUTTON = 模块:资源:操作      例：system:role:add
 * 支持通配授予：`*`（全部）、`system:*`（整个模块）、`system:role:*`（某资源的全部操作）。
 * 通配只允许出现在「已授予」一侧，路由声明的权限码必须是精确码，避免守卫被写松。
 */

/** 未登录/凭证失效的业务码（契约：401 → 20012） */
export const AUTH_REQUIRED_CODE = 20012;
/** 已登录但无权限的业务码（契约：403 → 20013） */
export const PERMISSION_DENIED_CODE = 20013;
/** 越权统一文案，组员6 的用例按此断言 */
export const PERMISSION_DENIED_MESSAGE = '权限不足，禁止访问';

const normalizeCode = (code: string): string => code.trim().toLowerCase();

/**
 * 单个权限码匹配：required 为路由声明，granted 为用户实际持有。
 * 规则：全等 > 持有 `*` > 持有以 `:*` 结尾的前缀通配。
 */
export function matchPermission(required: string, granted: string): boolean {
  const need = normalizeCode(required);
  const own = normalizeCode(granted);
  if (need === own) return true;
  if (own === '*') return true;
  if (own.endsWith(':*')) {
    const prefix = own.slice(0, -1); // 保留结尾冒号，避免 systemx 命中 system
    return need.startsWith(prefix);
  }
  return false;
}

/** 取当前请求已授予的权限码；未认证时返回空数组 */
export function grantedPermissions(req: Request): string[] {
  return req.user?.permissions ?? [];
}

/**
 * 是否持有全部所需权限。
 * @param required 单个权限码、权限码数组，或可变参数
 */
export function hasPermission(req: Request, ...required: (string | string[])[]): boolean {
  const needed = required.flat();
  if (needed.length === 0) return false;
  const owned = grantedPermissions(req);
  return needed.every((code) => owned.some((own) => matchPermission(code, own)));
}

/** 是否持有任意一个所需权限（用于「编辑或删除均可」这类场景） */
export function hasAnyPermission(req: Request, ...required: (string | string[])[]): boolean {
  const needed = required.flat();
  if (needed.length === 0) return false;
  const owned = grantedPermissions(req);
  return needed.some((code) => owned.some((own) => matchPermission(code, own)));
}

/** 业务代码内联判断用（例：只能看自己的订单，管理员可看全部） */
export const can = hasPermission;

/**
 * 从数据库实时加载权限码（逃生通道）。
 * 仅用于没有经过 authenticateJwt 的场景（例如后台任务、脚本），
 * 或需要在单次请求内绕过缓存拿到最新授权时。正常 HTTP 链路请直接用 req.user.permissions。
 */
export async function loadPermissions(userId: string | number): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT p.code
       FROM sys_user_role ur
       JOIN sys_role_permission rp ON rp.role_id = ur.role_id
       JOIN sys_permission p       ON p.id = rp.permission_id
       JOIN sys_role r             ON r.id = ur.role_id
      WHERE ur.user_id = ?
        AND r.status = 'ENABLED'
        AND p.status = 'ENABLED'`,
    [userId]
  );
  return rows.map((row) => String(row.code));
}

const requireUser = (req: Request): AuthenticatedUserPayload => {
  if (!req.user) throw new ApiError(401, AUTH_REQUIRED_CODE, '请先登录');
  return req.user;
};

/**
 * 守卫：必须持有全部指定权限，否则 403（业务码 20013）。
 *
 * 用法：router.post('/admin/routes', requirePermission('route:line:add'), handler)
 * 也可一次要求多个：requirePermission('system:role:query', 'system:role:export')
 */
export function requirePermission(...required: (string | string[])[]): RequestHandler {
  const needed = required.flat();
  if (needed.length === 0) throw new Error('requirePermission 至少需要一个权限码');
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const user = requireUser(req);
      const owned = user.permissions ?? [];
      const missing = needed.filter((code) => !owned.some((own) => matchPermission(code, own)));
      if (missing.length > 0) {
        // 只记服务端日志，不把内部权限码回传给前端，避免泄露权限模型
        console.warn(JSON.stringify({
          level: 'warn', event: 'rbac.denied', trace_id: res.locals.traceId,
          user_id: user.id, roles: user.roles, missing, path: req.originalUrl
        }));
        next(new ApiError(403, PERMISSION_DENIED_CODE, PERMISSION_DENIED_MESSAGE));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * 守卫：持有任意一个指定权限即可放行，否则 403。
 * 用法：router.put('/roles/:id', requireAnyPermission('system:role:update', 'system:role:add'), handler)
 */
export function requireAnyPermission(...required: (string | string[])[]): RequestHandler {
  const needed = required.flat();
  if (needed.length === 0) throw new Error('requireAnyPermission 至少需要一个权限码');
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const user = requireUser(req);
      if (!hasAnyPermission(req, needed)) {
        console.warn(JSON.stringify({
          level: 'warn', event: 'rbac.denied', trace_id: res.locals.traceId,
          user_id: user.id, roles: user.roles, missing_any: needed, path: req.originalUrl
        }));
        next(new ApiError(403, PERMISSION_DENIED_CODE, PERMISSION_DENIED_MESSAGE));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * 守卫：必须持有指定角色之一，否则 403。
 * 仅在「整块业务归属某类主体」时使用（如只有 B 端可进商家后台）；
 * 能落成具体权限码的场景，优先用 requirePermission，别退化成角色判断。
 */
export function requireRole(...roles: string[]): RequestHandler {
  const needed = roles.map(normalizeCode);
  if (needed.length === 0) throw new Error('requireRole 至少需要一个角色编码');
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const user = requireUser(req);
      const owned = (user.roles ?? []).map(normalizeCode);
      if (!owned.some((role) => needed.includes(role))) {
        next(new ApiError(403, PERMISSION_DENIED_CODE, PERMISSION_DENIED_MESSAGE));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export default requirePermission;
