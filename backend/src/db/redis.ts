import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';

/**
 * Redis 连接、缓存封装与 Lua 原子脚本（组员1 · 阶段一「Redis 底座」）
 *
 * 四条铁律，后续所有阶段都依赖这里的行为：
 *
 * 1. **连不上不能拖垮服务**
 *    lazyConnect + enableOfflineQueue=false + maxRetriesPerRequest=1，
 *    拿不到连接时所有对外函数返回 null / false，调用方走 MySQL 兜底。
 *    （本文件不抛异常给业务层，只在日志里留痕）
 *
 * 2. **掉线必须自己回来**
 *    早期版本 `retryStrategy: () => null` 意味着 ioredis 永不重连：
 *    Redis 重启一次，进程就永久降级（秒杀永久 503、字典永久打库、认证永久查库），
 *    只能重启 Node。现在改成指数退避（200ms → 3s 封顶）**永不放弃**。
 *
 * 3. **key 必须带前缀**
 *    多人可能共用一个 Redis 实例（宿舍局域网共享 / 一台机器演示），
 *    REDIS_KEY_PREFIX 用来隔离，避免一个人压测把别人的库存扣光。
 *
 * 4. **TTL 一律显式设置**
 *    缓存不设过期就是内存泄漏，也容易读到陈旧的授权数据。
 *
 * 原子性策略（这是本文件的核心价值）：
 *   - 单 key 的「读 → 判断 → 写」一律走 Lua（EVAL），Redis 单线程执行期间不会插入其他命令；
 *   - 多 key 的写入用 MULTI/EXEC，避免 HSET 成功、EXPIRE 失败导致的无 TTL 泄漏；
 *   - 库存预扣、令牌桶限流、登录失败计数都在 server 端一次算完，不在 Node 侧分几条命令。
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
    connectTimeout: CONNECT_TIMEOUT_MS,
    // 指数退避：200ms, 400ms, 800ms, 1.6s, 3s 封顶；永远不返回 null（null = 放弃重连）
    retryStrategy: (times: number) => Math.min(200 * 2 ** Math.min(times - 1, 4), 3000),
    // 主从切换 / 服务端正在加载数据时，重连一次就能恢复，不算错误
    reconnectOnError: (error: Error) => /READONLY|LOADING|MASTERDOWN|TRYAGAIN/.test(error.message)
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

/**
 * 启动阶段用：最多等 timeoutMs，等 Redis 连上再返回。
 * 预热库存、创建消费组都依赖它，否则「服务先起来、Redis 后起来」会导致预热全部落空。
 */
export async function waitForRedis(timeoutMs = 5000): Promise<boolean> {
  const instance = getRedis();
  if (!instance) return false;
  if (ready) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return ready;
}

/* ------------------------------------------------------------------ *
 * Lua 脚本加载与执行
 * ------------------------------------------------------------------ */

/** 开发态从 src/db/lua 读；构建后 dist/db 的同级找不到 lua，就回退到源码目录 */
const LUA_DIRS = [
  join(__dirname, 'lua'),
  join(__dirname, '..', '..', 'src', 'db', 'lua')
];

const scriptSource = new Map<string, string>();

/**
 * 读取并缓存 Lua 源码（进程内只读一次文件，之后走内存）。
 * 这里不缓存 sha1 + EVALSHA，是为了「改脚本不用重启也能生效」的排障便利：
 * 脚本体量只有几十行，EVAL 每次重传的开销可以忽略。
 */
function loadScript(name: string): string {
  const cached = scriptSource.get(name);
  if (cached) return cached;
  let lastError: unknown = null;
  for (const dir of LUA_DIRS) {
    try {
      const source = readFileSync(join(dir, name), 'utf8');
      scriptSource.set(name, source);
      return source;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法加载 Lua 脚本 ${name}：${(lastError as Error)?.message ?? 'unknown'}`);
}

/**
 * 统一执行入口：EVAL script numkeys key... arg...
 * 单个 Lua 脚本在 Redis 服务端一次性执行，执行期间不会插入其他客户端的命令，
 * 因此「读 + 判断 + 写」三步天然等价于一个原子操作。
 */
async function evalScript<T>(name: string, keys: string[], args: Array<string | number>): Promise<T | null> {
  const instance = getRedis();
  if (!instance || !ready) return null;
  try {
    const payload = args.map(String);
    return (await instance.eval(loadScript(name), keys.length, ...keys, ...payload)) as T;
  } catch (error: any) {
    log('warn', 'redis.eval_failed', { script: name, keys, message: error?.message ?? String(error) });
    return null;
  }
}

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
    const key = redisKey(name);
    if (ttlSeconds > 0) await instance.set(key, payload, 'EX', ttlSeconds);
    else await instance.set(key, payload);
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

/** SET key value NX EX ttl —— 返回 true 表示"抢到了"（分布式场景下的互斥锁 / 幂等锁） */
export async function setNx(name: string, value: string, ttlSeconds: number): Promise<boolean> {
  const instance = getRedis();
  if (!instance || !ready) return false;
  try {
    const result = await instance.set(redisKey(name), value, 'EX', Math.max(1, ttlSeconds), 'NX');
    return result === 'OK';
  } catch (error: any) {
    log('warn', 'redis.setnx_failed', { key: name, message: error?.message ?? String(error) });
    return false;
  }
}

/** 原子自增（用于把预扣的库存回补回去） */
export async function incrBy(name: string, delta: number): Promise<number | null> {
  const instance = getRedis();
  if (!instance || !ready) return null;
  try {
    return await instance.incrby(redisKey(name), delta);
  } catch (error: any) {
    log('warn', 'redis.incr_failed', { key: name, message: error?.message ?? String(error) });
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Hash（登录态缓存用）
 * ------------------------------------------------------------------ */

/**
 * 写入 Hash 并设置 TTL。
 * 用 MULTI/EXEC 包起来：HSET 成功但 EXPIRE 失败（或进程刚好在这中间挂掉）会留下
 * 一个**永不失效**的授权缓存 —— 那等于会话永不过期，是安全事故级别的坑。
 */
export async function hashSetAll(
  name: string,
  fields: Record<string, string>,
  ttlSeconds: number
): Promise<boolean> {
  const instance = getRedis();
  if (!instance || !ready) return false;
  try {
    const key = redisKey(name);
    const transaction = instance.multi().hset(key, fields);
    if (ttlSeconds > 0) transaction.expire(key, ttlSeconds);
    const results = await transaction.exec();
    return Boolean(results);
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

/** 维护"某个用户有哪些缓存会话"的索引集合（用于改密码后一次性踢下线） */
export async function sessionIndexAdd(userKey: string, tokenKey: string, ttlSeconds: number): Promise<void> {
  const instance = getRedis();
  if (!instance || !ready) return;
  try {
    const key = redisKey(userKey);
    const transaction = instance.multi().sadd(key, tokenKey).expire(key, Math.max(ttlSeconds, 60));
    await transaction.exec();
  } catch {
    // 索引只是"加速踢人"的优化，失败不影响主流程
  }
}

export async function sessionIndexMembers(userKey: string): Promise<string[]> {
  const instance = getRedis();
  if (!instance || !ready) return [];
  try {
    return await instance.smembers(redisKey(userKey));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Lua 脚本：库存预扣（阶段二「抢购先打 Redis」的地基）
 * ------------------------------------------------------------------ */

export interface PreDeductResult {
  /** 是否预扣成功 */
  ok: boolean;
  /** ok=成功；sold_out=库存不足；not_warmed=key 不存在（未预热）；redis_unavailable=Redis 不可用 */
  reason: 'ok' | 'sold_out' | 'not_warmed' | 'redis_unavailable';
  /** 预扣后剩余库存（拿不到时为 null） */
  remaining: number | null;
}

/**
 * 原子预扣库存。
 *
 * Lua 返回 {ok, remaining}：
 *   {1, 剩余}  预扣成功
 *   {0, 剩余}  库存不足
 *   {-1, -1}   key 不存在（没预热 / Redis 被清），调用方应先回填再重试
 *
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

  const result = await evalScript<[number, number]>('deduct_stock.lua', [redisKey(stockKey)], [need]);
  if (!result) return { ok: false, reason: 'redis_unavailable', remaining: null };

  const [code, remaining] = result;
  if (Number(code) === 1) return { ok: true, reason: 'ok', remaining: Number(remaining) };
  if (Number(code) === -1) return { ok: false, reason: 'not_warmed', remaining: null };
  return { ok: false, reason: 'sold_out', remaining: Number(remaining) };
}

/** 仅测试/排障用：读取当前库存（null = key 不存在） */
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

/* ------------------------------------------------------------------ *
 * Lua 脚本：令牌桶限流（阶段六「限流」）
 * ------------------------------------------------------------------ */

/**
 * 应用层令牌桶。
 *
 * 为什么不用「每分钟计数」：固定窗口在窗口边界会放过 2 倍流量，
 * 而且每次要两条 SQL（INSERT ON DUPLICATE + SELECT），攻击时数据库先死。
 * 令牌桶一次 EVAL 就完成「按流逝时间补令牌 + 判定 + 扣令牌」，天然原子且零 SQL。
 *
 * @returns null = Redis 不可用（调用方降级到 MySQL）；否则 {allowed, remaining}
 */
export async function tokenBucket(
  bucketKey: string,
  capacity: number,
  refillPerSecond: number,
  cost = 1
): Promise<{ allowed: boolean; remaining: number } | null> {
  const result = await evalScript<[number, number]>(
    'token_bucket.lua',
    [redisKey(bucketKey)],
    [Math.max(1, Math.floor(capacity)), refillPerSecond, Date.now(), cost]
  );
  if (!result) return null;
  return { allowed: Number(result[0]) === 1, remaining: Number(result[1]) };
}

/* ------------------------------------------------------------------ *
 * Lua 脚本：登录失败计数（防暴力破解）
 * ------------------------------------------------------------------ */

export interface LoginFailureState {
  /** 当前失败次数 */
  count: number;
  /** 距锁定自动解除还剩多少秒（<=0 且 count>0 表示脏 key，脚本会顺手补 TTL） */
  ttlSeconds: number;
}

/** 只读：查看某账号是否已被锁定（不会自增） */
export async function peekLoginFailure(key: string, ttlSeconds: number): Promise<LoginFailureState | null> {
  const result = await evalScript<[number, number]>('login_fail.lua', [redisKey(key)], [ttlSeconds, 0]);
  if (!result) return null;
  return { count: Number(result[0]), ttlSeconds: Number(result[1]) };
}

/** 原子自增一次失败次数，并保证 key 一定有 TTL（历史脏 key 会被自愈） */
export async function bumpLoginFailure(key: string, ttlSeconds: number): Promise<LoginFailureState | null> {
  const result = await evalScript<[number, number]>('login_fail.lua', [redisKey(key)], [ttlSeconds, 1]);
  if (!result) return null;
  return { count: Number(result[0]), ttlSeconds: Number(result[1]) };
}

export async function clearLoginFailures(key: string): Promise<void> {
  await cacheDel(key);
}

/* ------------------------------------------------------------------ *
 * 可观测性：给 /v1/health/queue 用
 * ------------------------------------------------------------------ */

export async function redisStats(): Promise<{
  connected: boolean;
  keys: number | null;
  usedMemory: string | null;
  maxmemoryPolicy: string | null;
}> {
  const instance = getRedis();
  if (!instance || !ready) return { connected: false, keys: null, usedMemory: null, maxmemoryPolicy: null };
  try {
    const [keys, memory, config] = await Promise.all([
      instance.dbsize(),
      instance.info('memory').catch(() => ''),
      instance.config('GET', 'maxmemory-policy').catch(() => [] as string[])
    ]);
    const usedMemory = /used_memory_human:(\S+)/.exec(memory)?.[1] ?? null;
    const policy = Array.isArray(config) && config.length > 1 ? String(config[1]) : null;
    return { connected: true, keys, usedMemory, maxmemoryPolicy: policy };
  } catch {
    return { connected: false, keys: null, usedMemory: null, maxmemoryPolicy: null };
  }
}
