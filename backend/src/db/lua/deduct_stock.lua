-- ============================================================================
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
-- 返回 {code, remaining}：
--   { 1, 剩余库存}  预扣成功
--   { 0, 剩余库存}  库存不足
--   {-1, -1}       key 不存在（未预热 / Redis 被清空）→ 调用方先回填再重试
--   { 0, -2}       入参非法
--
-- 注意：剩余库存由脚本一并返回，调用方不必再 GET 一次（少一次往返，
--       也不会出现"扣减后、GET 前又被别人扣走"导致展示不准确）。
-- ============================================================================

local raw  = redis.call('GET', KEYS[1])
local need = tonumber(ARGV[1])

if not need or need <= 0 then
  return { 0, -2 }
end

-- key 不存在：不是"卖完了"，而是"这场次没预热"，两者要区分开
if not raw then
  return { -1, -1 }
end

local stock = tonumber(raw)
if not stock or stock < need then
  return { 0, stock or 0 }
end

local left = redis.call('DECRBY', KEYS[1], need)
return { 1, left }
