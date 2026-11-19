import { getRedis, isRedisReady, redisKey } from '../db/redis.js';
import { logEvent } from './protocol.js';

/**
 * 在线状态（第 2 棒 · 组员1）
 *
 * 存法（对应分工文档 §4.2 的 Redis key 约定）：
 *
 *   im:online:{userId}   Hash   field = deviceId, value = lastSeen(epoch ms)   TTL 60s
 *   im:online:set        Set    当前在线的 userId（给大屏 SCARD 用，O(1)）
 *
 * 为什么要多一个 Set：
 *   大屏的"在线人数"每 5s 要一次，如果用 `SCAN im:online:*` 数 key，
 *   连接一多就会变成遍历整个 keyspace —— 演示时正是压力最大的时候。
 *   Set + SCARD 是 O(1)，代价只是多一次 SADD/SREM。
 *
 * 为什么 TTL 只给 60s：
 *   心跳是 30s，60s 正好覆盖"漏一拍"。进程被 kill -9 时没人来清，
 *   60s 后 Hash 自己过期；Set 里的残留由 `sweepStaleUsers()` 定时清掉
 *   （每 30s 检查一次，只处理还在 Set 里的成员，规模可控）。
 *
 * 降级：Redis 不可用时所有函数都安静返回，不影响 WS 连接本身可用
 *      —— 在线状态是"锦上添花"，不能因为它挂了就连聊天都连不上。
 */

/** 在线 Hash 的 TTL（秒）；可用 IM_PRESENCE_TTL_SECONDS 调整，必须大于心跳周期 */
export const PRESENCE_TTL_SECONDS = Number(process.env.IM_PRESENCE_TTL_SECONDS ?? 60);

/** 在线用户集合的 key（不带业务前缀，交给 redisKey() 拼 REDIS_KEY_PREFIX） */
const ONLINE_SET = 'im:online:set';

const onlineHashOf = (userId: string | number): string => `im:online:${userId}`;

/** 连接建立 / 心跳续期：写 deviceId → now，并刷新 TTL、把用户加进在线集合 */
export async function markOnline(userId: string | number, deviceId: string): Promise<boolean> {
  if (process.env.REDIS_DISABLED === '1' || !isRedisReady()) return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    const key = redisKey(onlineHashOf(userId));
    const transaction = redis.multi();
    transaction.hset(key, deviceId, String(Date.now()));
    transaction.expire(key, PRESENCE_TTL_SECONDS);
    transaction.sadd(redisKey(ONLINE_SET), String(userId));
    await transaction.exec();
    return true;
  } catch (error: any) {
    logEvent('im.presence.mark_online_failed', {
      userId: String(userId),
      message: error?.message ?? String(error)
    });
    return false;
  }
}

/** 收到 ping 时续期（等价于 markOnline，语义上单独命名便于日志区分） */
export async function touch(userId: string | number, deviceId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return false;
  try {
    const key = redisKey(onlineHashOf(userId));
    await redis.hset(key, deviceId, String(Date.now()));
    await redis.expire(key, PRESENCE_TTL_SECONDS);
    return true;
  } catch {
    return false;
  }
}

/**
 * 连接关闭：摘掉这台设备。
 * @returns userFullyOffline = 该用户已经没有任何在线设备（此时才把人从 Set 里移除）
 */
export async function markOffline(
  userId: string | number,
  deviceId: string,
  userFullyOffline: boolean
): Promise<void> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return;
  try {
    const key = redisKey(onlineHashOf(userId));
    await redis.hdel(key, deviceId);
    if (userFullyOffline) await redis.srem(redisKey(ONLINE_SET), String(userId));
  } catch (error: any) {
    logEvent('im.presence.mark_offline_failed', {
      userId: String(userId),
      message: error?.message ?? String(error)
    });
  }
}

/** 某用户当前在线的设备列表（deviceId → lastSeen） */
export async function onlineDevices(userId: string | number): Promise<Record<string, string> | null> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return null;
  try {
    const raw = await redis.hgetall(redisKey(onlineHashOf(userId)));
    return raw && Object.keys(raw).length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 在线人数（大屏用）。Redis 不可用时返回 null，调用方自行降级到 DB 口径。
 * @returns null = 拿不到（Redis 挂了），数字 = 去重后的在线用户数
 */
export async function onlineUserCount(): Promise<number | null> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return null;
  try {
    return await redis.scard(redisKey(ONLINE_SET));
  } catch {
    return null;
  }
}

/** 在线连接数（进程内 gauge，多实例时需要汇总各实例的 im:stat:conn） */
export async function onlineConnectionGauge(): Promise<number | null> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return null;
  try {
    const raw = await redis.get(redisKey('im:stat:conn'));
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

/**
 * 清理"Hash 已过期但还在 Set 里"的僵尸用户。
 * 场景：进程被 kill -9（没机会 hdel），60s 后 Hash 自然消失，但 Set 里还留着 id。
 * @returns 清掉的用户数
 */
export async function sweepStaleUsers(): Promise<number> {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return 0;
  try {
    const members = await redis.smembers(redisKey(ONLINE_SET));
    if (members.length === 0) return 0;

    let removed = 0;
    // 分批 exists 判断，避免一次性发太多命令
    const batchSize = 200;
    for (let index = 0; index < members.length; index += batchSize) {
      const batch = members.slice(index, index + batchSize);
      const pipeline = redis.pipeline();
      for (const userId of batch) pipeline.exists(redisKey(onlineHashOf(userId)));
      const results = await pipeline.exec();
      const stale: string[] = [];
      batch.forEach((userId, offset) => {
        const entry = results?.[offset];
        const exists = Array.isArray(entry) ? Number(entry[1]) : 0;
        if (exists === 0) stale.push(userId);
      });
      if (stale.length) {
        await redis.srem(redisKey(ONLINE_SET), ...stale);
        removed += stale.length;
      }
    }

    if (removed > 0) logEvent('im.presence.sweep', { removed });
    return removed;
  } catch (error: any) {
    logEvent('im.presence.sweep_failed', { message: error?.message ?? String(error) });
    return 0;
  }
}

/**
 * 启动在线状态清理定时器。
 * @returns 停止函数（进程退出/测试结束时调用）
 */
export function startPresenceJanitor(intervalMs = 30000): () => void {
  const timer = setInterval(() => {
    void sweepStaleUsers();
  }, intervalMs);
  // 不阻止进程退出
  timer.unref?.();
  return () => clearInterval(timer);
}
