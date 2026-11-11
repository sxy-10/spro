-- Additive RBAC completion for member 2. Run after 05_rbac_schema.sql.
-- Safe to re-run; existing RBAC assignments and audit history are preserved.
USE travel_agent_db;

CREATE TABLE IF NOT EXISTS sys_audit_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id        BIGINT UNSIGNED NULL,
  action          VARCHAR(64) NOT NULL,
  resource_type   VARCHAR(64) NOT NULL,
  resource_id     VARCHAR(64) NULL,
  request_method  VARCHAR(10) NOT NULL,
  request_path    VARCHAR(255) NOT NULL,
  before_data     JSON NULL,
  after_data      JSON NULL,
  trace_id        CHAR(36) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_actor_time (actor_id, created_at),
  KEY idx_audit_resource_time (resource_type, resource_id, created_at),
  KEY idx_audit_time (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '管理操作审计日志；保留执行人、资源变更前后数据及请求追踪号';

-- New menu parents. Existing menu IDs and codes remain unchanged.
INSERT IGNORE INTO sys_permission (id, parent_id, name, code, resource_type, path, icon, sort) VALUES
  (50, NULL, '智能体对话', 'chat', 'MENU', '/chat', 'message', 5),
  (51, 50, '会话管理', 'chat:session', 'MENU', '/chat/sessions', 'message', 1),
  (32, 30, '预订管理', 'order:booking', 'MENU', '/orders/booking', 'profile', 2);

-- Six visitor-facing permissions: chat read/write, create plans, and create/query bookings.
INSERT IGNORE INTO sys_permission (id, parent_id, name, code, resource_type, path, icon, sort) VALUES
  (501, 51, '查询会话', 'chat:session:query', 'BUTTON', NULL, NULL, 1),
  (502, 51, '查询消息', 'chat:message:query', 'BUTTON', NULL, NULL, 2),
  (503, 51, '发送消息', 'chat:message:add', 'BUTTON', NULL, NULL, 3),
  (404, 41, '创建行程', 'itinerary:plan:add', 'BUTTON', NULL, NULL, 4),
  (504, 32, '创建预订', 'order:booking:add', 'BUTTON', NULL, NULL, 1),
  (505, 32, '查询预订', 'order:booking:query', 'BUTTON', NULL, NULL, 2);

-- Keep the super administrator complete after adding new permission rows.
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.id IN (50, 51, 32, 501, 502, 503, 404, 504, 505)
 WHERE r.code = 'SUPER_ADMIN';

-- A tourist receives only the six explicitly listed business permissions.
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.code IN (
    'chat:session:query',
    'chat:message:query',
    'chat:message:add',
    'itinerary:plan:add',
    'order:booking:add',
    'order:booking:query'
  )
 WHERE r.code = 'TOURIST';
