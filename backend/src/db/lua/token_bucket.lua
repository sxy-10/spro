-- ============================================================================
-- 令牌桶限流（Redis Lua 脚本）
--
-- 为什么需要它：
--   原来的限流是「每分钟计数」——每条请求 2 条 SQL（INSERT ON DUPLICATE + SELECT），
--   固定窗口在 59 秒和 60 秒之间能放过 2 倍流量，攻击时数据库先被打死。
--
--   令牌桶：桶有 capacity 个令牌，按 refillPerSecond 匀速补充；
--   每个请求先"取"1 个令牌，取不到就拒绝（429）。
--   整个过程在 Redis 端一次算完，多个客户端并发时不会出现"都读到有令牌"的竞态。
--
-- KEYS[1] = 桶 key，例如 rl:user:42
-- ARGV[1] = 桶容量 capacity
-- ARGV[2] = 每秒补充速率（可以是小数，例如 120/60 = 2）
-- ARGV[3] = 当前毫秒时间戳
-- ARGV[4] = 本次消耗（默认 1）
--
-- 返回 {allowed, remaining}：
--   {1, 剩余令牌}  放行
--   {0, 剩余令牌}  拒绝（应返回 429 + Retry-After）
--
-- 为什么用 ms 时间戳而不是 Redis TIME：
--   避免脚本在不同 Redis 版本上的 TIME 返回值差异；毫秒精度足够，
--   且"补令牌"的基准是上一次写入的 ts，服务器时钟抖动只会让补充量略微不准，不影响正确性。
-- ============================================================================

local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])
if not cost or cost <= 0 then cost = 1 end
if not capacity or capacity < 1 then capacity = 1 end
if not rate or rate < 0 then rate = 0 end

local data   = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts     = tonumber(data[2])

-- 第一次访问：满桶
if not tokens or not ts then
  tokens = capacity
  ts = now
end

-- 按流逝时间补令牌，但不超过桶容量（不支持"借未来的令牌"）
local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
-- 桶清空后需要的恢复时间 + 1 秒缓冲，过期后自动回收，不会内存泄漏
local ttlMs = 1000
if rate > 0 then ttlMs = math.ceil(capacity / rate * 1000) + 1000 end
redis.call('PEXPIRE', KEYS[1], ttlMs)

return { allowed, math.floor(tokens) }
