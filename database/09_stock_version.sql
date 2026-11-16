-- ============================================================================
-- 09_stock_version.sql  （组员3 · 阶段二「秒杀后端」）
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 travel_agent_db < database/09_stock_version.sql
-- 幂等：可重复执行，已存在的列会跳过
-- ============================================================================
USE travel_agent_db;

-- 1) route_stock 加乐观锁版本号（消费者扣减时 WHERE version = ?）
ALTER TABLE route_stock
  ADD COLUMN IF NOT EXISTS version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '乐观锁版本号';

-- 2) route_stock 加秒杀独立名额（方案A：秒杀与普通下单名额隔离，互不扣减）
ALTER TABLE route_stock
  ADD COLUMN IF NOT EXISTS seckill_total_seats  INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '秒杀总名额',
  ADD COLUMN IF NOT EXISTS seckill_sold_seats   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '秒杀已售名额';

-- 3) tour_order 加 req_id（幂等键：消费者按它查重，重复消息不重复建单）
ALTER TABLE tour_order
  ADD COLUMN IF NOT EXISTS req_id VARCHAR(64) NULL COMMENT '秒杀请求ID（幂等键）',
  ADD UNIQUE KEY IF NOT EXISTS uk_order_req (req_id);

-- 4) 给一条测试数据：product_id=1、日期随便挑一个未来日期，秒杀名额=10
--    （你可以根据自己库里实际的 product_id 改）
INSERT INTO route_stock (route_id, travel_date, total_seats, locked_seats, sold_seats, version, seckill_total_seats, seckill_sold_seats)
SELECT 1, '2026-12-01', 50, 0, 0, 0, 10, 0
WHERE NOT EXISTS (
  SELECT 1 FROM route_stock WHERE route_id = 1 AND travel_date = '2026-12-01'
);
