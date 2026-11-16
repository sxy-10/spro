-- ============================================================================
--  旅游规划智能体系统 · 07_web_extension.sql
--  用途：支撑 B 端旅行社 Web 与平台方 Web 的扩展表、扩展权限码。
--  执行：在 01 → 02 → 03 → 04 → 05 → 06 之后执行一次（可重复执行，幂等）。
--  设计对齐：docs/specs/三端实施方案/三端实施方案.md §6（原型预留模块）与
--           demo/Web端原型设计说明.md §3/§4/§6。
--  内容：
--    A. 表扩展（travel_product 审核字段 / tour_order 确认与退款字段）
--    B. 新表：souvenir / guide / tour_team / tour_team_member / settlement /
--            agency_customer_note / sys_dict / sys_audit_log / ai_service_config
--    C. 扩展 RBAC 权限码（特产 / 客户 / 导游 / 团队 / 财务 / 设置 / 机构 /
--       审核 / 平台财务 / AI 服务）并授予对应角色
-- ============================================================================

SET NAMES utf8mb4;
USE travel_agent_db;

-- ---------------------------------------------------------------------------
-- A. 既有表扩展
-- ---------------------------------------------------------------------------

-- A1. 线路产品：审核字段（平台审核通过后方可对外展示）
ALTER TABLE travel_product
  ADD COLUMN audit_status ENUM('NONE','PENDING','APPROVED','REJECTED')
    NOT NULL DEFAULT 'NONE' COMMENT '审核状态：未提交/待审核/已通过/已驳回',
  ADD COLUMN audit_remark VARCHAR(255) NULL COMMENT '审核备注（驳回理由回传提交方）',
  ADD COLUMN audited_by   BIGINT UNSIGNED NULL COMMENT '审核人（平台管理员）',
  ADD COLUMN audited_at   DATETIME NULL COMMENT '审核时间';

-- 存量在售线路视为已通过审核（平滑兼容既有数据）
UPDATE travel_product SET audit_status = 'APPROVED' WHERE status = 'ON_SALE' AND audit_status = 'NONE';

-- A2. 订单：确认处理与退款、结算关联
--    状态机扩展：PENDING(待支付) → PAID(待确认) → CONFIRMED(已确认)
--               → COMPLETED(已完成)；CANCELLED / REFUNDED 分支
ALTER TABLE tour_order
  MODIFY COLUMN status
    ENUM('PENDING','PAID','CONFIRMED','CANCELLED','COMPLETED','REFUNDED')
    NOT NULL DEFAULT 'PENDING'
    COMMENT '订单状态；PAID=已支付待社管确认，CONFIRMED=社管已确认',
  ADD COLUMN confirmed_at  DATETIME NULL COMMENT '社管确认时间',
  ADD COLUMN confirm_remark VARCHAR(255) NULL COMMENT '确认处理备注',
  ADD COLUMN refunded_at   DATETIME NULL COMMENT '退款完成时间',
  ADD COLUMN refund_reason VARCHAR(255) NULL COMMENT '退款原因',
  ADD COLUMN settlement_id BIGINT UNSIGNED NULL COMMENT '归属结算单（平台侧回填）',
  ADD INDEX idx_order_confirmed (status, confirmed_at);

-- ---------------------------------------------------------------------------
-- B. 新表
-- ---------------------------------------------------------------------------

-- B1. souvenir 特产（原型预留模块落地；与线路平级的第二种产品形态）
CREATE TABLE IF NOT EXISTS souvenir (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  product_no    VARCHAR(32)     NOT NULL                COMMENT '特产编号，如 sou_001',
  agency_id     BIGINT UNSIGNED NOT NULL                COMMENT '所属旅行社',
  name          VARCHAR(100)    NOT NULL                COMMENT '特产名称',
  category      VARCHAR(20)     NOT NULL DEFAULT '特色食品' COMMENT '分类：特色食品/手工艺品/茶饮/其他',
  link_route_id BIGINT UNSIGNED     NULL                COMMENT '关联线路（可选）',
  price         DECIMAL(10,2)   NOT NULL                COMMENT '售价（元）',
  stock         INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '库存',
  sales         INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '销量',
  status        ENUM('ON_SALE','OFF_SALE') NOT NULL DEFAULT 'OFF_SALE' COMMENT '在售/下架（逻辑下架）',
  audit_status  ENUM('NONE','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'NONE' COMMENT '审核状态',
  audit_remark  VARCHAR(255)    NULL,
  audited_by    BIGINT UNSIGNED NULL,
  audited_at    DATETIME        NULL,
  description   TEXT            NULL                    COMMENT '图文详情',
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_souvenir_no (product_no),
  KEY idx_souvenir_agency (agency_id, status),
  CONSTRAINT fk_souvenir_agency FOREIGN KEY (agency_id) REFERENCES travel_agency (id) ON DELETE RESTRICT,
  CONSTRAINT fk_souvenir_route  FOREIGN KEY (link_route_id) REFERENCES travel_product (id) ON DELETE SET NULL,
  CONSTRAINT chk_souvenir_price CHECK (price >= 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '特产（B 端可售商品第二形态，平台审核治理）';

-- B2. guide 导游档案
CREATE TABLE IF NOT EXISTS guide (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agency_id   BIGINT UNSIGNED NOT NULL COMMENT '所属旅行社',
  name        VARCHAR(50)  NOT NULL COMMENT '姓名',
  gender      ENUM('男','女') NOT NULL DEFAULT '男' COMMENT '性别',
  phone       VARCHAR(20)  NOT NULL COMMENT '联系电话（展示脱敏）',
  license_no  VARCHAR(32)  NOT NULL COMMENT '导游证号（唯一）',
  specialty   VARCHAR(50)      NULL COMMENT '擅长线路类型，如 自然风光/户外徒步',
  bio         VARCHAR(500)     NULL COMMENT '个人简介',
  status      ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '在职/停用；停用不可指派新团',
  team_count  INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计带团数',
  rating      DECIMAL(2,1) NOT NULL DEFAULT 5.0 COMMENT '评分 0-5',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_guide_license (license_no),
  KEY idx_guide_agency (agency_id, status),
  CONSTRAINT fk_guide_agency FOREIGN KEY (agency_id) REFERENCES travel_agency (id) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '导游档案（出团资源）';

-- B3. tour_team 团队编组
CREATE TABLE IF NOT EXISTS tour_team (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_no      VARCHAR(32)  NOT NULL COMMENT '团队编号，如 T-20261120-01',
  agency_id    BIGINT UNSIGNED NOT NULL COMMENT '所属旅行社',
  route_id     BIGINT UNSIGNED NULL COMMENT '关联线路',
  travel_date  DATE             NULL COMMENT '出行日期',
  guide_id     BIGINT UNSIGNED NULL COMMENT '指派导游（仅在职导游）',
  max_members  INT UNSIGNED NOT NULL DEFAULT 20 COMMENT '成团人数上限',
  status       ENUM('RECRUITING','FULL','DEPARTED','FINISHED') NOT NULL DEFAULT 'RECRUITING'
               COMMENT '待成团/已成团/出行中/已结束',
  remark       VARCHAR(255) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_team_no (team_no),
  KEY idx_team_agency (agency_id, status),
  KEY idx_team_route (route_id, travel_date),
  CONSTRAINT fk_team_agency FOREIGN KEY (agency_id) REFERENCES travel_agency (id) ON DELETE RESTRICT,
  CONSTRAINT fk_team_route  FOREIGN KEY (route_id)  REFERENCES travel_product (id) ON DELETE SET NULL,
  CONSTRAINT fk_team_guide  FOREIGN KEY (guide_id)  REFERENCES guide (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '出团团队编组';

-- B4. tour_team_member 团队成员（与订单游客对应）
CREATE TABLE IF NOT EXISTS tour_team_member (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id       BIGINT UNSIGNED NOT NULL COMMENT '所属团队',
  order_id      BIGINT UNSIGNED NULL COMMENT '来源订单（可空：手工录入成员）',
  member_name   VARCHAR(50)  NULL COMMENT '游客脱敏称呼',
  member_phone  VARCHAR(20)  NULL COMMENT '游客手机号（存储原文，展示脱敏）',
  people_count  INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '该来源订单出行人数',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_member_team (team_id),
  CONSTRAINT fk_member_team  FOREIGN KEY (team_id)  REFERENCES tour_team (id) ON DELETE CASCADE,
  CONSTRAINT fk_member_order FOREIGN KEY (order_id) REFERENCES tour_order (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '团队成员名单';

-- B5. settlement 结算单（平台侧发起，佣金可配置）
CREATE TABLE IF NOT EXISTS settlement (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  settlement_no     VARCHAR(32)  NOT NULL COMMENT '结算单号，如 ST202611-001',
  agency_id         BIGINT UNSIGNED NOT NULL COMMENT '结算旅行社',
  period_label      VARCHAR(30)  NOT NULL COMMENT '结算周期标签，如 2026-11 上半月',
  order_count       INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '订单笔数',
  gross_amount      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '应收金额',
  commission_rate   DECIMAL(5,4)  NOT NULL DEFAULT 0.0500 COMMENT '平台佣金比例',
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '平台佣金',
  payable_amount    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '应付金额 = 应收 - 佣金',
  status            ENUM('PENDING','SETTLED','REJECTED') NOT NULL DEFAULT 'PENDING'
                    COMMENT '待结算/已结算/已驳回',
  reject_reason     VARCHAR(255) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at        DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_settlement_no (settlement_no),
  KEY idx_settlement_agency (agency_id, status),
  CONSTRAINT fk_settlement_agency FOREIGN KEY (agency_id) REFERENCES travel_agency (id) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '平台-旅行社结算单';

-- B6. agency_customer_note 客户跟进备注（社内可见）
CREATE TABLE IF NOT EXISTS agency_customer_note (
  agency_id  BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL COMMENT '游客 sys_user.id',
  note       VARCHAR(500) NOT NULL DEFAULT '' COMMENT '跟进备注',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (agency_id, user_id),
  CONSTRAINT fk_note_agency FOREIGN KEY (agency_id) REFERENCES travel_agency (id) ON DELETE CASCADE,
  CONSTRAINT fk_note_user   FOREIGN KEY (user_id)   REFERENCES sys_user (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '旅行社对客户的社内跟进备注';

-- B7. sys_dict 系统字典
CREATE TABLE IF NOT EXISTS sys_dict (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dict_type VARCHAR(30)  NOT NULL COMMENT '字典类型，如 style_tag / departure_city',
  dict_key  VARCHAR(50)  NOT NULL COMMENT '字典键',
  dict_value VARCHAR(100) NOT NULL COMMENT '字典值（展示文案）',
  sort      INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dict (dict_type, dict_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '系统业务字典';

-- B8. sys_audit_log 操作审计日志（兼容 router.ts 既有写入列与扩展写入列）
CREATE TABLE IF NOT EXISTS sys_audit_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id      BIGINT UNSIGNED NULL COMMENT '操作人（router.ts 既有写入）',
  operator_id   BIGINT UNSIGNED NULL COMMENT '操作人（扩展写入）',
  operator_name VARCHAR(50)  NULL COMMENT '操作人名称快照',
  action        VARCHAR(50)  NOT NULL COMMENT '动作，如 CREATE/确认订单/审核通过',
  resource_type VARCHAR(30)  NULL COMMENT '资源类型（既有写入）',
  resource_id   VARCHAR(64)  NULL COMMENT '资源 ID（既有写入）',
  object_type   VARCHAR(30)  NULL COMMENT '对象类型（扩展写入）',
  object_no     VARCHAR(64)  NULL COMMENT '对象编号（扩展写入）',
  request_method VARCHAR(10) NULL,
  request_path  VARCHAR(200) NULL,
  after_data    JSON         NULL,
  detail        VARCHAR(500) NULL COMMENT '详情摘要',
  trace_id      VARCHAR(64)  NULL COMMENT '链路 ID（与响应 X-Trace-Id 对账）',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_object (object_type, object_no)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '操作审计日志（只增不改）';

-- B9. ai_service_config AI 服务配置（单行配置 + 版本字段）
CREATE TABLE IF NOT EXISTS ai_service_config (
  id          TINYINT UNSIGNED NOT NULL DEFAULT 1,
  persona     VARCHAR(255) NOT NULL DEFAULT 'travel-agent v2.3' COMMENT '人设/提示词版本',
  model_params VARCHAR(255) NOT NULL DEFAULT '温度 0.7 · 最大长度 2048' COMMENT '模型参数摘要',
  tools_json  JSON         NULL COMMENT '五大工具开关 {"attractions":true,...}',
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = 'AI 智能服务配置（平台侧）';

INSERT INTO ai_service_config (id, persona, model_params, tools_json)
  VALUES (1, 'travel-agent v2.3', '温度 0.7 · 最大长度 2048',
          JSON_OBJECT('attractions', TRUE, 'transport', TRUE, 'hotel', TRUE, 'food', TRUE, 'weather', TRUE))
  ON DUPLICATE KEY UPDATE persona = VALUES(persona);

-- B10. travel_agency 机构简介与通知偏好、佣金比例
ALTER TABLE travel_agency
  ADD COLUMN intro VARCHAR(500) NULL COMMENT '社简介',
  ADD COLUMN notify_prefs JSON NULL COMMENT '通知偏好开关',
  ADD COLUMN commission_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0500 COMMENT '平台佣金比例';

-- ---------------------------------------------------------------------------
-- C. 扩展 RBAC 权限码
-- ---------------------------------------------------------------------------

INSERT INTO sys_permission (id, parent_id, name, code, resource_type, path, icon, sort) VALUES
  -- ── 特产管理（挂在线路模块下） ──
  (500, 20, '特产管理', 'route:souvenir',        'MENU',   '/agency/specialties', 'gift', 2),
  (501, 500, '特产查询', 'route:souvenir:query',  'BUTTON', NULL, NULL, 1),
  (502, 500, '特产新增', 'route:souvenir:add',    'BUTTON', NULL, NULL, 2),
  (503, 500, '特产编辑', 'route:souvenir:update', 'BUTTON', NULL, NULL, 3),
  (504, 500, '特产下架', 'route:souvenir:delete', 'BUTTON', NULL, NULL, 4),

  -- ── 客户管理 ──
  (510, NULL, '客户管理', 'customer',                'MENU',   '/agency/customers', 'user', 5),
  (511, 510, '客户查询',   'customer:customer:query', 'BUTTON', NULL, NULL, 1),
  (512, 510, '客户备注',   'customer:customer:update', 'BUTTON', NULL, NULL, 2),

  -- ── 导游与团队 ──
  (520, NULL, '导游管理', 'guide',                 'MENU',   '/agency/guides', 'team', 6),
  (521, 520, '导游查询',   'guide:guide:query',     'BUTTON', NULL, NULL, 1),
  (522, 520, '导游新增',   'guide:guide:add',       'BUTTON', NULL, NULL, 2),
  (523, 520, '导游编辑',   'guide:guide:update',    'BUTTON', NULL, NULL, 3),
  (524, 520, '导游停用',   'guide:guide:delete',    'BUTTON', NULL, NULL, 4),
  (530, 520, '团队编组',   'team',                  'MENU',   '/agency/teams', 'bars', 2),
  (531, 530, '团队查询',   'team:team:query',       'BUTTON', NULL, NULL, 1),
  (532, 530, '团队创建',   'team:team:add',         'BUTTON', NULL, NULL, 2),
  (533, 530, '团队调整',   'team:team:update',      'BUTTON', NULL, NULL, 3),

  -- ── B 端财务管理 ──
  (540, NULL, '财务管理', 'finance:agency',        'MENU',   '/agency/finance', 'wallet', 7),
  (541, 540, '财务查询',   'finance:agency:query',  'BUTTON', NULL, NULL, 1),
  (542, 540, '财务导出',   'finance:agency:export', 'BUTTON', NULL, NULL, 2),

  -- ── B 端旅行社设置 ──
  (550, NULL, '旅行社设置', 'agency:settings',        'MENU',   '/agency/settings', 'gear', 8),
  (551, 550, '资料维护',     'agency:settings:update', 'BUTTON', NULL, NULL, 1),
  (552, 550, '成员查询',     'agency:member:query',    'BUTTON', NULL, NULL, 2),
  (553, 550, '成员新增',     'agency:member:add',      'BUTTON', NULL, NULL, 3),
  (554, 550, '成员管理',     'agency:member:update',   'BUTTON', NULL, NULL, 4),

  -- ── 平台：机构治理 ──
  (560, 10, '旅行社管理', 'system:agency',        'MENU',   '/platform/agencies', 'shop', 4),
  (561, 560, '机构查询',   'system:agency:query',  'BUTTON', NULL, NULL, 1),
  (562, 560, '机构新增',   'system:agency:add',    'BUTTON', NULL, NULL, 2),
  (563, 560, '机构编辑',   'system:agency:update', 'BUTTON', NULL, NULL, 3),

  -- ── 平台：产品审核 ──
  (570, NULL, '产品审核', 'audit:center',        'MENU',   '/platform/audits', 'shield', 9),
  (571, 570, '线路审核',   'route:line:audit',    'BUTTON', NULL, NULL, 1),
  (572, 570, '特产审核',   'route:souvenir:audit', 'BUTTON', NULL, NULL, 2),

  -- ── 平台：财务与结算 ──
  (580, NULL, '财务与结算', 'finance:platform',          'MENU',   '/platform/finance', 'wallet', 10),
  (581, 580, '结算查询',     'finance:platform:query',    'BUTTON', NULL, NULL, 1),
  (582, 580, '确认结算',     'finance:platform:settle',   'BUTTON', NULL, NULL, 2),
  (583, 580, '结算导出',     'finance:platform:export',   'BUTTON', NULL, NULL, 3),

  -- ── 平台：AI 智能服务 ──
  (590, NULL, 'AI 智能服务', 'ai:service',          'MENU',   '/platform/ai-service', 'spark', 11),
  (591, 590, '服务监控',     'ai:service:query',    'BUTTON', NULL, NULL, 1),
  (592, 590, '服务配置',     'ai:service:config',   'BUTTON', NULL, NULL, 2),

  -- ── 行程方案：AI 生成（补 05 缺失的 add 动作） ──
  (404, 41, '生成行程方案', 'itinerary:plan:add',  'BUTTON', NULL, NULL, 4)
ON DUPLICATE KEY UPDATE name = VALUES(name), path = VALUES(path);

-- 4.x 角色-权限分配（幂等：先删后插目标区间）
DELETE FROM sys_role_permission WHERE permission_id BETWEEN 500 AND 599;

-- 超级管理员：全部扩展权限
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 3, id FROM sys_permission WHERE id BETWEEN 500 AND 599;

-- 旅行社管理员：特产/客户/导游/团队/B端财务/设置 全量 + 行程规划树（AI 智能规划页）
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 2, id FROM sys_permission
WHERE id IN (500,501,502,503,504, 510,511,512, 520,521,522,523,524,530,531,532,533,
             540,541,542, 550,551,552,553,554,
             40,41,401,402,403,404);

-- AI 生成行程：超级管理员同样需要显式授权（404 不在 500-599 区间内）
INSERT IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (3, 404);

-- 新增角色：业务专员（AGENCY_STAFF）——只读 + 订单处理
INSERT INTO sys_role (id, name, code, description)
  VALUES (4, '业务专员', 'AGENCY_STAFF', '本社产品维护与订单处理（只读为主）')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 4, id FROM sys_permission
WHERE id IN (21,204,  31,301,302,  500,501,504,  510,511,  520,521,  530,531,  540,541,  550,552)
ON DUPLICATE KEY UPDATE role_id = role_id;

INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (1, 2);
