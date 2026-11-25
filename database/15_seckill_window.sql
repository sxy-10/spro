-- Timer-controlled seckill window state. Apply after 09_stock_version.sql.
USE travel_agent_db;

ALTER TABLE route_stock
  ADD COLUMN seckill_start_at DATETIME(3) NULL,
  ADD COLUMN seckill_end_at DATETIME(3) NULL,
  ADD COLUMN seckill_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD INDEX idx_seckill_window (seckill_enabled, seckill_start_at, seckill_end_at);
