-- Node audit data tables. Apply after 10_audit_log.sql and before starting Node.
USE travel_agent_db;

CREATE TABLE IF NOT EXISTS sys_login_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NULL,
  login_name      VARCHAR(80) NULL COMMENT '手机号脱敏或账号部分脱敏',
  login_ip        VARCHAR(45) NULL,
  user_agent      VARCHAR(500) NULL,
  result          VARCHAR(16) NOT NULL,
  failure_reason  VARCHAR(64) NULL COMMENT '只记录状态码，不记录凭据或原始错误内容',
  trace_id        VARCHAR(64) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_login_time (created_at),
  KEY idx_login_name_time (login_name, created_at),
  KEY idx_login_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='登录事件（不记录密码、token 或请求体）';

CREATE TABLE IF NOT EXISTS sys_operation_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operator_id     BIGINT UNSIGNED NULL,
  action          VARCHAR(100) NOT NULL,
  request_method  VARCHAR(10) NOT NULL,
  request_path    VARCHAR(255) NOT NULL,
  status_code     SMALLINT UNSIGNED NOT NULL,
  result          VARCHAR(16) NOT NULL,
  client_ip       VARCHAR(45) NULL,
  ua              VARCHAR(500) NULL,
  trace_id        VARCHAR(64) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_operation_time (created_at),
  KEY idx_operation_operator_time (operator_id, created_at),
  KEY idx_operation_result_time (result, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='业务操作事件（只记录操作元数据，不落请求体）';

ALTER TABLE sys_audit_log
  ADD COLUMN client_ip VARCHAR(45) NULL,
  ADD COLUMN ua VARCHAR(500) NULL,
  ADD COLUMN result VARCHAR(16) NULL;
