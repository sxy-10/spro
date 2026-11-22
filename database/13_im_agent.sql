USE travel_agent_db;

-- ============================================================================
--  13_im_agent.sql —— 客服接待域（第 5 棒补漏）
--
--  背景：11_im.sql 只解决了「消息怎么存、怎么发号、怎么已读」，没有解决
--        「这条会话归谁接待、客户在等多久、接待完能不能评价」。
--        原本客服台的接单状态只能放 localStorage，换台机器就丢；会话列表
--        也只能看到「自己已参与的会话」，看不到待接入的池子。
--
--  本脚本只做加法，不改任何已有列的类型与语义：
--    1. im_conversation 补 6 列（归属 + 生命周期），补齐「待接入 / 接待中 / 已结束」
--    2. im_agent_status  客服接待状态（接待中 / 小休 / 离线 + 并发上限），落库
--    3. im_quick_reply   快捷话术（owner_id IS NULL = 全局公共话术）
--    4. im_rating        会话满意度评价（一条会话每人只能评一次）
--    5. 权限码 im:agent / im:quick_reply / im:rating 及角色授权
--
--  幂等：所有 DDL 走「information_schema 判断 + PREPARE 动态执行」，
--        重复执行不会报 duplicate column，也不会中断后续 INSERT。
--        这样多语句客户端（migrate.ts 一次性 query 整个文件）重跑安全。
--
--  待接入口径（全项目唯一口径，前端/接口/文档都按这个）：
--      assignee_id IS NULL AND status = 'ACTIVE'
--  这条口径对存量数据天然成立：11_im.sql 建出来的历史会话 assignee_id 为 NULL，
--  会被视作「无人接待」，客服在工作台点「接入」即可认领。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. im_conversation 补列：归属与生命周期
-- ---------------------------------------------------------------------------
-- 注：动态 SQL 里的字符串要用 '' 转义，列注释一律不写在动态语句里
--     （注释本身要带引号，套两层引号极易写错，注释统一放在本文件的文字说明中）
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'im_conversation' AND COLUMN_NAME = 'assignee_id') = 0,
  'ALTER TABLE im_conversation
     ADD COLUMN assignee_id BIGINT UNSIGNED NULL,
     ADD COLUMN status ENUM(''ACTIVE'',''CLOSED'') NOT NULL DEFAULT ''ACTIVE'',
     ADD COLUMN queued_at DATETIME(3) NULL,
     ADD COLUMN assigned_at DATETIME(3) NULL,
     ADD COLUMN closed_at DATETIME(3) NULL,
     ADD COLUMN agent_note VARCHAR(255) NULL,
     ADD KEY idx_im_conv_pool (status, assignee_id, last_message_at),
     ADD KEY idx_im_conv_assignee (assignee_id, status, last_message_at),
     ADD CONSTRAINT fk_im_conv_assignee FOREIGN KEY (assignee_id) REFERENCES sys_user(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 存量会话补 queued_at，让「已等待时长」有起点可算（首次执行才有实际作用）
UPDATE im_conversation
   SET queued_at = COALESCE(queued_at, last_message_at, created_at)
 WHERE assignee_id IS NULL AND status = 'ACTIVE' AND queued_at IS NULL;


-- ---------------------------------------------------------------------------
-- 2. im_agent_status 客服接待状态
--
--    为什么不复用 im_device / presence：
--      im_online:* 是 Redis 的「连接是否活着」（TTL 60s），进程被 kill 就消失；
--      「我今天在不在接单」「最多同时接几个」是业务意愿，必须落库、跨设备一致。
--      两者组合出真正的接待能力：Redis 在线 + 库里 ONLINE + 未超并发上限。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS im_agent_status (
  user_id          BIGINT UNSIGNED NOT NULL COMMENT '客服用户ID',
  status           ENUM('ONLINE','AWAY','OFFLINE') NOT NULL DEFAULT 'OFFLINE'
                   COMMENT 'ONLINE=接待中 AWAY=小休（不再分新单） OFFLINE=离线',
  max_concurrent   TINYINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '同时接待上限（1..20）',
  last_heartbeat_at DATETIME(3) NULL COMMENT '最近一次心跳/状态变更时间',
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  KEY idx_im_agent_status (status, last_heartbeat_at),
  CONSTRAINT fk_im_agent_status_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='客服接待状态；与 Redis 在线状态组合判断「能不能分配新会话」';


-- ---------------------------------------------------------------------------
-- 3. im_quick_reply 快捷话术
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS im_quick_reply (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id   BIGINT UNSIGNED NULL COMMENT 'NULL = 全局公共话术（所有人可见）；非 NULL = 个人话术',
  category   VARCHAR(32) NOT NULL DEFAULT '通用' COMMENT '分类，前端按此分组',
  content    VARCHAR(500) NOT NULL COMMENT '话术正文',
  sort       INT NOT NULL DEFAULT 0 COMMENT '同分组内排序，小的在前',
  enabled    TINYINT(1) NOT NULL DEFAULT 1,
  seed_key   VARCHAR(64) NULL COMMENT '内置话术去重键；个人话术为 NULL（唯一键不约束 NULL）',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_im_quick_reply_seed (seed_key),
  KEY idx_im_quick_reply_owner (owner_id, enabled, sort),
  CONSTRAINT fk_im_quick_reply_owner FOREIGN KEY (owner_id) REFERENCES sys_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='客服快捷话术；owner_id 为 NULL 的是运营维护的公共话术';


-- ---------------------------------------------------------------------------
-- 4. im_rating 会话满意度评价
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS im_rating (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  rater_id        BIGINT UNSIGNED NOT NULL COMMENT '评价人（游客）',
  agent_id        BIGINT UNSIGNED NULL COMMENT '被评客服；取评价时刻的 assignee_id',
  score           TINYINT UNSIGNED NOT NULL COMMENT '1..5 星',
  comment         VARCHAR(500) NULL,
  tags            JSON NULL COMMENT '标签数组，如 ["响应快","讲解清楚"]',
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_im_rating_conv_rater (conversation_id, rater_id),
  KEY idx_im_rating_agent (agent_id, created_at),
  CONSTRAINT fk_im_rating_conversation FOREIGN KEY (conversation_id) REFERENCES im_conversation(id) ON DELETE CASCADE,
  CONSTRAINT fk_im_rating_rater FOREIGN KEY (rater_id) REFERENCES sys_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_im_rating_agent FOREIGN KEY (agent_id) REFERENCES sys_user(id) ON DELETE SET NULL,
  CONSTRAINT chk_im_rating_score CHECK (score BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='会话满意度评价；一条会话每人只能评一次（唯一键兜底）';


-- ---------------------------------------------------------------------------
-- 5. 权限码
--
--    权限码形态必须与 auth/permissionCode.ts 的折算一致：
--      requireAction('im:agent', 'query')  → 要求 sys_permission.code = 'im:agent:query'
--      requireAction('im:rating', 'add')   → 要求 sys_permission.code = 'im:rating:add'
--    父节点 im 已由 12_im_perm.sql 建好，本脚本只挂子节点。
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
VALUES (NULL, '客服接待', 'im:agent', 'MENU', '/im/agent', 'customerservice', 7);

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
SELECT parent.id, '快捷话术', 'im:quick_reply', 'MENU', '/im/quick-replies', 'message', 1
  FROM sys_permission parent WHERE parent.code = 'im:agent';

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, path, icon, sort)
SELECT parent.id, '满意度评价', 'im:rating', 'MENU', '/im/ratings', 'star', 2
  FROM sys_permission parent WHERE parent.code = 'im:agent';

INSERT IGNORE INTO sys_permission (parent_id, name, code, resource_type, sort)
SELECT parent.id, permissions.name, permissions.code, 'BUTTON', permissions.sort
  FROM (
    SELECT 'im:agent' AS parent_code, '查看接入队列' AS name, 'im:agent:query' AS code, 1 AS sort
    UNION ALL SELECT 'im:agent', '接入/转接/结束会话', 'im:agent:manage', 2
    UNION ALL SELECT 'im:quick_reply', '查看话术', 'im:quick_reply:query', 1
    UNION ALL SELECT 'im:quick_reply', '维护话术', 'im:quick_reply:manage', 2
    UNION ALL SELECT 'im:rating', '查看评价', 'im:rating:query', 1
    UNION ALL SELECT 'im:rating', '提交评价', 'im:rating:add', 2
  ) AS permissions
  JOIN sys_permission parent ON parent.code = permissions.parent_code;

-- B 端（管理员 / 业务专员）全部授予
--
-- 注意这里必须带 AGENCY_STAFF：
--   12_im_perm.sql 用 INSERT IGNORE 新建了一个 code='AGENT' 的角色，
--   但 05_rbac_schema.sql 里叫「业务专员」的既有角色其实是 AGENCY_STAFF，
--   而 seed 出来的 staff02 等账号绑的都是 AGENCY_STAFF —— AGENT 成了没有成员的空壳角色。
--   只授 AGENT 的话，真实登录的客服会全部 403。两个码都授，谁绑哪个都能用。
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.code IN (
    'im:agent', 'im:agent:query', 'im:agent:manage',
    'im:quick_reply', 'im:quick_reply:query', 'im:quick_reply:manage',
    'im:rating', 'im:rating:query', 'im:rating:add'
  )
 WHERE r.code IN ('AGENCY_ADMIN', 'AGENCY_STAFF', 'AGENT', 'SUPER_ADMIN');

-- 12_im_perm.sql 的基础 IM 权限同样只授给了 AGENT 空壳角色，
-- 实测 staff02（AGENCY_STAFF）连 im:message:send 都没有 —— 第 4 棒的 IM 演示
-- 用这个账号登录会「连发消息都 403」。这里按 12 的同一组权限补给 AGENCY_STAFF。
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.code IN (
    'im', 'im:session', 'im:message',
    'im:session:query', 'im:message:send', 'im:message:query',
    'im:conv:manage', 'analytics:live:query'
  )
 WHERE r.code = 'AGENCY_STAFF';

-- C 端游客只授予「提交评价」，看不了别人的评价
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.code = 'im:rating:add'
 WHERE r.code = 'TOURIST';

-- 游客必须能「发起咨询」：POST /v1/im/conversations 的守卫是 im:conv:manage，
-- 12_im_perm.sql 只给了查询与会话内发消息，漏了这一条 → C 端点「发起咨询」会 403。
-- 只加这一条，游客仍然进不了 im:agent:* （那才是客服侧能力）。
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM sys_role r
  JOIN sys_permission p ON p.code = 'im:conv:manage'
 WHERE r.code = 'TOURIST';


-- ---------------------------------------------------------------------------
-- 6. 全局公共话术种子（owner_id IS NULL）
--    用 seed_key 唯一键 + INSERT IGNORE 去重：重复执行不会堆叠，
--    也不用在 INSERT ... SELECT 里回读目标表（避免 1093 类陷阱）。
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO im_quick_reply (owner_id, category, content, sort, seed_key) VALUES
  (NULL, '开场', '您好，我是专属旅行顾问，请问想咨询哪条路线？', 1, 'seed.open.1'),
  (NULL, '开场', '在的，您说～我看到您刚才在看线路，需要我帮您对比一下吗？', 2, 'seed.open.2'),
  (NULL, '产品', '秒杀专区的路线包含接送机和首道景点门票，名额实时同步。', 3, 'seed.product.1'),
  (NULL, '产品', '这条线路支持 6 人小团，亲子出行可以安排儿童餐和儿童价。', 4, 'seed.product.2'),
  (NULL, '售后', '支持开团前 48 小时免费退改，您可以放心预订。', 5, 'seed.after.1'),
  (NULL, '售后', '稍等，我查一下今天的实时名额，马上回复您。', 6, 'seed.after.2'),
  (NULL, '收尾', '已经帮您登记好了，行程单会发到您的手机号，祝旅途愉快！', 7, 'seed.close.1');

