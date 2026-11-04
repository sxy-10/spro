import bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { ApiError } from '../api/core.js';

/**
 * 安全认证基础套件：密码加盐慢哈希、恒定时间防时序攻击比对与防暴力破解频控锁定
 * 
 * 核心特性：
 * 1. bcrypt 慢哈希运算（默认 12 轮 Salt，抗 GPU 算力碰撞）
 * 2. 恒定时间比对防时序攻击（Timing Attack Defense）
 * 3. 输错 5 次账号锁定 15 分钟（Redis 优先 + MySQL/内存 自动平滑降级）
 */

// 慢哈希盐轮数：12 轮（单次耗时约 80~120ms）
export const BCRYPT_SALT_ROUNDS = 12;

// 预设的固定虚假哈希串：用于当用户不存在时执行无差别耗时比较，防止通过响应耗时探测用户名是否存在
export const DUMMY_FALLBACK_HASH = '$2b$12$XJj1kPqRhuG4aWpEYoU4jO95bY.H8QkJ9PxJu1BxKocJr6BExJXhS';

// 防暴力破解配置：连续输错 5 次，锁定 15 分钟（900 秒）
export const MAXIMUM_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_SECONDS = 15 * 60;

// 本地内存防线（当 Redis 与 MySQL 均不可用/未建表时的三级保底容灾缓存）
const inMemoryLockoutStore = new Map<string, { count: number; expiresAt: number }>();

// 初始化 Redis 客户端连接（优先连接本地或环境变量配置的 Redis，连接失败时自动优雅降级，不阻塞服务）
let redisClientInstance: Redis | null = null;
let isRedisAvailable = false;

try {
  const configuredRedisHost = process.env.REDIS_HOST || '127.0.0.1';
  const configuredRedisPort = Number(process.env.REDIS_PORT) || 6379;
  const configuredRedisPassword = process.env.REDIS_PASSWORD || undefined;

  redisClientInstance = new Redis({
    host: configuredRedisHost,
    port: configuredRedisPort,
    password: configuredRedisPassword,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    enableOfflineQueue: false,
    connectTimeout: 1000
  });

  redisClientInstance.on('connect', () => {
    isRedisAvailable = true;
    console.log('[Security] Redis 登录防刷锁定服务连接成功');
  });

  redisClientInstance.on('error', () => {
    isRedisAvailable = false;
  });

  // 尝试握手连接，若无本地 Redis 服务则不阻塞进程退出
  redisClientInstance.connect().then(() => {
    // @ts-ignore
    redisClientInstance?.connector?.stream?.unref?.();
  }).catch(() => {
    isRedisAvailable = false;
  });
} catch {
  isRedisAvailable = false;
}

/**
 * 慢哈希加盐生成密文（注册或重置密码时调用）
 * @param plainPassword 明文密码
 * @returns 加盐后的哈希密文
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);
}

/**
 * 恒定时间比对密码（严格防时序攻击）
 * 无论目标用户在数据库中是否存在，必须完整执行一次耗时恒定的 bcrypt.compare 计算
 * 
 * @param plainPassword 提交的明文密码
 * @param actualHashFromDatabase 数据库中查出的密码哈希（若用户不存在则为 null/undefined）
 * @returns 是否完全匹配
 */
export async function verifyPasswordConstantTime(
  plainPassword: string,
  actualHashFromDatabase: string | null | undefined
): Promise<boolean> {
  const targetHashToCompare = (actualHashFromDatabase && actualHashFromDatabase.startsWith('$2'))
    ? actualHashFromDatabase
    : DUMMY_FALLBACK_HASH;

  const isComparisonMatched = await bcrypt.compare(plainPassword, targetHashToCompare);

  // 如果数据库原本没有该用户，即便比较通过也强制判定为 false
  return Boolean(actualHashFromDatabase && isComparisonMatched);
}

/**
 * 检查指定账号（手机号/用户名）是否处于输错锁定状态
 * 规则：连续输错 5 次，锁定 15 分钟
 * 
 * @param userIdentifier 手机号或用户名标识
 */
export async function checkLoginLockout(userIdentifier: string): Promise<void> {
  const lockoutCacheKey = `login_fail_count:${userIdentifier}`;

  if (isRedisAvailable && redisClientInstance) {
    try {
      const currentFailedAttemptsString = await redisClientInstance.get(lockoutCacheKey);
      const failedAttemptsCount = Number(currentFailedAttemptsString) || 0;

      if (failedAttemptsCount >= MAXIMUM_LOGIN_ATTEMPTS) {
        const remainingTtlSeconds = await redisClientInstance.ttl(lockoutCacheKey);
        const remainingMinutes = Math.max(1, Math.ceil(remainingTtlSeconds / 60));
        throw new ApiError(
          429,
          20014,
          `密码连续输错超过 ${MAXIMUM_LOGIN_ATTEMPTS} 次，账号已被安全锁定，请在 ${remainingMinutes} 分钟后再试`
        );
      }
      return;
    } catch (redisError: any) {
      if (redisError instanceof ApiError) throw redisError;
      // Redis 异常时平滑进入 MySQL 降级检查
    }
  }

  // 降级方案：从数据库 api_rate_limit 表检查，若表不存在则平滑降级至内存存储
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT hits, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), expires_at) AS remain_seconds
       FROM api_rate_limit
       WHERE bucket_hash = SHA2(CONCAT('login_lock:', ?), 256) AND expires_at > UTC_TIMESTAMP()`,
      [userIdentifier]
    );

    if (rows.length > 0 && rows[0].hits >= MAXIMUM_LOGIN_ATTEMPTS) {
      const remainingMinutes = Math.max(1, Math.ceil((rows[0].remain_seconds || 60) / 60));
      throw new ApiError(
        429,
        20014,
        `密码连续输错超过 ${MAXIMUM_LOGIN_ATTEMPTS} 次，账号已被安全锁定，请在 ${remainingMinutes} 分钟后再试`
      );
    }
  } catch (dbError: any) {
    if (dbError instanceof ApiError) throw dbError;
    // 内存兜底
    const mem = inMemoryLockoutStore.get(userIdentifier);
    if (mem && mem.expiresAt > Date.now() && mem.count >= MAXIMUM_LOGIN_ATTEMPTS) {
      const remainingMinutes = Math.max(1, Math.ceil((mem.expiresAt - Date.now()) / 60000));
      throw new ApiError(
        429,
        20014,
        `密码连续输错超过 ${MAXIMUM_LOGIN_ATTEMPTS} 次，账号已被安全锁定，请在 ${remainingMinutes} 分钟后再试`
      );
    }
  }
}

/**
 * 记录一次登录失败
 * 计数自增，并重置 15 分钟失效期
 * 
 * @param userIdentifier 手机号或用户名标识
 */
export async function recordLoginFailure(userIdentifier: string): Promise<number> {
  const lockoutCacheKey = `login_fail_count:${userIdentifier}`;
  let recordedAttemptsCount = 1;

  if (isRedisAvailable && redisClientInstance) {
    try {
      recordedAttemptsCount = await redisClientInstance.incr(lockoutCacheKey);
      if (recordedAttemptsCount === 1) {
        await redisClientInstance.expire(lockoutCacheKey, LOCKOUT_DURATION_SECONDS);
      }
      return recordedAttemptsCount;
    } catch {
      // Redis 写入失败时降级走 MySQL
    }
  }

  // 降级方案：MySQL api_rate_limit 表，若未初始化则写内存
  try {
    await pool.query(
      `INSERT INTO api_rate_limit (bucket_hash, hits, expires_at)
       VALUES (SHA2(CONCAT('login_lock:', ?), 256), 1, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE hits = hits + 1, expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)`,
      [userIdentifier, LOCKOUT_DURATION_SECONDS, LOCKOUT_DURATION_SECONDS]
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT hits FROM api_rate_limit WHERE bucket_hash = SHA2(CONCAT('login_lock:', ?), 256)`,
      [userIdentifier]
    );
    return rows[0]?.hits ?? 1;
  } catch {
    const mem = inMemoryLockoutStore.get(userIdentifier);
    const newCount = (mem && mem.expiresAt > Date.now()) ? mem.count + 1 : 1;
    inMemoryLockoutStore.set(userIdentifier, { count: newCount, expiresAt: Date.now() + LOCKOUT_DURATION_SECONDS * 1000 });
    return newCount;
  }
}

/**
 * 登录成功后，清除该账号的历史失败锁定记录
 * 
 * @param userIdentifier 手机号或用户名标识
 */
export async function clearLoginLockout(userIdentifier: string): Promise<void> {
  const lockoutCacheKey = `login_fail_count:${userIdentifier}`;

  if (isRedisAvailable && redisClientInstance) {
    try {
      await redisClientInstance.del(lockoutCacheKey);
    } catch {
      // 忽略缓存清理异常
    }
  }

  // 清理数据库降级表中的记录与内存
  try {
    await pool.query(
      `DELETE FROM api_rate_limit WHERE bucket_hash = SHA2(CONCAT('login_lock:', ?), 256)`,
      [userIdentifier]
    );
  } catch {
    // 忽略未建表异常
  }
  inMemoryLockoutStore.delete(userIdentifier);
}
