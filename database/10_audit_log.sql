-- Permission-change and management-operation audit log (member 2).
USE travel_agent_db;

CREATE TABLE IF NOT EXISTS sys_audit_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id        BIGINT UNSIGNED NULL,
  actor_name      VARCHAR(100) NULL,
  action          VARCHAR(64) NOT NULL,
  resource_type   VARCHAR(64) NOT NULL,
  resource_id     VARCHAR(64) NULL,
  request_method  VARCHAR(10) NULL,
  request_path    VARCHAR(255) NULL,
  before_data     JSON NULL,
  after_data      JSON NULL,
  detail          VARCHAR(1000) NULL,
  trace_id        CHAR(36) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_actor_time (actor_id, created_at),
  KEY idx_audit_resource_time (resource_type, resource_id, created_at),
  KEY idx_audit_time (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '管理操作审计日志';
