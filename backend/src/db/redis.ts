import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';

/**
 * Redis 连接、缓存封装与 Lua 脚本执行（组员1 · 阶段一「Redis 底座」）
 *
 * 三条铁律，后续所有阶段都依赖这里的行为：
 *
 * 1. **连不上不能拖垮服务**
 *    lazyConnect + enableOfflineQueue=false + maxRetriesPerRequest=1，
 *    拿不到连接时所有对外函数返回 null / false，调用方走 MySQL 兜底。
 *    （本文件不抛异常给业务层，只在日志里留痕）
 *
 * 2. **key 必须带前缀**
 *    多人可能共用一个 Redis 实例（宿舍局域网共享 / 一台机器演示），
 *    REDIS_KEY_PREFIX 用来隔离，避免一个人压测把别人的库存扣光。
 *
 * 3. **TTL 一律显式设置**
 *    缓存不设过期就是内存泄漏，也容易读到陈旧的授权数据。
 *
 * 与 auth/security.ts 的关系：那个文件自己建了一个连接专门做「登录失败计数」，
 * 自带 Redis→MySQL→内存 三级降级；本文件另建一个连接做通用缓存与库存预扣，
 * 两者互不干扰。后续可以合并成同一个客户端（记在交接文档里）。
 */

const REDIS_HOST = process.env.REDIS_HOST ?? '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = Number(process.env.REDIS_DB ?? 0);
const CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 1000);

/** 共享实例时用来隔离数据，例如 REDIS_KEY_PREFIX=z3_ */
export const KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? '';

/** 统一拼 key：redisKey('dict:ethnic') → 'z3_dict:ethnic' */
export const redisKey = (name: string): string => `${KEY_PREFIX}${name}`;

const log = (level: 'info' | 'warn', event: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

let client: Redis | null = null;
let ready = false;
let errorLogged = false;

function build(): Redis {
  const instance = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    db: REDIS_DB,
    lazyConnect: true,
    enableOfflineQueue: false, // 断连时命令立即失败，绝不在内存里排队堆积
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // 不自动重连，避免停机时无限刷日志
    connectTimeout: CONNECT_TIMEOUT_MS
  });

  instance.on('ready', () => {
    ready = true;
    errorLogged = false;
    log('info', 'redis.ready', { host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB });
  });

  instance.on('error', (error: Error) => {
    ready = false;
    // 只打印第一次，避免每秒刷屏
    if (!errorLogged) {
      errorLogged = true;
      log('warn', 'redis.unavailable', { message: error.message, host: REDIS_HOST, port: REDIS_PORT });
    }
  });

  instance.on('end', () => {
    ready = false;
  });

  instance.connect().catch((error: Error) => {
    ready = false;
    if (!errorLogged) {
      errorLogged = true;
      log('warn', 'redis.connect_failed', { message: error.message });
    }
  });

  return instance;
}

/** 取客户端；进程退出时不会因为 Redis 连接被挂住 */
export function getRedis(): Redis | null {
  if (process.env.REDIS_DISABLED === '1') return null;
  if (!client) {
    try {
      client = build();
    } catch (error: any) {
      log('warn', 'redis.init_failed', { message: error?.message ?? String(error) });
      client = null;
    }
  }
  return client;
}

/** 连接是否可用（业务分支常用它做快速判断） */
export const isRedisReady = (): boolean => ready;

/* ------------------------------------------------------------------ *
 * 通用缓存（JSON）
 * ------------------------------------------------------------------ */

export async function cacheGetJson<T>(name: string): Promise<T | null> {
  const instance = getRedis();
  if (!instance || !ready) return null;
  try {
    const raw = await instance.get(redisKey(name));
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (error: any) {
    // 脏数据（非 JSON）直接删掉，别让一次写坏导致永久 500
    log('warn', 'redis.cache_get_failed', { key: name, message: error?.message ?? String(error) });
    await cacheDel(name);
    return null;
  }
}

export async function cacheSetJson(name: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const instance = getRedis();
  if (!instance || !ready) return false;
  try {
    const payload = JSON.stringify(value);
    if (ttlSeconds > 0) await instance.set(redisKey(name), payload, 'EX', ttlSeconds);
    else await instance.set(redisKey(name), payload);
    return true;
  } catch (error: any) {
    log('warn', 'redis.cache_set_failed', { key: name, message: error?.message ?? String(error) });
    return false;
  }
}

export async function cacheDel(...names: string[]): Promise<void> {
  const instance = getRedis();
  if (!instance || !ready || names.length === 0) return;
  try {
    await instance.del(...names.map(redisKey));
  } catch {
    // 删除失败不影响主流程：key 自己会按 TTL 过期
  }
}

/* ------------------------------------------------------------------ *
 * Hash（登录态缓存用）
 * ------------------------------------------------------------------ */

export async function hashSetAll(
  name: string,
  fields: Record<string, string>,
  ttlSeconds: number
): Promise<boolean> {
  const instance = getRedis();
  if (!instance || !ready) return false;
  try {
    const key = redisKey(name);
    await instance.hset(key, fields);
    if (ttlSeconds > 0) await instance.expire(key, ttlSeconds);
    return true;
  } catch (error: any) {
    log('warn', 'redis.hash_set_failed', { key: name, message: error?.message ?? String(error) });
    return false;
  }
}

export async function hashGetAll(name: string): Promise<Record<string, string> | null> {
  const instance = getRedis();
  if (!instance || !ready) return null;
  try {
    const raw = await instance.hgetall(redisKey(name));
    if (!raw || Object.keys(raw).length === 0) return null;
    return raw;
  } catch (error: any) {
    log('warn', 'redis.hash_get_failed', { key: name, message: error?.message ?? String(error) });
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Lua 脚本：库存预扣（阶段二「抢购先打 Redis」的地基）
 * ------------------------------------------------------------------ */

/**
 * 脚本文件放在 db/lua/deduct_stock.lua，运行时读入内存只读一次。
 *
 * 为什么用脚本而不是「GET → 判断 → DECR」三步：
 *   多步命令之间会被其他客户端插队，两三个线程同时 GET 到 1 就会卖出 3 份（超卖）。
 *   Lua 在 Redis 服务端一次性执行，执行期间不会插入别的命令，等价于「原子操作」。
 */
const DEDUCT_LUA_CANDIDATES = [
  join(__dirname, 'lua', 'deduct_stock.lua'), // 开发态（tsx 直接跑 src）：src/db/lua/
  join(__dirname, '..', '..', 'src', 'db', 'lua', 'deduct_stock.lua') // 构建后（dist/db/）：回退源码目录
];

let deductSource: string | null = null;

function loadDeductScript(): string {
  if (deductSource) return deductSource;
  let lastError: unknown = null;
  for (const candidate of DEDUCT_LUA_CANDIDATES) {
    try {
      deductSource = readFileSync(candidate, 'utf8');
      return deductSource;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法加载 Lua 脚本 deduct_stock.lua：${(lastError as Error)?.message ?? 'unknown'}`);
}

export interface PreDeductResult {
  /** 是否预扣成功 */
  ok: boolean;
  /** ok=成功；sold_out=库存不足；redis_unavailable=Redis 不可用（调用方应走数据库兜底或直接拒绝） */
  reason: 'ok' | 'sold_out' | 'redis_unavailable';
  /** 预扣后剩余库存（拿不到时为 null） */
  remaining: number | null;
}

/**
 * 原子预扣库存。
 * @param stockKey 逻辑 key，如 stock:12:2026-12-01（会自动加 KEY_PREFIX）
 * @param need     需要扣减的数量
 */
export async function preDeductStock(stockKey: string, need: number): Promise<PreDeductResult> {
  const instance = getRedis();
  if (!instance || !ready) {
    return { ok: false, reason: 'redis_unavailable', remaining: null };
  }
  if (!Number.isInteger(need) || need <= 0) {
    throw new Error('preDeductStock 的 need 必须是正整数');
  }

  const key = redisKey(stockKey);
  try {
    const raw = await instance.eval(loadDeductScript(), 1, key, String(need));
    const ok = Number(raw) === 1;
    const remainingRaw = await instance.get(key);
    return {
      ok,
      reason: ok ? 'ok' : 'sold_out',
      remaining: remainingRaw === null ? null : Number(remainingRaw)
    };
  } catch (error: any) {
    log('warn', 'redis.eval_failed', { key: stockKey, message: error?.message ?? String(error) });
    return { ok: false, reason: 'redis_unavailable', remaining: null };
  }
}

/** 仅测试/排障用：读取当前库存 */
export async function readStock(stockKey: string): Promise<number | null> {
  const instance = getRedis();
  if (!instance || !ready) return null;
  try {
    const raw = await instance.get(redisKey(stockKey));
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}
