import { createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { bumpLoginFailure, clearLoginFailures, peekLoginFailure } from '../db/redis.js';
import { ApiError } from '../api/core.js';

/**
 * 安全认证基础套件：密码加盐慢哈希、恒定时间防时序攻击比对与防暴力破解频控锁定
 *
 * 核心特性：
 * 1. bcrypt 慢哈希运算（默认 12 轮 Salt，抗 GPU 算力碰撞）
 * 2. 恒定时间比对防时序攻击（Timing Attack Defense）
 * 3. 输错 5 次账号锁定 15 分钟（Redis 优先 + MySQL/内存 自动平滑降级）
 *
 * 阶段六修复（三条都是真事故级别的）：
 * ① **不再自建 Redis 连接**：原来这里 `new Redis(...)` 开了第二个客户端，
 *    而且 key 是裸的 `login_fail_count:手机号`，没有走 REDIS_KEY_PREFIX ——
 *    等于绕过了 redis.ts 自己定的"key 必须带前缀"铁律，多人共用一个 Redis 时会互相污染。
 *    现在统一用 db/redis.ts 的客户端与 redisKey()。
 * ② **计数原子化**：原来是 INCR + EXPIRE 两条命令，中间崩了就留下"无 TTL 的永久计数"，
 *    该账号从此永远提示"已被锁定"，只能人工删 key。现在走 login_fail.lua，
 *    自增与过期时间在同一次执行里完成，并会自愈历史脏 key。
 * ③ **key 不再明文放手机号**：改成 sha256(手机号) 的前 32 位，
 *    Redis 的 MONITOR / SLOWLOG / RDB 里不会出现用户隐私。
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

/**
 * 锁定计数的 key：用 sha256 而不是明文手机号。
 * 加 'login_fail:' 前缀便于在 redis-cli 里 SCAN 出来排查。
 */
const lockoutKeyOf = (identifier: string): string =>
  `login_fail:${createHash('sha256').update(identifier).digest('hex').slice(0, 32)}`;

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
  const key = lockoutKeyOf(userIdentifier);

  // 1) Redis 优先（一次 EVAL：读计数 + 读 TTL + 顺手修复无 TTL 的脏 key）
  const state = await peekLoginFailure(key, LOCKOUT_DURATION_SECONDS);
  if (state && state.count >= MAXIMUM_LOGIN_ATTEMPTS) {
    const remainingMinutes = Math.max(1, Math.ceil((state.ttlSeconds > 0 ? state.ttlSeconds : LOCKOUT_DURATION_SECONDS) / 60));
    throw new ApiError(429, 20014,
      `密码连续输错超过 ${MAXIMUM_LOGIN_ATTEMPTS} 次，账号已被安全锁定，请在 ${remainingMinutes} 分钟后再试`);
  }
  if (state) return;

  // 2) Redis 不可用：降级查 api_rate_limit 表，若表不存在再降级到内存
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT hits, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), expires_at) AS remain_seconds
       FROM api_rate_limit
       WHERE bucket_hash = SHA2(CONCAT('login_lock:', ?), 256) AND expires_at > UTC_TIMESTAMP()`,
      [userIdentifier]
    );

    if (rows.length > 0 && rows[0].hits >= MAXIMUM_LOGIN_ATTEMPTS) {
      const remainingMinutes = Math.max(1, Math.ceil((rows[0].remain_seconds || 60) / 60));
      throw new ApiError(429, 20014,
        `密码连续输错超过 ${MAXIMUM_LOGIN_ATTEMPTS} 次，账号已被安全锁定，请在 ${remainingMinutes} 分钟后再试`);
    }
  } catch (dbError: any) {
    if (dbError instanceof ApiError) throw dbError;
    // 内存兜底
    const mem = inMemoryLockoutStore.get(userIdentifier);
    if (mem && mem.expiresAt > Date.now() && mem.count >= MAXIMUM_LOGIN_ATTEMPTS) {
      const remainingMinutes = Math.max(1, Math.ceil((mem.expiresAt - Date.now()) / 60000));
      throw new ApiError(429, 20014,
        `密码连续输错超过 ${MAXIMUM_LOGIN_ATTEMPTS} 次，账号已被安全锁定，请在 ${remainingMinutes} 分钟后再试`);
    }
  }
}

/**
 * 记录一次登录失败
 * 计数自增，并保证这个计数一定有过期时间（不会永久锁死账号）
 *
 * @param userIdentifier 手机号或用户名标识
 * @returns 当前累计失败次数
 */
export async function recordLoginFailure(userIdentifier: string): Promise<number> {
  const key = lockoutKeyOf(userIdentifier);

  // 1) Redis：INCR + EXPIRE 在同一个 Lua 里，天然原子
  const state = await bumpLoginFailure(key, LOCKOUT_DURATION_SECONDS);
  if (state) return state.count;

  // 2) 降级：MySQL api_rate_limit 表，若未初始化则写内存
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
 */
export async function clearLoginLockout(userIdentifier: string): Promise<void> {
  await clearLoginFailures(lockoutKeyOf(userIdentifier));

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

/**
 * 恒定时间字符串比较（给需要比较校验码/签名的地方用）。
 * 保留导出是为了让业务层不必各自手写 timingSafeEqual 的长度保护。
 */
export function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
