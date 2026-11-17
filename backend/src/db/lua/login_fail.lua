-- ============================================================================
-- 登录失败计数（Redis Lua 脚本）
--
-- 修的是什么 bug：
--   原实现是两条命令：
--       count = INCR  key
--       if count == 1 then EXPIRE key 900 end
--   如果进程恰好在这两条命令之间崩溃 / 被 kill，或者 EXPIRE 因为网络失败没发出去，
--   key 就变成了**没有 TTL 的永久计数**：
--   该账号一旦输错 5 次，就会永远提示"账号已被锁定"，只能人工 redis-cli DEL 才能解开。
--
--   Lua 把 INCR 和 EXPIRE 放在同一次执行里，两者要么都生效要么都不生效；
--   同时顺手自愈历史遗留的"无 TTL 脏 key"。
--
-- 同时消除 TOCTOU：
--   原来 checkLoginLockout（读）与 recordLoginFailure（写）是两次独立请求，
--   并发失败的请求会同时读到 count=4 而全部放行，实际尝试次数超过上限。
--   现在每次失败都是一次原子自增，返回值就是权威结论。
--
-- KEYS[1] = 计数 key，例如 login_fail:<sha256(手机号)>
-- ARGV[1] = 锁定时长（秒）
-- ARGV[2] = 1 表示 "计数 +1"；0 表示 "只读查看"
--
-- 返回 {count, ttlSeconds}
--   ttlSeconds = -1 说明 key 无过期时间（不该出现，脚本会补上并返回新 TTL）
-- ============================================================================

local ttl = tonumber(ARGV[1])
local bump = tonumber(ARGV[2]) == 1
if not ttl or ttl <= 0 then ttl = 900 end

local count
if bump then
  count = redis.call('INCR', KEYS[1])
  if count == 1 then
    -- 第一次失败才开始计时；之后每次失败不刷新 TTL，
    -- 否则攻击者可以靠"每 14 分钟试一次"把这个账号永久锁住（拒绝服务）。
    redis.call('EXPIRE', KEYS[1], ttl)
  end
else
  count = tonumber(redis.call('GET', KEYS[1])) or 0
end

local remain = redis.call('TTL', KEYS[1])

-- 自愈：历史脏 key 没有 TTL，补一个，避免"永久锁定"
if count > 0 and remain < 0 then
  redis.call('EXPIRE', KEYS[1], ttl)
  remain = ttl
end

if count == 0 then
  remain = 0
end

return { count, remain }
