USE travel_agent_db;

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
VALUES (NULL, '即时通讯', 'im', 'MENU', '/im', 'message', 6);

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
SELECT id, '会话管理', 'im:session', 'MENU', '/im/sessions', 'message', 1
  FROM sys_permission WHERE code = 'im';

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
SELECT id, '消息管理', 'im:message', 'MENU', '/im/messages', 'comment', 2
  FROM sys_permission WHERE code = 'im';

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, sort)
SELECT parent.id, permissions.name, permissions.code, 'BUTTON', permissions.sort
  FROM (
    SELECT 'im:session' AS parent_code, '查询会话' AS name, 'im:session:query' AS code, 1 AS sort
    UNION ALL SELECT 'im:message', '发送消息', 'im:message:send', 1
    UNION ALL SELECT 'im:message', '查询消息', 'im:message:query', 2
    UNION ALL SELECT 'im:session', '管理会话', 'im:conv:manage', 2
    UNION ALL SELECT 'im', '实时统计查询', 'analytics:live:query', 3
  ) AS permissions
  JOIN sys_permission parent ON parent.code = permissions.parent_code;

INSERT IGNORE INTO sys_role (name, code, description, status)
VALUES ('业务专员', 'AGENT', '即时通讯与线路业务操作员', 'ENABLED');

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.code IN (
    'im', 'im:session', 'im:message',
    'im:session:query', 'im:message:send', 'im:message:query'
  )
 WHERE r.code = 'TOURIST';

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.code IN (
    'im', 'im:session', 'im:message',
    'im:session:query', 'im:message:send', 'im:message:query',
    'im:conv:manage', 'analytics:live:query'
  )
 WHERE r.code IN ('AGENCY_ADMIN', 'AGENT', 'SUPER_ADMIN');

DELETE rp
  FROM sys_role_permission rp
  JOIN sys_role r ON r.id = rp.role_id
  JOIN sys_permission p ON p.id = rp.permission_id
 WHERE r.code = 'TOURIST' AND p.code = 'route:line:query';
