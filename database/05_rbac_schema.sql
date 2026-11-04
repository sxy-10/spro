-- ============================================================================
-- 05_rbac_schema.sql  RBAC 权限引擎（组员2）
-- 依据：《旅游规划智能体 · Auth/RBAC 接口契约》(auth-rbac-api-openapi.json)
--       + 组内约定：权限码「模块:资源:操作」、复用 sys_user、新增 4 张关联表
-- 环境：MySQL 8.0 / InnoDB / utf8mb4
-- 执行顺序：01_schema.sql（建库建表）→ 本文件 → 02_seed.sql（业务演示数据，可选）
--
-- 契约对齐说明（给组员6/组员1/组员5）：
--   1. 响应包络 {code, message, data, trace_id}；401→业务码20012，403→业务码20013
--   2. 角色编码唯一，契约示例 TOURIST/ADMIN；本文件初始化 TOURIST / AGENCY_ADMIN /
--      SUPER_ADMIN 三个角色，管理员细分两级（旅行社管理员 / 超管），与分工一致
--   3. 权限资源两级：MENU（模块:资源，前端动态路由用，含 path/icon/sort）
--                   BUTTON（模块:资源:操作，按钮级控制，动词限 add/update/delete/query/export）
--   4. sys_user 复用不重建：
--      - status 列已存在（ACTIVE/DISABLED），契约里的 ENABLED/DISABLED 由服务层映射
--      - 旧 role 单列角色在本方案上线后弃用（保留仅为兼容 01_schema 的 CHECK 约束），
--        授权判定一律以 sys_user_role 关联表为准
--      - 登录用手机号：依赖 01_schema 已有 UNIQUE KEY uk_user_phone
-- ============================================================================

USE travel_agent_db;

-- 幂等重跑：按依赖反序清理（生产环境请勿执行本段）
DROP TABLE IF EXISTS sys_role_permission;
DROP TABLE IF EXISTS sys_user_role;
DROP TABLE IF EXISTS sys_permission;
DROP TABLE IF EXISTS sys_role;

-- ---------------------------------------------------------------------------
-- 1. sys_role 角色表
-- ---------------------------------------------------------------------------
CREATE TABLE sys_role (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键（即契约 role_id）',
  name        VARCHAR(50)  NOT NULL                COMMENT '角色名称，如 游客',
  code        VARCHAR(50)  NOT NULL                COMMENT '角色编码，唯一，如 TOURIST',
  description VARCHAR(200)     NULL                COMMENT '角色描述',
  status      ENUM('ENABLED','DISABLED') NOT NULL DEFAULT 'ENABLED' COMMENT '状态（契约 RoleUpdateReq.status）',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（契约 create_time）',
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_role_code (code)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '角色；用户与权限的多对多桥梁（RBAC 中间层）';


-- ---------------------------------------------------------------------------
-- 2. sys_permission 权限资源表（菜单 + 按钮两级树，parent_id 自关联）
-- ---------------------------------------------------------------------------
CREATE TABLE sys_permission (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键（即契约 permission_id）',
  parent_id     BIGINT UNSIGNED     NULL            COMMENT '父资源ID；顶层模块为 NULL',
  name          VARCHAR(50)  NOT NULL                COMMENT '资源名称，如 角色管理',
  code          VARCHAR(100) NOT NULL                COMMENT '权限编码，唯一：MENU=模块:资源，BUTTON=模块:资源:操作',
  resource_type ENUM('MENU','BUTTON') NOT NULL        COMMENT '资源类型（契约 PermissionCreateReq.resource_type）',
  path          VARCHAR(200)     NULL                COMMENT '菜单路由路径，仅 MENU，如 /admin/roles',
  icon          VARCHAR(100)     NULL                COMMENT '菜单图标，仅 MENU',
  sort          INT          NOT NULL DEFAULT 0      COMMENT '同级排序号，小的在前',
  status        ENUM('ENABLED','DISABLED') NOT NULL DEFAULT 'ENABLED' COMMENT '状态（契约 PermissionUpdateReq.status）',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_permission_code (code),
  KEY idx_permission_parent (parent_id),
  KEY idx_permission_type_status (resource_type, status),
  -- 注：自关联外键用 NO ACTION（默认行为，等效 RESTRICT）：
  --     删父节点前必须先处理子节点，避免一次误删把整棵权限子树连带删掉
  CONSTRAINT fk_permission_parent FOREIGN KEY (parent_id) REFERENCES sys_permission (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  -- 按钮必须带「模块:资源:操作」三段式编码；顶层模块（单段）不允许是 BUTTON
  CONSTRAINT chk_permission_button_code CHECK (
    resource_type <> 'BUTTON' OR code LIKE '%:%:%'
  )
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '权限资源树：MENU 支撑前端动态路由，BUTTON 支撑按钮级鉴权';


-- ---------------------------------------------------------------------------
-- 3. sys_user_role 用户-角色关联表（一个用户可多角色）
-- ---------------------------------------------------------------------------
CREATE TABLE sys_user_role (
  user_id    BIGINT UNSIGNED NOT NULL COMMENT '用户ID（sys_user.id，即契约 user_id）',
  role_id    BIGINT UNSIGNED NOT NULL COMMENT '角色ID（sys_role.id）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授予时间',
  PRIMARY KEY (user_id, role_id),
  KEY idx_user_role_role (role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES sys_user (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES sys_role (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '用户↔角色 关联；授权判定以此表为准，sys_user.role 旧列弃用';


-- ---------------------------------------------------------------------------
-- 4. sys_role_permission 角色-权限关联表（一个角色可多权限，全量覆盖式分配）
-- ---------------------------------------------------------------------------
CREATE TABLE sys_role_permission (
  role_id       BIGINT UNSIGNED NOT NULL COMMENT '角色ID（sys_role.id）',
  permission_id BIGINT UNSIGNED NOT NULL COMMENT '权限资源ID（sys_permission.id）',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授予时间',
  PRIMARY KEY (role_id, permission_id),
  KEY idx_rp_permission (permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES sys_role (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES sys_permission (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '角色↔权限 关联；PUT /roles/{id}/permissions 全量覆盖本表对应行';


-- ============================================================================
-- 种子数据（固定显式ID，保证组内各环境一致；重复执行前先清空关联数据）
-- ============================================================================

-- 4.1 初始角色（与分工方案一致：游客 / 旅行社管理员 / 超管）
INSERT INTO sys_role (id, name, code, description) VALUES
  (1, '游客',       'TOURIST',      'C端注册用户，仅使用前台功能'),
  (2, '旅行社管理员', 'AGENCY_ADMIN', 'B端用户，管理本社线路与订单'),
  (3, '超级管理员',  'SUPER_ADMIN',  '平台方，拥有全部后台权限');

-- 4.2 权限资源树
-- 模块前缀：system=系统管理  route=线路  order=订单  itinerary=行程
-- 操作动词：add / update / delete / query / export
INSERT INTO sys_permission (id, parent_id, name, code, resource_type, path, icon, sort) VALUES
  -- ── system 系统管理 ──
  (10, NULL, '系统管理',   'system',            'MENU', '/admin',            'setting', 1),
  (11, 10,   '角色管理',   'system:role',       'MENU', '/admin/roles',      'idcard',  1),
  (12, 10,   '用户管理',   'system:user',       'MENU', '/admin/users',      'team',    2),
  (13, 10,   '权限配置',   'system:permission', 'MENU', '/admin/permissions','apartment',3),
  -- system:role 按钮
  (101, 11, '新增角色', 'system:role:add',    'BUTTON', NULL, NULL, 1),
  (102, 11, '编辑角色', 'system:role:update', 'BUTTON', NULL, NULL, 2),
  (103, 11, '删除角色', 'system:role:delete', 'BUTTON', NULL, NULL, 3),
  (104, 11, '查询角色', 'system:role:query',  'BUTTON', NULL, NULL, 4),
  (105, 11, '导出角色', 'system:role:export', 'BUTTON', NULL, NULL, 5),
  -- system:user 按钮
  (111, 12, '新建用户', 'system:user:add',    'BUTTON', NULL, NULL, 1),
  (112, 12, '编辑用户', 'system:user:update', 'BUTTON', NULL, NULL, 2),
  (113, 12, '删除用户', 'system:user:delete', 'BUTTON', NULL, NULL, 3),
  (114, 12, '查询用户', 'system:user:query',  'BUTTON', NULL, NULL, 4),
  (115, 12, '导出用户', 'system:user:export', 'BUTTON', NULL, NULL, 5),
  -- system:permission 按钮
  (121, 13, '新增权限资源', 'system:permission:add',    'BUTTON', NULL, NULL, 1),
  (122, 13, '编辑权限资源', 'system:permission:update', 'BUTTON', NULL, NULL, 2),
  (123, 13, '删除权限资源', 'system:permission:delete', 'BUTTON', NULL, NULL, 3),
  (124, 13, '查询权限资源', 'system:permission:query',  'BUTTON', NULL, NULL, 4),

  -- ── route 线路管理 ──
  (20, NULL, '线路管理', 'route',      'MENU', '/routes',       'compass', 2),
  (21, 20,   '线路列表', 'route:line', 'MENU', '/routes/lines', 'unordered-list', 1),
  (201, 21, '发布线路', 'route:line:add',    'BUTTON', NULL, NULL, 1),
  (202, 21, '编辑线路', 'route:line:update', 'BUTTON', NULL, NULL, 2),
  (203, 21, '下架线路', 'route:line:delete', 'BUTTON', NULL, NULL, 3),
  (204, 21, '查询线路', 'route:line:query',  'BUTTON', NULL, NULL, 4),
  (205, 21, '导出线路', 'route:line:export', 'BUTTON', NULL, NULL, 5),

  -- ── order 订单管理 ──
  (30, NULL, '订单管理', 'order',        'MENU', '/orders',        'profile', 3),
  (31, 30,   '订单列表', 'order:manage', 'MENU', '/orders/manage', 'bars',    1),
  (301, 31, '查询订单', 'order:manage:query',  'BUTTON', NULL, NULL, 1),
  (302, 31, '处理订单', 'order:manage:update', 'BUTTON', NULL, NULL, 2),
  (303, 31, '导出订单', 'order:manage:export', 'BUTTON', NULL, NULL, 3),

  -- ── itinerary 行程管理 ──
  (40, NULL, '行程管理', 'itinerary',      'MENU', '/itineraries',       'carry-out', 4),
  (41, 40,   '行程方案', 'itinerary:plan', 'MENU', '/itineraries/plans', 'file-text', 1),
  (401, 41, '查询行程', 'itinerary:plan:query',  'BUTTON', NULL, NULL, 1),
  (402, 41, '修改行程', 'itinerary:plan:update', 'BUTTON', NULL, NULL, 2),
  (403, 41, '删除行程', 'itinerary:plan:delete', 'BUTTON', NULL, NULL, 3);

-- 4.3 角色-权限分配
-- 超级管理员：全部权限
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 3, id FROM sys_permission;

-- 旅行社管理员：线路 + 订单 两棵子树（不含 system / itinerary 后台）
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 2, id FROM sys_permission
WHERE id IN (20, 21, 201, 202, 203, 204, 205,
             30, 31, 301, 302, 303);

-- 游客：无后台权限（前台功能不走 BUTTON 鉴权，由登录态控制）
-- （如后续需要，可在此为角色 1 追加行）

-- ============================================================================
-- 验证查询（跑通下面三条即设计正确）
-- ============================================================================

-- V1 查某用户的所有权限码（中间件核心 SQL：两跳 join）
--    SELECT DISTINCT p.code, p.resource_type
--    FROM sys_user_role ur
--    JOIN sys_role_permission rp ON rp.role_id = ur.role_id
--    JOIN sys_permission p       ON p.id = rp.permission_id
--    WHERE ur.user_id = 1
--      AND p.status = 'ENABLED'
--      AND p.resource_type = 'BUTTON';

-- V2 查某用户的角色编码（req.user.roles 用）
--    SELECT r.code, r.name
--    FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
--    WHERE ur.user_id = 1 AND r.status = 'ENABLED';

-- V3 权限树完整性：每个 BUTTON 都有父 MENU，编码段数与类型匹配
--    SELECT id, code, resource_type FROM sys_permission
--    WHERE (resource_type = 'BUTTON' AND parent_id IS NULL)
--       OR (resource_type = 'BUTTON' AND code NOT LIKE '%:%:%');
