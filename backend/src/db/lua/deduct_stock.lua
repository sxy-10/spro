-- 库存原子预扣（Redis Lua 脚本）
--
-- 为什么必须写成脚本：
--   如果按「GET → 业务代码判断 → DECR」三步走，两个并发请求可能同时读到
--   stock=1，各自判断"还有货"，然后各扣一次，结果卖出 2 份、库存变成 -1（超卖）。
--   Redis 执行 Lua 时是单线程且不会插入其他命令，所以「查库存 + 判断 + 扣减」
--   三步合成一次原子操作。
--
-- KEYS[1] = 库存 key，例如 stock:12:2026-12-01
-- ARGV[1] = 需要扣减的数量（正整数）
--
-- 返回：
--   1 = 预扣成功
--   0 = 库存不足（或 key 不存在，视为未预热/已抢完）
--
-- 注意：不返回剩余库存，剩余值由调用方再 GET 一次（读操作，不影响原子性）。

local stock = tonumber(redis.call('GET', KEYS[1]))
local need  = tonumber(ARGV[1])

if not need or need <= 0 then
  return 0
end

if not stock or stock < need then
  return 0
end

redis.call('DECRBY', KEYS[1], need)
return 1
