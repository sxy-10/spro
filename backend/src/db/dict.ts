import { createHash } from 'node:crypto';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from './connection.js';
import { cacheDel, cacheGetJson, cacheSetJson } from './redis.js';

/**
 * 基础字典（组员1 · 阶段一「字典进 Redis」）
 *
 * 老师的要求：民族、出发城市、旅行风格这类几乎不变的基础数据不要每次查 MySQL。
 *
 * 读取顺序：Redis → MySQL → 回填 Redis
 *   1. Redis 命中：直接返回，0 次 SQL
 *   2. Redis 未命中 / Redis 不可用：查 MySQL，再尝试回填（回填失败不影响本次返回）
 *
 * 数据表见 database/07_dict.sql。表里改完数据想立刻生效：
 *   redis-cli DEL dict:ethnic
 *   或者调用本文件导出的 invalidateDict('ethnic')（管理接口 / 脚本里用）。
 *
 * 本次修复的两点：
 *   ① 加了「同一类型并发未命中只查一次库」（single-flight）：
 *      缓存过期瞬间如果 200 个请求同时进来，原来会同时打 200 条 SQL（缓存击穿）；
 *      现在只有一个请求去查库，其余等它的结果。
 *   ② 加了主动失效 invalidateDict()：改字典不必再干等 1 小时 TTL。
 */

/** 支持的字典类型（对应 sys_dict.dict_type） */
export const DICT_TYPES = ['ethnic', 'city', 'style', 'food', 'season'] as const;

export type DictType = (typeof DICT_TYPES)[number];

export interface DictItem {
  key: string;
  value: string;
  sort: number;
}

/** 缓存时长默认 1 小时，可用 DICT_CACHE_TTL_SECONDS 调整 */
const DICT_TTL_SECONDS = Number(process.env.DICT_CACHE_TTL_SECONDS ?? 3600);

const cacheKeyOf = (type: DictType): string => `dict:${type}`;

export function isDictType(value: string): value is DictType {
  return (DICT_TYPES as readonly string[]).includes(value);
}

async function queryDict(type: DictType): Promise<DictItem[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT dict_key, dict_value, sort
       FROM sys_dict
      WHERE dict_type = ? AND status = 'ENABLED'
      ORDER BY sort, id`,
    [type]
  );
  return rows.map((row) => ({
    key: String(row.dict_key),
    value: String(row.dict_value),
    sort: Number(row.sort)
  }));
}

/**
 * single-flight：同一字典类型在"未命中"时只允许一个请求回源。
 * 进程内即可，因为击穿保护只需要单实例内去重；多实例退化为"每个实例一次"，完全可接受。
 */
const inflight = new Map<string, Promise<DictItem[]>>();

/** 取一个字典的全部启用项（已按 sort 排序） */
export async function listDict(type: DictType): Promise<DictItem[]> {
  const cacheKey = cacheKeyOf(type);

  const cached = await cacheGetJson<DictItem[]>(cacheKey);
  if (Array.isArray(cached)) return cached;

  const running = inflight.get(type);
  if (running) return running;

  const task = (async () => {
    try {
      const items = await queryDict(type);
      // Redis 不可用时内部返回 false，不抛异常，不影响本次返回
      await cacheSetJson(cacheKey, items, DICT_TTL_SECONDS);
      return items;
    } finally {
      inflight.delete(type);
    }
  })();

  inflight.set(type, task);
  return task;
}

/** 主动失效：改完 sys_dict 后调用，下一次读取会重新回源并回填 */
export async function invalidateDict(type?: DictType): Promise<void> {
  const targets = type ? [cacheKeyOf(type)] : DICT_TYPES.map((item) => cacheKeyOf(item));
  await cacheDel(...targets);
}

/** 排障用：删掉缓存后重新读一次 */
export async function refreshDict(type: DictType): Promise<DictItem[]> {
  await invalidateDict(type);
  const items = await queryDict(type);
  await cacheSetJson(cacheKeyOf(type), items, DICT_TTL_SECONDS);
  return items;
}

/**
 * 字典写操作的统一入口（管理端改字典必须走这里，否则 Redis 里还是旧值）。
 * 目前字典主要由 SQL 脚本维护，所以这里提供最小可用实现：
 * 写入 → 失效缓存，保证下一次读取立刻看到新数据。
 */
export async function upsertDictItem(
  type: DictType,
  item: DictItem,
  status: 'ENABLED' | 'DISABLED' = 'ENABLED'
): Promise<void> {
  await pool.query(
    `INSERT INTO sys_dict (dict_type, dict_key, dict_value, sort, status)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE dict_value = VALUES(dict_value), sort = VALUES(sort), status = VALUES(status)`,
    [type, item.key, item.value, item.sort, status]
  );
  await invalidateDict(type);
}

/** 字典 key 的稳定哈希（给需要"按字典值建缓存"的场景用，避免中文 key 直接进 Redis key 名） */
export const dictKeyHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16);
