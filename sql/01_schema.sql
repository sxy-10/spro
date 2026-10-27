-- ============================================================================
--  旅游规划智能体系统 · 数据库物理模型（MySQL 8.0.16+）
--  版本：v1.0        日期：2026-10-23
--  依据：《旅游规划智能体系统-需求分析文档 v2.0》第 4 章类图、第 5 章状态机、第 6 章数据字典
--  执行：mysql -u root -p < 01_schema.sql
-- ----------------------------------------------------------------------------
--  五条设计红线（对应需求文档 6.3）：
--    1) 枚举全部收口为 ENUM，禁止自由文本入库；
--    2) 金额一律 DECIMAL，禁止 FLOAT/DOUBLE；
--    3) is_estimated 逐级如实标记 Mock 数据；
--    4) 每个字段可追溯来源（LLM / 用户 / 工具 API / 系统计算）；
--    5) 经纬度统一 DECIMAL(9,6)。
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS travel_agent_db
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE travel_agent_db;

-- 幂等重跑：按依赖反序清理（生产环境请勿执行本段）
DROP TABLE IF EXISTS tool_call_log;
DROP TABLE IF EXISTS user_favorite;
DROP TABLE IF EXISTS tour_order;
DROP TABLE IF EXISTS product_stat_event;
DROP TABLE IF EXISTS export_record;
DROP TABLE IF EXISTS itinerary_version;
DROP TABLE IF EXISTS schedule_transport;
DROP TABLE IF EXISTS schedule_item;
DROP TABLE IF EXISTS day_tip;
DROP TABLE IF EXISTS day_plan;
DROP TABLE IF EXISTS itinerary_notice;
DROP TABLE IF EXISTS preference_tag;
DROP TABLE IF EXISTS preference_destination;
DROP TABLE IF EXISTS travel_preference;
DROP TABLE IF EXISTS itinerary;
DROP TABLE IF EXISTS poi_hotel;
DROP TABLE IF EXISTS poi_restaurant;
DROP TABLE IF EXISTS poi_attraction;
DROP TABLE IF EXISTS poi;
DROP TABLE IF EXISTS travel_product;
DROP TABLE IF EXISTS chat_message;
DROP TABLE IF EXISTS chat_session;
DROP TABLE IF EXISTS sys_user;
DROP TABLE IF EXISTS travel_agency;

SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================================
--  一、机构与账号域
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. travel_agency 旅行社（B 端租户）
-- ---------------------------------------------------------------------------
CREATE TABLE travel_agency (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  agency_name   VARCHAR(100)    NOT NULL                COMMENT '旅行社名称',
  license_no    VARCHAR(50)     NOT NULL                COMMENT '旅行社业务经营许可证号',
  contact_name  VARCHAR(50)         NULL                COMMENT '联系人',
  contact_phone VARCHAR(20)         NULL                COMMENT '联系电话',
  status        ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '机构状态',
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_agency_license (license_no)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '旅行社（B 端租户），线路产品的归属主体';


-- ---------------------------------------------------------------------------
-- 2. sys_user 用户（游客 + 旅行社管理员）
--    一个账号一个角色：TOURIST 为 C 端游客，ADMIN 为 B 端管理员且必须归属机构
-- ---------------------------------------------------------------------------
CREATE TABLE sys_user (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  agency_id              BIGINT UNSIGNED     NULL                COMMENT '所属旅行社；C 端游客为 NULL',
  username               VARCHAR(50)     NOT NULL                COMMENT '登录名',
  password_hash          VARCHAR(100)    NOT NULL                COMMENT 'bcrypt 哈希，禁止明文',
  nickname               VARCHAR(50)         NULL                COMMENT '昵称',
  phone                  VARCHAR(20)         NULL                COMMENT '手机号（导出内容需脱敏）',
  avatar_url             VARCHAR(512)        NULL                COMMENT '头像地址',
  role                   ENUM('TOURIST','ADMIN') NOT NULL DEFAULT 'TOURIST' COMMENT '角色',
  default_departure_city VARCHAR(50)         NULL                COMMENT '常用出发城市，用于偏好预填',
  status                 ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '账号状态',
  last_login_at          DATETIME            NULL                COMMENT '最近登录时间',
  created_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_username (username),
  UNIQUE KEY uk_user_phone (phone),
  KEY idx_user_agency (agency_id),
  KEY idx_user_role_status (role, status),
  -- 注：该列已用于 CHECK，MySQL 不允许再带级联动作，故用 NO ACTION（等效 RESTRICT）
  CONSTRAINT fk_user_agency FOREIGN KEY (agency_id) REFERENCES travel_agency (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_admin_must_belong_agency CHECK (role <> 'ADMIN' OR agency_id IS NOT NULL)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '系统用户；C 端游客与 B 端管理员共用一张表，用 role 区分';


-- 3. user_favorite 收藏夹（对应探索页「看看大家的收藏夹」）
CREATE TABLE user_favorite (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  user_id     BIGINT UNSIGNED NOT NULL                COMMENT '收藏人',
  target_type ENUM('ITINERARY','POI','PRODUCT') NOT NULL COMMENT '收藏对象类型',
  target_id   BIGINT UNSIGNED NOT NULL                COMMENT '收藏对象主键（多态关联，不加外键）',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '收藏时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_favorite (user_id, target_type, target_id),
  KEY idx_favorite_target (target_type, target_id),
  CONSTRAINT fk_favorite_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '收藏夹；多态关联无法加外键，由应用层保证 target_id 有效性';


-- ============================================================================
--  二、对话域（多轮追问与消息留痕）
-- ============================================================================

-- 4. chat_session 会话
CREATE TABLE chat_session (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  user_id       BIGINT UNSIGNED     NULL                COMMENT '所属游客；NULL 表示未登录的体验会话',
  title         VARCHAR(100)    NOT NULL DEFAULT '新的出行咨询' COMMENT '会话标题（取首句需求）',
  status        ENUM('ACTIVE','CLOSED') NOT NULL DEFAULT 'ACTIVE' COMMENT '会话状态',
  message_count INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '消息条数（冗余计数，便于列表展示）',
  last_active_at DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后活跃时间',
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_session_user (user_id, last_active_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '对话会话；一次规划可能包含多轮追问，故独立成表';


-- 5. chat_message 对话消息
--    注意：itinerary_id 外键在 itinerary 建表后用 ALTER 补充（存在循环引用）
CREATE TABLE chat_message (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  session_id   BIGINT UNSIGNED NOT NULL                COMMENT '所属会话',
  sender       ENUM('USER','ASSISTANT','SYSTEM') NOT NULL COMMENT '发送方',
  content      MEDIUMTEXT      NOT NULL                COMMENT '消息正文（LLM 原始输出，便于回溯）',
  itinerary_id BIGINT UNSIGNED     NULL                COMMENT '关联行程单（0..1）',
  intent_tags  JSON                NULL                COMMENT '语义标签，如 ["亲子","慢节奏"]',
  tool_tags    JSON                NULL                COMMENT '本轮调用的工具，如 ["WEATHER","FOOD"]',
  token_count  INT UNSIGNED        NULL                COMMENT 'token 消耗，用于成本核算',
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '发送时间',
  PRIMARY KEY (id),
  KEY idx_message_session (session_id, created_at),
  KEY idx_message_itinerary (itinerary_id),
  CONSTRAINT fk_message_session FOREIGN KEY (session_id) REFERENCES chat_session (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '对话消息；保留 AI 原文以满足「字段可追溯」红线';


-- ============================================================================
--  三、POI 域（地点主数据 + 类表继承的子类型表）
--  类图 4.2 中 Attraction / Restaurant / Hotel ──▷ POI 为继承关系，
--  此处采用「类表继承」：公共属性在 poi，专有属性各自成表，主键即外键。
-- ============================================================================

-- 6. poi 兴趣点（公共属性）
CREATE TABLE poi (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  poi_type        ENUM('ATTRACTION','RESTAURANT','HOTEL') NOT NULL COMMENT 'POI 类型（继承判别列）',
  name            VARCHAR(100)    NOT NULL                COMMENT '名称',
  city_name       VARCHAR(50)     NOT NULL                COMMENT '所在城市',
  district        VARCHAR(50)         NULL                COMMENT '行政区',
  address         VARCHAR(255)        NULL                COMMENT '详细地址',
  latitude        DECIMAL(9,6)    NOT NULL                COMMENT '纬度（动线顺路计算核心输入）',
  longitude       DECIMAL(9,6)    NOT NULL                COMMENT '经度',
  rating          DECIMAL(2,1)        NULL                COMMENT '评分 0.0-5.0，来源高德',
  tel             VARCHAR(30)         NULL                COMMENT '联系电话',
  opening_hours   VARCHAR(100)        NULL                COMMENT '开放/营业时间',
  cover_image_url VARCHAR(512)        NULL                COMMENT '封面图',
  source_poi_id   VARCHAR(64)         NULL                COMMENT '外部数据源 POI 编号（高德），用于增量同步去重',
  data_source     ENUM('AMAP','MOCK','MANUAL') NOT NULL DEFAULT 'MOCK' COMMENT '数据来源',
  is_estimated    TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '是否为估算数据（MOCK 强制为 1）',
  status          ENUM('ACTIVE','OFFLINE') NOT NULL DEFAULT 'ACTIVE' COMMENT '上下架状态；POI 只下架不物理删除，保护历史行程',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_poi_source (data_source, source_poi_id),
  KEY idx_poi_city_type (city_name, poi_type),
  KEY idx_poi_geo (latitude, longitude),
  CONSTRAINT chk_poi_rating CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  CONSTRAINT chk_poi_lat CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_poi_lng CHECK (longitude BETWEEN -180 AND 180)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '兴趣点主表（景点/餐厅/酒店公共属性），对应类图 POI 抽象类';


-- 7. poi_attraction 景点专有属性
CREATE TABLE poi_attraction (
  poi_id                  BIGINT UNSIGNED NOT NULL COMMENT '主键兼外键，指向 poi.id',
  ticket_price_rmb        DECIMAL(8,2)    NOT NULL DEFAULT 0.00 COMMENT '门票价格（元）；0 表示免费',
  suggested_duration_hours DECIMAL(3,1)   NOT NULL DEFAULT 2.0  COMMENT '建议游玩时长（小时）',
  booking_notice          VARCHAR(255)        NULL              COMMENT '预约须知，如「提前在公众号预约」',
  category_tag            VARCHAR(30)         NULL              COMMENT '景点分类：自然风光/人文古迹/主题乐园',
  best_visit_time         VARCHAR(50)         NULL              COMMENT '最佳游览时段',
  PRIMARY KEY (poi_id),
  CONSTRAINT fk_attr_poi FOREIGN KEY (poi_id) REFERENCES poi (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_attr_price CHECK (ticket_price_rmb >= 0),
  CONSTRAINT chk_attr_duration CHECK (suggested_duration_hours > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '景点扩展表，对应类图 Attraction';


-- 8. poi_restaurant 餐厅专有属性
CREATE TABLE poi_restaurant (
  poi_id            BIGINT UNSIGNED NOT NULL COMMENT '主键兼外键，指向 poi.id',
  cuisine_type      VARCHAR(30)         NULL              COMMENT '菜系：滇菜/川菜/火锅/小吃',
  average_cost_rmb  DECIMAL(8,2)    NOT NULL DEFAULT 0.00 COMMENT '人均消费（元）',
  signature_dishes  JSON                NULL              COMMENT '招牌菜数组，如 ["松茸土鸡汤","包浆豆腐"]',
  business_hours    VARCHAR(100)        NULL              COMMENT '营业时间',
  has_private_room  TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '是否有包间（家庭游加权项）',
  PRIMARY KEY (poi_id),
  CONSTRAINT fk_rest_poi FOREIGN KEY (poi_id) REFERENCES poi (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_rest_cost CHECK (average_cost_rmb >= 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '餐厅扩展表，对应类图 Restaurant';


-- 9. poi_hotel 酒店/民宿专有属性
CREATE TABLE poi_hotel (
  poi_id                 BIGINT UNSIGNED NOT NULL COMMENT '主键兼外键，指向 poi.id',
  hotel_type             VARCHAR(20)         NULL              COMMENT '住宿类型：星级酒店/精品客栈/民宿',
  star_level             TINYINT UNSIGNED    NULL              COMMENT '星级 1-5；民宿可为空',
  price_per_night_rmb    DECIMAL(8,2)    NOT NULL DEFAULT 0.00 COMMENT '参考每晚价格（元）',
  near_metro             TINYINT(1)      NOT NULL DEFAULT 0    COMMENT '是否近地铁（true 时推荐排序加权）',
  key_features           JSON                NULL              COMMENT '特色标签，如 ["近地铁","含早餐"]',
  check_in_time          TIME                NULL              COMMENT '最早入住时间',
  PRIMARY KEY (poi_id),
  CONSTRAINT fk_hotel_poi FOREIGN KEY (poi_id) REFERENCES poi (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_hotel_price CHECK (price_per_night_rmb >= 0),
  CONSTRAINT chk_hotel_star CHECK (star_level IS NULL OR star_level BETWEEN 1 AND 5)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '住宿扩展表，对应类图 Hotel';


-- ============================================================================
--  四、B 端线路产品（被行程单引用，须先于 itinerary 建表）
-- ============================================================================

-- 10. travel_product 线路产品
CREATE TABLE travel_product (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  product_no            VARCHAR(32)     NOT NULL                COMMENT '产品编号，如 prod_001',
  agency_id             BIGINT UNSIGNED NOT NULL                COMMENT '所属旅行社',
  title                 VARCHAR(100)    NOT NULL                COMMENT '线路名称',
  destination           VARCHAR(100)    NOT NULL                COMMENT '目的地（可含多城，如「四川/西藏」）',
  default_days          TINYINT UNSIGNED NOT NULL               COMMENT '默认天数',
  style_tag             VARCHAR(30)         NULL                COMMENT '风格标签，如「休闲慢节奏」',
  base_price_rmb        DECIMAL(12,2)   NOT NULL                COMMENT '基准价（元/人）',
  cover_image_url       VARCHAR(512)        NULL                COMMENT '封面图',
  description           TEXT                NULL                COMMENT '产品详情',
  status                ENUM('DRAFT','ON_SALE','OFF_SALE') NOT NULL DEFAULT 'DRAFT' COMMENT '状态机：新建/已上架/已下架',
  is_active             TINYINT(1) GENERATED ALWAYS AS (IF(status = 'ON_SALE', 1, 0)) STORED COMMENT '是否上架（派生列，兼容前端 isActive）',
  visitor_count         INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '访客数（埋点汇总）',
  plans_generated_count INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '生成行程数（埋点汇总）',
  order_count           INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '下单数（埋点汇总）',
  conversion_rate       DECIMAL(5,4) GENERATED ALWAYS AS (
                          IF(visitor_count = 0, 0.0000, ROUND(order_count / visitor_count, 4))
                        ) STORED                              COMMENT '转化率 = 下单数/访客数，只读派生列，保留 4 位小数',
  created_by            BIGINT UNSIGNED     NULL                COMMENT '创建人（管理员）',
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_product_no (product_no),
  KEY idx_product_agency (agency_id, status),
  KEY idx_product_onsale (status, visitor_count),
  KEY idx_product_conversion (conversion_rate),
  CONSTRAINT fk_product_agency FOREIGN KEY (agency_id) REFERENCES travel_agency (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_product_creator FOREIGN KEY (created_by) REFERENCES sys_user (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_product_days CHECK (default_days BETWEEN 1 AND 30),
  CONSTRAINT chk_product_price CHECK (base_price_rmb > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '线路产品 TravelProduct；is_active 与 conversion_rate 均为派生列，杜绝人工写错';


-- ============================================================================
--  五、行程域（核心交付物：行程单 → 日程 → 日程项 的三级组合）
-- ============================================================================

-- 11. itinerary 行程单
CREATE TABLE itinerary (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键，供内部关联',
  itinerary_no             CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '对外业务编号（ULID），对应类图 itineraryId',
  user_id                  BIGINT UNSIGNED     NULL                COMMENT '所属游客；NULL 为未登录行程',
  session_id               BIGINT UNSIGNED     NULL                COMMENT '产生该行程的会话',
  product_id               BIGINT UNSIGNED     NULL                COMMENT '由哪个线路模板生成；自由对话生成为 NULL',
  title                    VARCHAR(100)    NOT NULL                COMMENT '行程标题 planTitle',
  summary                  VARCHAR(500)        NULL                COMMENT '一句话简介 summaryDescription',
  status                   ENUM('DRAFT','PLANNING','PENDING_CONFIRM','OPTIMIZING','CONFIRMED','EXPORTED','ARCHIVED')
                           NOT NULL DEFAULT 'DRAFT'                 COMMENT '状态机 7 态，只能按 5.1 状态表迁移',
  version                  INT UNSIGNED    NOT NULL DEFAULT 1      COMMENT '版本号，每次优化 +1，只增不减',
  days_count               TINYINT UNSIGNED NOT NULL               COMMENT '总天数',
  nights_count             TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '总晚数',
  start_date               DATE                NULL                COMMENT '出发日期',
  end_date                 DATE                NULL                COMMENT '结束日期',
  total_budget_rmb         DECIMAL(12,2)   NOT NULL                COMMENT '预算总额（元）',
  budget_transportation_rmb DECIMAL(12,2)  NOT NULL DEFAULT 0.00   COMMENT '交通预算，默认总预算×30%',
  budget_accommodation_rmb  DECIMAL(12,2)  NOT NULL DEFAULT 0.00   COMMENT '住宿预算，默认总预算×35%',
  budget_admission_rmb      DECIMAL(12,2)  NOT NULL DEFAULT 0.00   COMMENT '门票预算，默认总预算×15%',
  budget_meals_rmb          DECIMAL(12,2)  NOT NULL DEFAULT 0.00   COMMENT '餐饮预算，默认总预算×15%',
  budget_reserve_rmb        DECIMAL(12,2)  NOT NULL DEFAULT 0.00   COMMENT '备用金，默认总预算×5%',
  is_estimated             TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '是否含 Mock 估算数据（AC3）',
  fail_reason              VARCHAR(255)        NULL                COMMENT '生成失败原因，状态回退 DRAFT 时记录',
  confirmed_at             DATETIME            NULL                COMMENT '确认锁定时间',
  exported_at              DATETIME            NULL                COMMENT '最近导出时间',
  archived_at              DATETIME            NULL                COMMENT '归档时间',
  created_at               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_itinerary_no (itinerary_no),
  KEY idx_itinerary_user (user_id, status, created_at),
  KEY idx_itinerary_session (session_id),
  KEY idx_itinerary_product (product_id),
  KEY idx_itinerary_status (status, updated_at),
  CONSTRAINT fk_itinerary_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_itinerary_session FOREIGN KEY (session_id) REFERENCES chat_session (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_itinerary_product FOREIGN KEY (product_id) REFERENCES travel_product (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_itin_version CHECK (version >= 1),
  CONSTRAINT chk_itin_days CHECK (days_count BETWEEN 1 AND 30),
  CONSTRAINT chk_itin_nights CHECK (nights_count >= 0),
  CONSTRAINT chk_itin_budget_positive CHECK (total_budget_rmb > 0),
  CONSTRAINT chk_itin_budget_items CHECK (
    budget_transportation_rmb >= 0 AND budget_accommodation_rmb >= 0 AND budget_admission_rmb >= 0
    AND budget_meals_rmb >= 0 AND budget_reserve_rmb >= 0
  ),
  CONSTRAINT chk_itin_budget_ceiling CHECK (
    budget_transportation_rmb + budget_accommodation_rmb + budget_admission_rmb
    + budget_meals_rmb + budget_reserve_rmb <= ROUND(total_budget_rmb * 1.05, 2)
  )
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '行程单（核心实体），组合根；预算五项与总预算的 1.05 红线在库层校验';


-- 12. itinerary_notice 行程锦囊（1:1 垂直拆分，避免主表过宽）
CREATE TABLE itinerary_notice (
  itinerary_id           BIGINT UNSIGNED NOT NULL COMMENT '主键兼外键，指向 itinerary.id',
  weather_overview       VARCHAR(255)        NULL              COMMENT '天气概况',
  temperature_range      VARCHAR(50)         NULL              COMMENT '气温区间，如 18℃-26℃',
  clothing_suggestions   VARCHAR(500)        NULL              COMMENT '着装建议',
  essential_documents    JSON                NULL              COMMENT '必备证件数组',
  avoid_trap_tips        JSON                NULL              COMMENT '防坑提示数组',
  police_number          VARCHAR(20)         NULL DEFAULT '110' COMMENT '报警电话',
  nearest_hospital       VARCHAR(100)        NULL              COMMENT '最近三甲医院',
  tourist_hotline        VARCHAR(50)         NULL              COMMENT '旅游维权热线',
  PRIMARY KEY (itinerary_id),
  CONSTRAINT fk_notice_itin FOREIGN KEY (itinerary_id) REFERENCES itinerary (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '行程锦囊 EssentialKitAndNotices；与行程单 1:1，删除行程即级联删除';


-- 13. travel_preference 出行偏好（LLM 结构化提取结果）
--     先挂在会话上（追问阶段），行程生成后回填 itinerary_id
CREATE TABLE travel_preference (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  session_id              BIGINT UNSIGNED     NULL                COMMENT '提取该偏好的会话',
  itinerary_id            BIGINT UNSIGNED     NULL                COMMENT '最终落到哪张行程单（1:1）',
  departure_city          VARCHAR(50)     NOT NULL                COMMENT '出发城市',
  days_count              TINYINT UNSIGNED NOT NULL               COMMENT '天数 1-30',
  nights_count            TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '晚数，默认天数-1',
  traveler_count          TINYINT UNSIGNED NOT NULL DEFAULT 1     COMMENT '出行人数 1-20',
  budget_total_rmb        DECIMAL(12,2)   NOT NULL                COMMENT '总预算（元）',
  pace                    ENUM('SLOW','NORMAL','INTENSIVE') NOT NULL DEFAULT 'NORMAL' COMMENT '节奏：慢/正常/紧凑',
  travel_style            ENUM('LEISURE','FAMILY','COUPLE','HIKING','PHOTOGRAPHY','FOODIE') NULL COMMENT '出行风格',
  hotel_preference        ENUM('NEAR_ATTRACTION','NEAR_METRO','COST_FIRST') NOT NULL DEFAULT 'NEAR_ATTRACTION' COMMENT '住宿偏好',
  avoid_shopping          TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '是否纯玩无购物',
  additional_requirements VARCHAR(500)        NULL                COMMENT '补充需求，如「近景区」「亲子友好」',
  raw_input               TEXT                NULL                COMMENT '用户原始一句话，用于核对 LLM 提取准确性',
  extract_source          ENUM('LLM','RULE_FALLBACK','USER_EDIT') NOT NULL DEFAULT 'LLM' COMMENT '提取方式（可追溯）',
  created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_pref_itinerary (itinerary_id),
  KEY idx_pref_session (session_id),
  CONSTRAINT fk_pref_session FOREIGN KEY (session_id) REFERENCES chat_session (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_pref_itinerary FOREIGN KEY (itinerary_id) REFERENCES itinerary (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_pref_days CHECK (days_count BETWEEN 1 AND 30),
  CONSTRAINT chk_pref_nights CHECK (nights_count >= 0),
  CONSTRAINT chk_pref_travelers CHECK (traveler_count BETWEEN 1 AND 20),
  CONSTRAINT chk_pref_budget CHECK (budget_total_rmb > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '出行偏好 UserTravelPreference；raw_input 保留原话以满足可追溯要求';


-- 14. preference_destination 目的地（有序，多值属性规范化）
CREATE TABLE preference_destination (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  preference_id BIGINT UNSIGNED NOT NULL                COMMENT '所属偏好',
  city_name     VARCHAR(50)     NOT NULL                COMMENT '目的地城市',
  seq_no        TINYINT UNSIGNED NOT NULL               COMMENT '访问顺序，从 1 开始',
  PRIMARY KEY (id),
  UNIQUE KEY uk_pref_city (preference_id, city_name),
  KEY idx_pref_dest_order (preference_id, seq_no),
  CONSTRAINT fk_dest_pref FOREIGN KEY (preference_id) REFERENCES travel_preference (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_dest_seq CHECK (seq_no >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '目的地城市明细；拆表而非 JSON 数组，满足第一范式且可排序（≤10 个由应用层校验）';


-- 15. preference_tag 兴趣 / 忌口标签
CREATE TABLE preference_tag (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  preference_id BIGINT UNSIGNED NOT NULL                COMMENT '所属偏好',
  tag_type      ENUM('INTEREST','DIETARY') NOT NULL     COMMENT 'INTEREST 兴趣 / DIETARY 忌口',
  tag_value     VARCHAR(30)     NOT NULL                COMMENT '标签值，如「摄影」「清真」「忌辣」',
  PRIMARY KEY (id),
  UNIQUE KEY uk_pref_tag (preference_id, tag_type, tag_value),
  CONSTRAINT fk_tag_pref FOREIGN KEY (preference_id) REFERENCES travel_preference (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '兴趣与忌口标签；一张表承载两类多值属性，用 tag_type 区分';


-- 16. day_plan 日程（行程单的组合子实体）
CREATE TABLE day_plan (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  itinerary_id   BIGINT UNSIGNED NOT NULL                COMMENT '所属行程单',
  day_index      TINYINT UNSIGNED NOT NULL               COMMENT '第几天，从 1 开始连续递增',
  plan_date      DATE                NULL                COMMENT '具体日期（与行程 start_date 推算）',
  city_name      VARCHAR(50)     NOT NULL                COMMENT '当日所在城市',
  theme_title    VARCHAR(50)     NOT NULL                COMMENT '当日主题，如「洱海慢调·苍山环抱」',
  weather_text   VARCHAR(20)         NULL                COMMENT '天气（晴/多云）',
  temperature_text VARCHAR(20)       NULL                COMMENT '气温文本，如 21℃',
  weather_icon   VARCHAR(10)         NULL                COMMENT '天气图标',
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_day_itinerary_index (itinerary_id, day_index),
  CONSTRAINT fk_day_itin FOREIGN KEY (itinerary_id) REFERENCES itinerary (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_day_index CHECK (day_index >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '日程 DayPlan；与行程单为组合关系，行程删除则级联删除';


-- 17. day_tip 每日贴士
CREATE TABLE day_tip (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  day_plan_id BIGINT UNSIGNED NOT NULL                COMMENT '所属日程',
  seq_no      TINYINT UNSIGNED NOT NULL               COMMENT '序号',
  content     VARCHAR(255)    NOT NULL                COMMENT '贴士内容',
  PRIMARY KEY (id),
  UNIQUE KEY uk_day_tip (day_plan_id, seq_no),
  CONSTRAINT fk_tip_day FOREIGN KEY (day_plan_id) REFERENCES day_plan (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '每日贴士；保障「每日至少 1 条」的校验由应用层完成';


-- 18. schedule_item 日程项（景点/餐饮/交通/住宿四类统一表达）
CREATE TABLE schedule_item (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  day_plan_id       BIGINT UNSIGNED NOT NULL                COMMENT '所属日程',
  time_slot         ENUM('MORNING','AFTERNOON','EVENING') NOT NULL COMMENT '时段：上午/下午/晚上',
  item_type         ENUM('ATTRACTION','MEAL','TRANSPORT','HOTEL') NOT NULL COMMENT '日程项类型（4 值，与数据字典一致）',
  seq_no            TINYINT UNSIGNED NOT NULL DEFAULT 1     COMMENT '同时段内排序',
  start_time        TIME                NULL                COMMENT '开始时间',
  end_time          TIME                NULL                COMMENT '结束时间',
  title             VARCHAR(100)    NOT NULL                COMMENT '显示标题',
  description       VARCHAR(500)        NULL                COMMENT '描述',
  poi_id            BIGINT UNSIGNED     NULL                COMMENT '关联 POI：景点/餐厅/酒店必填，交通可空',
  duration_hours    DECIMAL(3,1)        NULL                COMMENT '停留或耗时（小时）',
  nights            TINYINT UNSIGNED    NULL                COMMENT '住宿晚数（仅 HOTEL 类型）',
  meal_type         ENUM('BREAKFAST','LUNCH','DINNER') NULL COMMENT '餐次（仅 MEAL 类型）',
  estimated_cost_rmb DECIMAL(12,2)  NOT NULL DEFAULT 0.00   COMMENT '预估费用（元），is_estimated=1 时前端显示「约」',
  is_estimated      TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '该条费用是否为估算',
  booking_url       VARCHAR(512)        NULL                COMMENT '预订链接，须 http(s):// 开头',
  highlight_reason  VARCHAR(255)        NULL                COMMENT '推荐理由 / 顺路依据',
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_item_slot_seq (day_plan_id, time_slot, seq_no),
  KEY idx_item_poi (poi_id),
  CONSTRAINT fk_item_day FOREIGN KEY (day_plan_id) REFERENCES day_plan (id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- 行程是历史快照：POI 只允许下架（poi.status），不允许物理删除，故用 NO ACTION 保护引用
  CONSTRAINT fk_item_poi FOREIGN KEY (poi_id) REFERENCES poi (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_item_cost CHECK (estimated_cost_rmb >= 0),
  CONSTRAINT chk_item_poi_required CHECK (item_type = 'TRANSPORT' OR poi_id IS NOT NULL)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '日程项 ScheduleItem；单表承载四类项，交通专有字段拆到 schedule_transport';


-- 19. schedule_transport 交通段专有属性（1:1 垂直拆分）
CREATE TABLE schedule_transport (
  item_id           BIGINT UNSIGNED NOT NULL COMMENT '主键兼外键，指向 schedule_item.id',
  segment_type      ENUM('INTERCITY','LOCAL') NOT NULL COMMENT '跨城大交通 / 市内小交通',
  transport_mode    ENUM('HSR','FLIGHT','SELF_DRIVING','METRO','TAXI','CHARTER_BUS') NOT NULL COMMENT '交通方式',
  origin            VARCHAR(100)    NOT NULL COMMENT '起点',
  destination       VARCHAR(100)    NOT NULL COMMENT '终点',
  duration_minutes  SMALLINT UNSIGNED   NULL COMMENT '预计耗时（分钟）',
  transfer_tips     VARCHAR(255)        NULL COMMENT '换乘提示',
  PRIMARY KEY (item_id),
  CONSTRAINT fk_trans_item FOREIGN KEY (item_id) REFERENCES schedule_item (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_trans_duration CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  CONSTRAINT chk_trans_intercity_mode CHECK (
    segment_type <> 'INTERCITY' OR transport_mode IN ('HSR','FLIGHT','SELF_DRIVING')
  )
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '交通段扩展表 TransportSegment；跨城仅允许高铁/飞机/自驾';


-- 补充 chat_message → itinerary 的外键（因 itinerary 依赖 chat_session，存在循环引用）
ALTER TABLE chat_message
  ADD CONSTRAINT fk_message_itinerary FOREIGN KEY (itinerary_id)
  REFERENCES itinerary (id) ON DELETE SET NULL ON UPDATE CASCADE;


-- 20. itinerary_version 行程版本快照（支撑 AC2 与幂等）
CREATE TABLE itinerary_version (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  itinerary_id           BIGINT UNSIGNED NOT NULL                COMMENT '所属行程单',
  version                INT UNSIGNED    NOT NULL                COMMENT '版本号，与 itinerary.version 对应',
  change_type            ENUM('GENERATE','OPTIMIZE','CONFIRM','EXPORT','ARCHIVE') NOT NULL COMMENT '变更类型',
  adjustment_instruction VARCHAR(500)        NULL                COMMENT '触发本次变更的自然语言指令',
  affected_day_index     TINYINT UNSIGNED    NULL                COMMENT '受影响天（局部重算范围）',
  snapshot               JSON            NOT NULL                COMMENT '完整行程快照，用于差异对比与回滚',
  created_by             BIGINT UNSIGNED     NULL                COMMENT '操作人',
  created_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '生成时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_version (itinerary_id, version),
  CONSTRAINT fk_ver_itin FOREIGN KEY (itinerary_id) REFERENCES itinerary (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ver_user FOREIGN KEY (created_by) REFERENCES sys_user (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '行程版本快照；以 (itinerary_id, version) 作为幂等键，同时支持「第2天变了其他天不变」的验收';


-- 21. export_record 导出记录
CREATE TABLE export_record (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  itinerary_id    BIGINT UNSIGNED NOT NULL                COMMENT '导出的行程单',
  itinerary_version INT UNSIGNED  NOT NULL                COMMENT '导出时的版本号，保证内容可复现',
  user_id         BIGINT UNSIGNED     NULL                COMMENT '导出人',
  export_format   ENUM('WECHAT_LONG_TEXT','PRINT') NOT NULL COMMENT '微信长文 / 打印排版',
  content         MEDIUMTEXT          NULL                COMMENT '导出内容快照（须脱敏，不含手机号）',
  file_url        VARCHAR(512)        NULL                COMMENT '打印版 PDF 地址',
  exported_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '导出时间',
  PRIMARY KEY (id),
  KEY idx_export_itin (itinerary_id, exported_at),
  KEY idx_export_user (user_id, exported_at),
  CONSTRAINT fk_export_itin FOREIGN KEY (itinerary_id) REFERENCES itinerary (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_export_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '导出记录 ExportRecord；对应 UC7 / 子图 B 导出包';


-- ============================================================================
--  六、B 端运营统计（订单与埋点）
-- ============================================================================

-- 22. product_stat_event 产品埋点事件（明细事实表）
CREATE TABLE product_stat_event (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  product_id   BIGINT UNSIGNED NOT NULL                COMMENT '线路产品',
  user_id      BIGINT UNSIGNED     NULL                COMMENT '触发用户（匿名为 NULL）',
  event_type   ENUM('VISIT','PLAN_GENERATED','ORDER') NOT NULL COMMENT '浏览/生成行程/下单',
  itinerary_id BIGINT UNSIGNED     NULL                COMMENT '关联行程单（PLAN_GENERATED 时）',
  order_id     BIGINT UNSIGNED     NULL                COMMENT '关联订单（ORDER 时）',
  occurred_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '事件发生时间',
  PRIMARY KEY (id),
  KEY idx_event_product (product_id, event_type, occurred_at),
  KEY idx_event_user (user_id, occurred_at),
  CONSTRAINT fk_event_product FOREIGN KEY (product_id) REFERENCES travel_product (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_event_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_event_itin FOREIGN KEY (itinerary_id) REFERENCES itinerary (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '埋点事件明细；travel_product 上的三个计数可由本表重算对账（AC4 下钻依据）';


-- 23. tour_order 订单（转化率分母之外的「下单数」来源）
CREATE TABLE tour_order (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  order_no       VARCHAR(32)     NOT NULL                COMMENT '订单号',
  user_id        BIGINT UNSIGNED NOT NULL                COMMENT '下单用户',
  product_id     BIGINT UNSIGNED     NULL                COMMENT '线路产品；自由行下单可为 NULL',
  itinerary_id   BIGINT UNSIGNED     NULL                COMMENT '关联行程单',
  traveler_count TINYINT UNSIGNED NOT NULL DEFAULT 1     COMMENT '出行人数',
  total_amount   DECIMAL(12,2)   NOT NULL                COMMENT '订单金额（元）',
  status         ENUM('PENDING','PAID','CANCELLED','COMPLETED','REFUNDED') NOT NULL DEFAULT 'PENDING' COMMENT '订单状态',
  contact_name   VARCHAR(50)         NULL                COMMENT '联系人（展示需脱敏）',
  contact_phone  VARCHAR(20)         NULL                COMMENT '联系电话（导出需脱敏）',
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下单时间',
  paid_at        DATETIME            NULL                COMMENT '支付时间',
  cancelled_at   DATETIME            NULL                COMMENT '取消时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_no (order_no),
  KEY idx_order_user (user_id, status, created_at),
  KEY idx_order_product (product_id, created_at),
  CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_order_product FOREIGN KEY (product_id) REFERENCES travel_product (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_order_itin FOREIGN KEY (itinerary_id) REFERENCES itinerary (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_order_amount CHECK (total_amount >= 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '订单；conversionRate 的「下单数」由本表或埋点事件统计';


-- ============================================================================
--  七、可观测性（非功能需求：API 超时重试 3 次后降级 Mock 的证据链）
-- ============================================================================

-- 24. tool_call_log 工具调用日志
CREATE TABLE tool_call_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  session_id    BIGINT UNSIGNED     NULL                COMMENT '关联会话',
  itinerary_id  BIGINT UNSIGNED     NULL                COMMENT '关联行程单',
  tool_name     ENUM('WEATHER','ATTRACTION','TRANSPORT','HOTEL','FOOD') NOT NULL COMMENT '五大工具之一',
  provider      VARCHAR(50)         NULL                COMMENT '数据提供方：amap/qweather/mock',
  request_summary VARCHAR(500)      NULL                COMMENT '请求摘要（脱敏）',
  response_status ENUM('SUCCESS','TIMEOUT','FAILED','MOCK_FALLBACK') NOT NULL COMMENT '调用结果',
  retry_count   TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '重试次数，>3 则降级',
  is_mock       TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '本次是否使用了 Mock 数据',
  latency_ms    INT UNSIGNED        NULL                COMMENT '耗时（毫秒），用于性能观测',
  error_message VARCHAR(500)        NULL                COMMENT '异常信息',
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '调用时间',
  PRIMARY KEY (id),
  KEY idx_tool_itin (itinerary_id, tool_name),
  KEY idx_tool_time (created_at),
  CONSTRAINT fk_tool_session FOREIGN KEY (session_id) REFERENCES chat_session (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_tool_itin FOREIGN KEY (itinerary_id) REFERENCES itinerary (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '工具调用日志；AC3 断网降级的证据链，也用于统计 Mock 占比与 P95 延迟';

-- ============================================================================
--  END OF SCHEMA
-- ============================================================================
