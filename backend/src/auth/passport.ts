import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt, StrategyOptions } from 'passport-jwt';
import { Request, Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { secret, ApiError } from '../api/core.js';

/**
 * 身份认证策略模块：基于 Passport.js (passport-jwt) 工业级框架实现的无状态凭证校验中间件
 * 
 * 架构特性：
 * 1. 使用 passport-jwt 策略标准提取 Authorization: Bearer <Token>
 * 2. 验签 JWT 并校验 api_session 活性与撤销状态
 * 3. 联动 RBAC 权限数据模型，两跳联合聚合当前受访者的角色集合（Roles）与细粒度权限码树（Permissions）
 * 4. 封装统一的 authenticateJwt 中间件，向后无缝兼容 res.locals.user 与 req.user
 */

export interface AuthenticatedUserPayload {
  id: string | number;
  phone: string;
  role: string;
  agency_id: number | null;
  roles: string[];
  permissions: string[];
  sessionId: string;
}

declare global {
  namespace Express {
    interface User extends AuthenticatedUserPayload {}
  }
}

const jwtStrategyOptions: StrategyOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKeyProvider: (_request: Request, _rawJwtToken: any, done: (err: any, secretOrKey?: string | Buffer) => void) => {
    try {
      done(null, secret());
    } catch (error) {
      done(error);
    }
  },
  algorithms: ['HS256'],
  issuer: 'travel-agent',
  audience: 'travel-client'
};

// 注册 Passport-JWT 策略
passport.use(
  new JwtStrategy(jwtStrategyOptions, async (jwtPayload: any, done) => {
    try {
      const targetUserId = jwtPayload.sub;
      const targetSessionId = jwtPayload.jti;

      if (!targetUserId || !targetSessionId) {
        return done(null, false, { message: '登录凭证载荷缺失' });
      }

      // 1. 校验会话表 api_session 与用户状态
      const [sessionRows] = await pool.query<RowDataPacket[]>(
        `SELECT u.id, u.phone, u.role, u.agency_id, u.status
         FROM api_session s
         JOIN sys_user u ON u.id = s.user_id
         WHERE s.session_id = ? AND s.user_id = ? AND s.is_revoked = 0 
           AND s.expires_at > UTC_TIMESTAMP() AND u.status = 'ACTIVE'`,
        [targetSessionId, targetUserId]
      );

      if (!sessionRows.length) {
        return done(null, false, { message: '登录已失效或会话已注销' });
      }

      const rawUser = sessionRows[0];

      // 2. 动态聚合 RBAC 角色实体（sys_user_role -> sys_role）
      let assignedRoleCodes: string[] = [];
      try {
        const [roleRows] = await pool.query<RowDataPacket[]>(
          `SELECT r.code
           FROM sys_user_role ur
           JOIN sys_role r ON r.id = ur.role_id
           WHERE ur.user_id = ? AND r.status = 'ENABLED'`,
          [rawUser.id]
        );
        assignedRoleCodes = roleRows.map((item) => item.code);
      } catch {
        // 若 RBAC 表尚未全量初始化，优雅兼容 sys_user.role 旧单列
      }

      if (assignedRoleCodes.length === 0 && rawUser.role) {
        assignedRoleCodes = [rawUser.role];
      }

      // 3. 动态聚合 RBAC 细粒度操作权限节点（sys_user_role -> sys_role_permission -> sys_permission）
      let grantedPermissionCodes: string[] = [];
      try {
        const [permRows] = await pool.query<RowDataPacket[]>(
          `SELECT DISTINCT p.code
           FROM sys_user_role ur
           JOIN sys_role_permission rp ON rp.role_id = ur.role_id
           JOIN sys_permission p ON p.id = rp.permission_id
           WHERE ur.user_id = ? AND p.status = 'ENABLED'`,
          [rawUser.id]
        );
        grantedPermissionCodes = permRows.map((item) => item.code);
      } catch {
        // 权限表容错
      }

      const authenticatedUser: AuthenticatedUserPayload = {
        id: String(rawUser.id),
        phone: rawUser.phone,
        role: rawUser.role,
        agency_id: rawUser.agency_id,
        roles: assignedRoleCodes,
        permissions: grantedPermissionCodes,
        sessionId: targetSessionId
      };

      return done(null, authenticatedUser);
    } catch (strategyError) {
      return done(strategyError, false);
    }
  })
);

/**
 * HTTP 鉴权守卫中间件：基于 Passport.js JWT 策略构建的会话拦截器
 * 输出：passport.authenticate('jwt') 并拦截格式化为 401 统一业务异常
 */
export const authenticateJwt = (req: Request, res: Response, next: NextFunction): void => {
  passport.authenticate('jwt', { session: false }, (error: any, user: AuthenticatedUserPayload | false, info: any) => {
    if (error) {
      return next(error);
    }
    if (!user) {
      const failureMessage = info?.message || '请先登录';
      return next(new ApiError(401, 20012, failureMessage));
    }

    // 同时赋给 req.user（Passport 规范）和 res.locals（已有接口兼容）
    req.user = user;
    res.locals.user = user;
    res.locals.sessionId = user.sessionId;
    next();
  })(req, res, next);
};

export default passport;
