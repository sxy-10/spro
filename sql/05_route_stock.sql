-- Execute once after 04_api_v1.sql. Existing orders are not assumed to hold seats.
USE travel_agent_db;
CREATE TABLE route_stock (
  route_id BIGINT UNSIGNED NOT NULL,
  travel_date DATE NOT NULL,
  total_seats INT UNSIGNED NOT NULL,
  locked_seats INT UNSIGNED NOT NULL DEFAULT 0,
  sold_seats INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (route_id, travel_date),
  CONSTRAINT fk_stock_route FOREIGN KEY (route_id) REFERENCES travel_product(id),
  CONSTRAINT chk_stock_capacity CHECK (locked_seats + sold_seats <= total_seats)
) ENGINE=InnoDB;
ALTER TABLE tour_order
  ADD COLUMN is_stock_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN expires_at DATETIME NULL,
  ADD INDEX idx_order_expiry (status, is_stock_locked, expires_at);
-- Stock must be explicitly configured by operators per route/date. Missing means unsellable.
