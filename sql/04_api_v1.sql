-- Apply after 01_schema.sql to an existing database. Does not remove existing data.
USE travel_agent_db;
ALTER TABLE itinerary ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tour_order ADD COLUMN travel_date DATE NULL;
CREATE TABLE api_session (
  session_id CHAR(36) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES sys_user(id),
  INDEX (expires_at)
);
CREATE TABLE api_idempotency (
  scope_hash CHAR(64) PRIMARY KEY,
  request_hash CHAR(64) NOT NULL,
  response_status SMALLINT NULL,
  response_data JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE api_nonce (
  nonce_hash CHAR(64) PRIMARY KEY,
  expires_at DATETIME NOT NULL,
  INDEX (expires_at)
);
CREATE TABLE api_rate_limit (
  bucket_hash CHAR(64) PRIMARY KEY,
  hits INT NOT NULL DEFAULT 1,
  expires_at DATETIME NOT NULL,
  INDEX (expires_at)
);
CREATE TABLE spot_comment (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  spot_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  content VARCHAR(2000) NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (spot_id) REFERENCES poi(id),
  FOREIGN KEY (user_id) REFERENCES sys_user(id),
  CHECK (rating BETWEEN 1 AND 5)
);
