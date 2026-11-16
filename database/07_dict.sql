-- ============================================================================
-- 基础字典表（组员1 · 阶段一）
--
-- 用途：民族、出发城市、旅行风格、餐饮偏好、季节这类"低频变更、高频读取"的数据。
--       前端注册页/筛选器每屏都要用，走 Redis 缓存后不再打 MySQL。
--
-- 执行：mysql -uroot -p travel_agent_db < database/07_dict.sql
-- 幂等：CREATE TABLE IF NOT EXISTS + INSERT ... ON DUPLICATE KEY UPDATE
-- ============================================================================

CREATE TABLE IF NOT EXISTS sys_dict (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  dict_type  VARCHAR(32)  NOT NULL COMMENT '字典类型：ethnic/city/style/food/season',
  dict_key   VARCHAR(64)  NOT NULL COMMENT '字典键（存库用），如 yi / kunming / nature',
  dict_value VARCHAR(128) NOT NULL COMMENT '字典值（展示用），如 彝族 / 昆明 / 自然风光',
  sort       INT          NOT NULL DEFAULT 0 COMMENT '同级排序号，小的在前',
  status     ENUM('ENABLED','DISABLED') NOT NULL DEFAULT 'ENABLED' COMMENT '禁用后不下发',
  remark     VARCHAR(200)     NULL COMMENT '备注',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dict_type_key (dict_type, dict_key),
  KEY idx_dict_type (dict_type)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  COMMENT = '基础字典；读多写少，由 Redis 缓存（dict:{type}）';

-- ---------------------------------------------------------------------------
-- 种子数据
-- ---------------------------------------------------------------------------

INSERT INTO sys_dict (dict_type, dict_key, dict_value, sort) VALUES
  -- 民族：云南多民族，注册/行程偏好会用到
  ('ethnic', 'han',    '汉族',   1),
  ('ethnic', 'yi',     '彝族',   2),
  ('ethnic', 'bai',    '白族',   3),
  ('ethnic', 'dai',    '傣族',   4),
  ('ethnic', 'naxi',   '纳西族', 5),
  ('ethnic', 'zang',   '藏族',   6),
  ('ethnic', 'hui',    '回族',   7),
  ('ethnic', 'miao',   '苗族',   8),
  ('ethnic', 'zhuang', '壮族',   9),
  -- 出发城市
  ('city', 'kunming',  '昆明',     1),
  ('city', 'dali',     '大理',     2),
  ('city', 'lijiang',  '丽江',     3),
  ('city', 'xishuangbanna', '西双版纳', 4),
  ('city', 'shangrila','香格里拉', 5),
  ('city', 'tengchong','腾冲',     6),
  ('city', 'guiyang',  '贵阳',     7),
  ('city', 'chengdu',  '成都',     8),
  -- 旅行风格（与 travel_product.style_tag 对应）
  ('style', 'nature',  '自然风光', 1),
  ('style', 'culture', '人文历史', 2),
  ('style', 'family',  '亲子游',   3),
  ('style', 'honeymoon','蜜月',    4),
  ('style', 'leisure', '休闲度假', 5),
  ('style', 'hiking',  '徒步探险', 6),
  -- 餐饮偏好
  ('food', 'spicy',    '嗜辣',     1),
  ('food', 'light',    '清淡',     2),
  ('food', 'vegetarian','素食',    3),
  ('food', 'halal',    '清真',     4),
  -- 出行季节
  ('season', 'spring', '春季',     1),
  ('season', 'summer', '夏季',     2),
  ('season', 'autumn', '秋季',     3),
  ('season', 'winter', '冬季',     4)
ON DUPLICATE KEY UPDATE
  dict_value = VALUES(dict_value),
  sort       = VALUES(sort),
  status     = 'ENABLED';
