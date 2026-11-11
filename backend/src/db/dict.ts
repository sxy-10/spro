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

/** 取一个字典的全部启用项（已按 sort 排序） */
export async function listDict(type: DictType): Promise<DictItem[]> {
  const cacheKey = cacheKeyOf(type);

  const cached = await cacheGetJson<DictItem[]>(cacheKey);
  if (Array.isArray(cached)) return cached;

  const items = await queryDict(type);
  // Redis 不可用时内部返回 false，不抛异常，不影响本次返回
  await cacheSetJson(cacheKey, items, DICT_TTL_SECONDS);
  return items;
}

/** 排障用：删掉缓存后重新读一次 */
export async function refreshDict(type: DictType): Promise<DictItem[]> {
  await cacheDel(cacheKeyOf(type));
  const items = await queryDict(type);
  await cacheSetJson(cacheKeyOf(type), items, DICT_TTL_SECONDS);
  return items;
}
