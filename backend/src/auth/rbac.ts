import { Request, Response, NextFunction, RequestHandler } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { ApiError } from '../api/core.js';
import {
  PolicyRequest,
  describeRequest,
  matchPermission,
  matchPolicyRequest,
  normalizeCode,
  toPolicyRequest
} from './permissionCode.js';
import { DecisionMode, evaluateRequests } from './casbin.js';

/**
 * RBAC 授权层（Authorization）—— 组员2 交付
 *
 * 分工：
 *   组员1 的 authenticateJwt 负责「你是谁」：验签 + 校验 api_session，把身份与权限集合挂到 req.user；
 *   本模块负责「你能做什么」：把路由声明的 (module, action) 交给 Casbin 判定，未授权统一 403。
 *
 * 使用方式（推荐写法）：
 *   router.post('/admin/routes', requireAction('route:line', 'add'), handler)
 *   router.get('/admin/routes',  requireAction('route:line', 'query'), handler)
 * 兼容写法（既有代码无需改动）：
 *   requirePermission('route:line:add')   ← 内部按同一口径折算成 (route:line, add)
 *
 * 契约：
 *   未登录 / 会话失效 → 401 + 业务码 20012（由 authenticateJwt 抛出）
 *   已登录但无权限   → 403 + 业务码 20013「权限不足，禁止访问」
 */

/** 未登录/凭证失效的业务码（契约：401 → 20012） */
export const AUTH_REQUIRED_CODE = 20012;
/** 已登录但无权限的业务码（契约：403 → 20013） */
export const PERMISSION_DENIED_CODE = 20013;
/** 越权统一文案，组员6 的用例按此断言 */
export const PERMISSION_DENIED_MESSAGE = '权限不足，禁止访问';

/** 兼容导出：既有调用方从 rbac.js 引 matchPermission，实现已收敛到 permissionCode.ts */
export { matchPermission };

/** 取当前请求已授予的权限快照；未认证时返回空数组 */
export function grantedPermissions(req: Request): string[] {
  return req.user?.permissions ?? [];
}

/** 是否持有全部所需权限（同步版，只看 req.user 快照；用于菜单渲染、业务内联判断） */
export function hasPermission(req: Request, ...required: (string | string[])[]): boolean {
  const needed = required.flat();
  if (needed.length === 0) return false;
  const owned = grantedPermissions(req);
  return needed.every((code) => owned.some((own) => matchPermission(code, own)));
}

/** 是否持有任意一个所需权限（同步版） */
export function hasAnyPermission(req: Request, ...required: (string | string[])[]): boolean {
  const needed = required.flat();
  if (needed.length === 0) return false;
  const owned = grantedPermissions(req);
  return needed.some((code) => owned.some((own) => matchPermission(code, own)));
}

/** 业务代码内联判断用（例：只能看自己的订单，管理员可看全部） */
export const can = hasPermission;

/** 单条权限码是否被授予（含通配），供菜单树过滤等只读场景使用 */
export function isCodeGranted(code: string, granted: string[]): boolean {
  const request = toPolicyRequest(code);
  return granted.some((own) => matchPolicyRequest(request.obj, request.act, own));
}

/**
 * 从数据库实时加载权限码（逃生通道）。
 * 仅用于没有经过 authenticateJwt 的场景（后台任务、脚本），
 * 或需要在单次请求内绕过缓存拿最新授权时。正常 HTTP 链路请直接用 req.user.permissions。
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

/**
 * 守卫内核：把 N 条 (obj, act) 请求交给 Casbin 判定。
 * 所有守卫最终收敛到这里，保证「判定入口唯一」——不会出现某个接口漏查权限。
 */
function createGuard(requests: PolicyRequest[], mode: DecisionMode, name: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. 未认证：立即 401，不进引擎（省一次策略判定）
    const user = req.user;
    if (!user) {
      next(new ApiError(401, AUTH_REQUIRED_CODE, '请先登录'));
      return;
    }

    // 2. 交给 Casbin（引擎内部失败会自动降级到权限快照，不会抛到 Express 层）
    evaluateRequests(user, requests, mode).then((decision) => {
      if (decision.allowed) {
        next();
        return;
      }
      // 3. 403：只记服务端日志（含缺失权限码与判定引擎），不回传给前端，避免泄露权限模型
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'rbac.denied',
        guard: name,
        trace_id: (res.locals as any)?.traceId,
        user_id: user.id,
        roles: user.roles,
        required: requests.map(describeRequest),
        missing: decision.missing,
        engine: decision.engine,
        path: req.originalUrl
      }));
      next(new ApiError(403, PERMISSION_DENIED_CODE, PERMISSION_DENIED_MESSAGE));
    }).catch(next);
  };
}

/**
 * 核心守卫：声明「需要哪个模块（模块:资源）的哪个操作」。
 *
 * 例：
 *   requireAction('route:line', 'add')      → 发布线路
 *   requireAction('order:manage', 'update') → 处理订单
 *   requireAction('system:role', 'query')   → 查看角色列表
 *
 * 权限码与 database/05_rbac_schema.sql 的种子数据一一对应（模块:资源 + 操作）。
 * 注意：action 不是自由字符串，必须是 sys_permission 里真实存在的操作码，
 *      否则该接口永远 403 —— 这是刻意的 fail-closed，防止写错码后静默放行。
 */
export function requireAction(module: string, action: string): RequestHandler {
  if (!module || !action) throw new Error('requireAction(module, action) 两个参数都是必填');
  return createGuard([toPolicyRequest(module, action)], 'all', 'requireAction');
}

/** 满足其中任意一组 (module, action) 即可放行（例：编辑或删除都能进同一个接口） */
export function requireAnyAction(...pairs: [string, string][]): RequestHandler {
  if (pairs.length === 0) throw new Error('requireAnyAction 至少需要一组 (module, action)');
  return createGuard(pairs.map(([module, action]) => toPolicyRequest(module, action)), 'any', 'requireAnyAction');
}

/**
 * 兼容写法：直接声明权限码，必须全部持有。
 * 用法：router.post('/admin/routes', requirePermission('route:line:add'), handler)
 * 也可一次要求多个：requirePermission('system:role:query', 'system:role:export')
 */
export function requirePermission(...required: (string | string[])[]): RequestHandler {
  const needed = required.flat().filter(Boolean);
  if (needed.length === 0) throw new Error('requirePermission 至少需要一个权限码');
  return createGuard(needed.map((code) => toPolicyRequest(code)), 'all', 'requirePermission');
}

/** 兼容写法：持有任意一个权限码即可放行 */
export function requireAnyPermission(...required: (string | string[])[]): RequestHandler {
  const needed = required.flat().filter(Boolean);
  if (needed.length === 0) throw new Error('requireAnyPermission 至少需要一个权限码');
  return createGuard(needed.map((code) => toPolicyRequest(code)), 'any', 'requireAnyPermission');
}

/**
 * 守卫：必须持有指定角色之一，否则 403。
 * 仅在「整块业务归属某类主体」时使用（如只有 B 端可进商家后台）；
 * 能落成具体权限码的场景，优先用 requireAction，别退化成角色判断。
 */
export function requireRole(...roles: string[]): RequestHandler {
  const needed = roles.map(normalizeCode).filter(Boolean);
  if (needed.length === 0) throw new Error('requireRole 至少需要一个角色编码');
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) throw new ApiError(401, AUTH_REQUIRED_CODE, '请先登录');
      const owned = (req.user.roles ?? []).map(normalizeCode);
      if (!owned.some((role) => needed.includes(role))) {
        console.warn(JSON.stringify({
          level: 'warn', event: 'rbac.denied', guard: 'requireRole',
          trace_id: (res.locals as any)?.traceId, user_id: req.user.id,
          roles: req.user.roles, required_roles: needed, path: req.originalUrl
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

export default requireAction;
