import type { Request, RequestHandler } from 'express';
import { pool } from '../db/connection.js';
import { logger } from '../lib/logger.js';

const isAuthRoute = (req: Request) => /^\/v1\/auth\//.test(req.originalUrl.split('?')[0]);
const isMutation = (req: Request) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
const isPermissionChange = (req: Request) =>
  /\/(roles|permissions)(\/|$)/i.test(req.path) && isMutation(req);

function maskedIdentifier(req: Request): string | null {
  const identifier = String(req.body?.mobile ?? req.body?.account ?? '').trim();
  if (!identifier) return null;
  if (/^1\d{10}$/.test(identifier)) return `${identifier.slice(0, 3)}****${identifier.slice(-4)}`;
  return `${identifier.slice(0, 2)}***`;
}

function auditContext(req: Request, res: Parameters<RequestHandler>[1]) {
  const user = res.locals.user as { id?: string | number } | undefined;
  return {
    actorId: user?.id ? String(user.id) : null,
    clientIp: (req.socket.remoteAddress ?? '').slice(0, 45),
    userAgent: (req.get('user-agent') ?? '').slice(0, 500),
    traceId: String(res.locals.traceId ?? ''),
    path: req.path.slice(0, 255)
  };
}

function reportWriteFailure(event: string, error: unknown): void {
  logger.error({
    event,
    message: error instanceof Error ? error.message : String(error)
  });
}

export const requestLoggingMiddleware: RequestHandler = (req, res, next) => {
  if (!isAuthRoute(req) && !isMutation(req)) {
    next();
    return;
  }

  res.once('finish', () => {
    const context = auditContext(req, res);
    const result = res.statusCode < 400 ? 'SUCCESS' : 'FAILURE';

    if (isAuthRoute(req)) {
      const loginName = maskedIdentifier(req);
      void pool.query(
        `INSERT INTO sys_login_log
          (user_id, login_name, login_ip, user_agent, result, failure_reason, trace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          context.actorId,
          loginName,
          context.clientIp,
          context.userAgent,
          result,
          result === 'SUCCESS' ? null : `HTTP_${res.statusCode}`,
          context.traceId
        ]
      ).catch((error: unknown) => reportWriteFailure('audit.login_log.write_failed', error));
      logger.info({
        event: 'auth.login',
        result,
        statusCode: res.statusCode,
        loginName,
        traceId: context.traceId
      });
    }

    if (isMutation(req) && !isAuthRoute(req) && !req.originalUrl.startsWith('/internal/')) {
      const action = `${req.method} ${req.path}`.slice(0, 100);
      void pool.query(
        `INSERT INTO sys_operation_log
          (operator_id, action, request_method, request_path, status_code, result, client_ip, ua, trace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          context.actorId,
          action,
          req.method,
          context.path,
          res.statusCode,
          result,
          context.clientIp,
          context.userAgent,
          context.traceId
        ]
      ).catch((error: unknown) => reportWriteFailure('audit.operation_log.write_failed', error));

      if (isPermissionChange(req) && res.statusCode >= 400) {
        void pool.query(
          `INSERT INTO sys_audit_log
            (actor_id, action, resource_type, resource_id, request_method, request_path,
             detail, trace_id, client_ip, ua, result)
           VALUES (?, 'PERMISSION_CHANGE', 'permission', NULL, ?, ?, ?, ?, ?, ?, ?)`,
          [
            context.actorId,
            req.method,
            context.path,
            `HTTP_${res.statusCode}`,
            context.traceId,
            context.clientIp,
            context.userAgent,
            result
          ]
        ).catch((error: unknown) => reportWriteFailure('audit.permission_log.write_failed', error));
      }
    }
  });

  next();
};
