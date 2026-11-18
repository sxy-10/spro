-- Additive RBAC completion for member 2.
-- Run after 01_schema.sql and 05_rbac_schema.sql.
USE travel_agent_db;

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
SELECT parent.id, child.name, child.code, 'BUTTON', NULL, NULL, child.sort
  FROM (
    SELECT 'itinerary:plan' AS parent_code, '创建行程' AS name, 'itinerary:plan:add' AS code, 4 AS sort
    UNION ALL SELECT 'itinerary:plan', '导出行程', 'itinerary:plan:export', 5
    UNION ALL SELECT 'order:manage', '创建订单', 'order:add', 4
    UNION ALL SELECT 'order:manage', '查询订单', 'order:query', 5
    UNION ALL SELECT 'order:manage', '秒杀下单', 'order:seckill', 6
  ) AS child
  JOIN sys_permission parent ON parent.code = child.parent_code;

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
VALUES (NULL, '景点评价', 'comment', 'MENU', '/spots/comments', 'comment', 6);
INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, sort)
SELECT id, '发表评论', 'comment:add', 'BUTTON', 1
  FROM sys_permission WHERE code = 'comment';

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
VALUES (NULL, '智能体对话', 'chat', 'MENU', '/chat', 'message', 5);
INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
SELECT id, '会话管理', 'chat:session', 'MENU', '/chat/sessions', 'message', 1
  FROM sys_permission WHERE code = 'chat';
INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, sort)
SELECT parent.id, child.name, child.code, 'BUTTON', child.sort
  FROM (
    SELECT 'chat:session' AS parent_code, '查询会话' AS name, 'chat:session:query' AS code, 1 AS sort
    UNION ALL SELECT 'chat:session', '查询消息', 'chat:message:query', 2
    UNION ALL SELECT 'chat:session', '发送消息', 'chat:message:add', 3
  ) AS child
  JOIN sys_permission parent ON parent.code = child.parent_code;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.code IN (
    'itinerary', 'itinerary:plan', 'itinerary:plan:query',
    'itinerary:plan:add', 'itinerary:plan:update', 'itinerary:plan:export',
    'order:add', 'order:query', 'comment:add', 'order:seckill',
    'chat', 'chat:session', 'chat:session:query', 'chat:message:query', 'chat:message:add',
    'order:booking:add', 'order:booking:query'
  )
 WHERE r.code = 'TOURIST';

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.code IN (
    'itinerary:plan:add', 'itinerary:plan:export', 'order:add',
    'order:query', 'comment:add', 'order:seckill',
    'chat', 'chat:session', 'chat:session:query', 'chat:message:query', 'chat:message:add'
  )
 WHERE r.code = 'SUPER_ADMIN';
