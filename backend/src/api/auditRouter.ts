import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/connection.js';
import { nodeLogPath } from '../lib/logger.js';
import { requirePermission } from '../auth/rbac.js';
import { ApiError, page, reply, run } from './core.js';

export const auditRouter = Router();
const auditAccess = requirePermission('system:permission:query');

const rangeFilters = {
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
};

function ensureRange(from?: string, to?: string): void {
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new ApiError(400, 10001, '时间范围不合法');
  }
}

async function readSystemLogs(
  pageNumber: number,
  size: number,
  level: string | undefined,
  from: string | undefined,
  to: string | undefined
): Promise<{ list: unknown[]; total: number; has_more: boolean }> {
  let contents: string;
  try {
    contents = await readFile(nodeLogPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { list: [], total: 0, has_more: false };
    }
    throw new ApiError(503, 50001, '系统日志暂不可读');
  }
  const lines = contents.split(/\r?\n/).filter(Boolean).slice(-5000);
  const parsed = lines.flatMap((line) => {
    try { return [JSON.parse(line) as Record<string, unknown>]; }
    catch { return []; }
  });
  const filtered = parsed.filter((entry) => {
    const timestamp = Date.parse(String(entry.time ?? ''));
    const levelNames: Record<number, string> = {
      10: 'trace',
      20: 'debug',
      30: 'info',
      40: 'warn',
      50: 'error',
      60: 'fatal'
    };
    const entryLevel = typeof entry.level === 'number'
      ? levelNames[entry.level]
      : String(entry.level).toLowerCase();
    if (level && entryLevel !== level.toLowerCase()) return false;
    if (from && (!Number.isFinite(timestamp) || timestamp < Date.parse(from))) return false;
    if (to && (!Number.isFinite(timestamp) || timestamp > Date.parse(to))) return false;
    return true;
  }).reverse();
  const offset = (pageNumber - 1) * size;
  return {
    list: filtered.slice(offset, offset + size),
    total: filtered.length,
    has_more: offset + size < filtered.length
  };
}

auditRouter.get('/admin/audit/logs', auditAccess, run(async (req, res) => {
  const query = z.object({
    type: z.enum(['login', 'operation', 'system']),
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
    ...rangeFilters,
    page: z.coerce.number().int().min(1).max(100).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20)
  }).strict().parse(req.query);
  ensureRange(query.from, query.to);
  if (query.level && query.type !== 'system') {
    throw new ApiError(400, 10001, 'level 仅适用于 system 日志');
  }

  if (query.type === 'system') {
    reply(res, await readSystemLogs(query.page, query.size, query.level, query.from, query.to));
    return;
  }

  const table = query.type === 'login' ? 'sys_login_log' : 'sys_operation_log';
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.from) { conditions.push('created_at >= ?'); params.push(query.from); }
  if (query.to) { conditions.push('created_at <= ?'); params.push(query.to); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (query.page - 1) * query.size;
  const [rows] = await pool.query(
    `SELECT * FROM ${table} ${where}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, query.size, offset]
  );
  const [totals] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${table} ${where}`,
    params
  );
  const total = Number((totals as Array<{ total: number }>)[0]?.total ?? 0);
  reply(res, {
    list: rows,
    total,
    has_more: query.page * query.size < total
  });
}));
