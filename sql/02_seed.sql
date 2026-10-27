-- ============================================================================
--  旅游规划智能体系统 · 演示数据（Seed）
--  执行：mysql -u root -p travel_agent_db < 02_seed.sql
--  说明：覆盖「一句话规划 → 行程单 → 日程 → 日程项」全链路，
--       同时构造 B 端产品埋点与转化率样例，便于答辩演示与联调。
--       演示账号：admin / password（管理员）、xiaoyu / password（游客）
--       password_hash 为占位 bcrypt 串，正式环境请重新生成。
--  注意：插入顺序按外键依赖排列，请勿随意调换。
-- ============================================================================

SET NAMES utf8mb4;
USE travel_agent_db;

START TRANSACTION;

-- ---------------------------------------------------------------- 1. 机构与账号
INSERT INTO travel_agency (id, agency_name, license_no, contact_name, contact_phone)
VALUES (1, '云南康辉国际旅行社', 'L-YN-CJ00123', '李经理', '0871-63001234');

INSERT INTO sys_user (id, agency_id, username, password_hash, nickname, phone, role, default_departure_city)
VALUES
  (1, 1, 'admin',  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '线路运营小王', '13800000001', 'ADMIN',   '昆明'),
  (2, NULL, 'xiaoyu', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '小雨',       '13800000002', 'TOURIST', '成都');


-- ---------------------------------------------------------------- 2. 线路产品
INSERT INTO travel_product
  (id, product_no, agency_id, title, destination, default_days, style_tag, base_price_rmb, status,
   visitor_count, plans_generated_count, order_count, created_by, description)
VALUES
  (1, 'prod_001', 1, '云南大理丽江5日沉浸风情游', '云南', 5, '休闲慢节奏', 2899.00, 'ON_SALE', 3, 1, 1, 1,
   '昆明进大理出，全程无购物，含洱海生态廊道与古城深度漫游。'),
  (2, 'prod_002', 1, '川西川藏南线7日越野风光自驾', '四川/西藏', 7, '摄影与自驾', 4680.00, 'ON_SALE', 2, 1, 0, 1,
   '四姑娘山—丹巴—新都桥—稻城亚丁，越野车队随行。'),
  (3, 'prod_003', 1, '贵州荔波黄果树4日亲子游', '贵州', 4, '亲子研学', 2199.00, 'OFF_SALE', 0, 0, 0, 1,
   '小七孔戏水 + 黄果树瀑布，含儿童研学手册。');


-- ---------------------------------------------------------------- 3. POI 主数据
INSERT INTO poi (id, poi_type, name, city_name, district, address, latitude, longitude, rating,
                 tel, opening_hours, source_poi_id, data_source, is_estimated, status) VALUES
  (1, 'ATTRACTION', '翠湖公园',           '昆明', '五华区', '翠湖南路67号',        25.049300, 102.702800, 4.6, '0871-63160000', '06:30-22:00', 'B00190XYZ1', 'AMAP', 0, 'ACTIVE'),
  (2, 'RESTAURANT', '建新园·传统过桥米线', '昆明', '五华区', '东风西路123号',       25.040100, 102.710300, 4.4, '0871-63610000', '10:00-21:00', 'B00190XYZ2', 'AMAP', 0, 'ACTIVE'),
  (3, 'HOTEL',      '昆明翠湖宾馆',       '昆明', '五华区', '翠湖南路59号',        25.048000, 102.701500, 4.7, '0871-65158888', '全天',        'B00190XYZ3', 'AMAP', 0, 'ACTIVE'),
  (4, 'ATTRACTION', '洱海生态廊道',       '大理', '大理市', '才村码头至龙龛码头',   25.680200, 100.183600, 4.8, NULL,           '全天',        'B0FFGXYZ04', 'AMAP', 0, 'ACTIVE'),
  (5, 'RESTAURANT', '段公子·野生菌土鸡煲', '大理', '大理市', '人民路下段88号',      25.693500, 100.161200, 4.5, '0872-2678888', '11:00-22:00', 'B0FFGXYZ05', 'AMAP', 0, 'ACTIVE'),
  (6, 'HOTEL',      '大理古城漫心客栈',   '大理', '大理市', '复兴路262号',         25.694800, 100.160100, 4.6, '0872-2519999', '全天',        'B0FFGXYZ06', 'AMAP', 0, 'ACTIVE'),
  (7, 'ATTRACTION', '昆明老街',           '昆明', '五华区', '光华街与文明街交叉口', 25.038600, 102.712900, 4.3, NULL,           '全天',        'B00190XYZ7', 'AMAP', 0, 'ACTIVE'),
  (8, 'RESTAURANT', '大理人民路小吃街',   '大理', '大理市', '人民路中段',          25.692100, 100.162800, 4.2, NULL,           '17:00-24:00', 'B0FFGXYZ08', 'AMAP', 0, 'ACTIVE');

INSERT INTO poi_attraction (poi_id, ticket_price_rmb, suggested_duration_hours, booking_notice, category_tag, best_visit_time) VALUES
  (1, 0.00,  2.0, '免费开放，无需预约',                          '城市公园', '清晨或傍晚'),
  (4, 0.00,  3.5, '廊道骑行需在官方小程序租车，旺季提前1天预约', '自然风光', '上午光线柔和'),
  (7, 0.00,  1.5, '无需预约，夜间人流较大注意随身物品',          '人文古迹', '傍晚至夜间');

INSERT INTO poi_restaurant (poi_id, cuisine_type, average_cost_rmb, signature_dishes, business_hours, has_private_room) VALUES
  (2, '滇菜', 35.00,  '["菊花过桥米线","冷脆鸡"]',      '10:00-21:00', 0),
  (5, '滇菜', 68.00,  '["松茸土鸡汤","包浆豆腐"]',      '11:00-22:00', 1),
  (8, '小吃', 45.00,  '["烤乳扇","凉鸡米线","喜洲粑粑"]', '17:00-24:00', 0);

INSERT INTO poi_hotel (poi_id, hotel_type, star_level, price_per_night_rmb, near_metro, key_features, check_in_time) VALUES
  (3, '星级酒店', 5, 620.00, 1, '["近翠湖","含双早","可寄存行李"]', '14:00:00'),
  (6, '精品客栈', 4, 380.00, 0, '["近古城","含早","庭院观景"]',     '14:00:00');


-- ---------------------------------------------------------------- 4. 会话
INSERT INTO chat_session (id, user_id, title, status, message_count, last_active_at) VALUES
  (1, 2, '带爸妈去昆明大理2天', 'ACTIVE', 3, '2026-10-20 20:15:00');


-- ---------------------------------------------------------------- 5. 行程单（PENDING_CONFIRM, version=1）
-- 预算校验：900+1050+450+450+150 = 3000 ≤ 3000×1.05
INSERT INTO itinerary
  (id, itinerary_no, user_id, session_id, product_id, title, summary, status, version,
   days_count, nights_count, start_date, end_date, total_budget_rmb,
   budget_transportation_rmb, budget_accommodation_rmb, budget_admission_rmb,
   budget_meals_rmb, budget_reserve_rmb, is_estimated)
VALUES
  (1, '01JB8Z3K7Q2M5X9V4T6R8Y0P1C', 2, 1, 1,
   '成都出发 → 昆明/大理 2天1晚慢节奏之旅',
   '专为2人定制，含父母同行，全程不走回头路，日均步行≤8000步。',
   'PENDING_CONFIRM', 1, 2, 1, '2026-11-01', '2026-11-02', 3000.00,
   900.00, 1050.00, 450.00, 450.00, 150.00, 0);

INSERT INTO itinerary_notice
  (itinerary_id, weather_overview, temperature_range, clothing_suggestions,
   essential_documents, avoid_trap_tips, police_number, nearest_hospital, tourist_hotline)
VALUES
  (1, '晴转多云', '12℃-22℃', '早晚温差大，建议薄外套+长袖，穿舒适步行鞋',
   '["身份证原件","老年证（门票优惠）","医保卡"]',
   '["车站出站口拒绝主动揽客的黑车与无证导游","景区“开光银饰”溢价高，理性选购","打车请使用正规网约车并核对车牌"]',
   '110', '昆明市第一人民医院（急诊24小时）', '0871-12345');

INSERT INTO day_plan (id, itinerary_id, day_index, plan_date, city_name, theme_title, weather_text, temperature_text, weather_icon) VALUES
  (1, 1, 1, '2026-11-01', '昆明', '初抵春城·老街滇味', '晴',   '22℃', '☀️'),
  (2, 1, 2, '2026-11-02', '大理', '洱海慢调·苍山环抱', '多云', '21℃', '⛅');

INSERT INTO day_tip (day_plan_id, seq_no, content) VALUES
  (1, 1, '翠湖周边停车紧张，建议地铁3号线至五一路站步行前往'),
  (1, 2, '午市过桥米线 11:30 前到店可避开排队高峰'),
  (2, 1, '大理站出站后乘直通车至才村码头，比打车省 30 元'),
  (2, 2, '洱海廊道风大，骑行建议加一件防风外套');

-- 日程项：D1 昆明
INSERT INTO schedule_item
  (id, day_plan_id, time_slot, item_type, seq_no, start_time, end_time, title, description, poi_id,
   duration_hours, nights, meal_type, estimated_cost_rmb, is_estimated, booking_url, highlight_reason)
VALUES
  (1, 1, 'MORNING',   'TRANSPORT',  1, '08:00:00', '11:35:00', '成都东 ➔ 昆明南', '高铁二等座，历时 3h35m', NULL,
   3.6, NULL, NULL, 380.00, 0, NULL, '早班车落地即可午餐，不浪费半天'),
  (2, 1, 'AFTERNOON', 'MEAL',       1, '12:00:00', '13:00:00', '建新园·传统过桥米线', '百年老店，高汤滚烫锁鲜', 2,
   1.0, NULL, 'LUNCH', 70.00, 0, NULL, '距翠湖步行 400 米，顺路就餐'),
  (3, 1, 'AFTERNOON', 'ATTRACTION', 2, '13:30:00', '16:00:00', '翠湖公园', '环湖漫步，冬季可观红嘴鸥', 1,
   2.5, NULL, NULL, 0.00, 0, NULL, '免费开放，步道平缓适合父母'),
  (4, 1, 'EVENING',   'ATTRACTION', 1, '17:00:00', '19:00:00', '昆明老街', '光华街老茶馆与法式黄墙打卡', 7,
   2.0, NULL, NULL, 0.00, 0, NULL, '与翠湖同一片区，步行 15 分钟可达'),
  (5, 1, 'EVENING',   'HOTEL',      2, '20:00:00', '23:59:00', '昆明翠湖宾馆', '五星，含双早，可寄存行李', 3,
   NULL, 1, NULL, 620.00, 0, NULL, '次日返程取行李方便，距地铁站 300 米');

-- 日程项：D2 大理
INSERT INTO schedule_item
  (id, day_plan_id, time_slot, item_type, seq_no, start_time, end_time, title, description, poi_id,
   duration_hours, nights, meal_type, estimated_cost_rmb, is_estimated, booking_url, highlight_reason)
VALUES
  (6, 2, 'MORNING',   'TRANSPORT',  1, '08:30:00', '10:40:00', '昆明南 ➔ 大理', '动车 D8712 二等座', NULL,
   2.2, NULL, NULL, 290.00, 0, NULL, '出站即有景区直通车直达洱海东'),
  (7, 2, 'AFTERNOON', 'MEAL',       1, '11:30:00', '12:40:00', '段公子·野生菌土鸡煲', '慢熬汤底温补不辣', 5,
   1.2, NULL, 'LUNCH', 136.00, 0, NULL, '位于古城主路口，餐后直接前往洱海'),
  (8, 2, 'AFTERNOON', 'ATTRACTION', 2, '13:30:00', '17:00:00', '洱海生态廊道', '才村—龙龛段骑行，观苍山洱海', 4,
   3.5, NULL, NULL, 80.00, 0, NULL, '与午餐点同向，无折返'),
  (9, 2, 'EVENING',   'MEAL',       1, '18:00:00', '19:30:00', '大理人民路小吃街', '烤乳扇、凉鸡米线、喜洲粑粑', 8,
   1.5, NULL, 'DINNER', 90.00, 0, NULL, '紧邻客栈，夜游古城顺路'),
  (10, 2, 'EVENING',  'HOTEL',      2, '20:00:00', '23:59:00', '大理古城漫心客栈', '庭院观景房，含早', 6,
   NULL, 1, NULL, 380.00, 0, NULL, '位于古城内，次日清晨可逛早市');

INSERT INTO schedule_transport (item_id, segment_type, transport_mode, origin, destination, duration_minutes, transfer_tips) VALUES
  (1, 'INTERCITY', 'HSR', '成都东站', '昆明南站', 215, '昆明南站转地铁1号线→3号线至五一路站'),
  (6, 'INTERCITY', 'HSR', '昆明南站', '大理站',   130, '大理站出站乘景区直通车至才村码头，约25分钟');


-- ---------------------------------------------------------------- 6. 对话消息（引用行程单，故放在行程之后）
INSERT INTO chat_message (id, session_id, sender, content, itinerary_id, intent_tags, tool_tags, token_count, created_at) VALUES
  (1, 1, 'USER',      '带爸妈去昆明大理玩2天，预算3000，节奏慢一点，别安排购物。', NULL, '["亲子","慢节奏"]', NULL, 42, '2026-10-20 20:12:00.000'),
  (2, 1, 'ASSISTANT', '已识别：成都出发、昆明+大理、2天1晚、2人、预算3000、慢节奏、无购物。正在为你排程…',
                      NULL, NULL, '["WEATHER","ATTRACTION","TRANSPORT","HOTEL","FOOD"]', 186, '2026-10-20 20:12:06.000'),
  (3, 1, 'ASSISTANT', '已生成 2 天行程，全程不走回头路，单日车程≤3.5h。点击查看时间轴。',
                      1,   '["行程已生成"]', '[]', 420, '2026-10-20 20:15:00.000');


-- ---------------------------------------------------------------- 7. 偏好（回填 itinerary_id）
INSERT INTO travel_preference
  (id, session_id, itinerary_id, departure_city, days_count, nights_count, traveler_count,
   budget_total_rmb, pace, travel_style, hotel_preference, avoid_shopping, additional_requirements,
   raw_input, extract_source)
VALUES
  (1, 1, 1, '成都', 2, 1, 2, 3000.00, 'SLOW', 'FAMILY', 'NEAR_ATTRACTION', 1,
   '带父母出行，节奏要慢，酒店离景点近，不要购物点',
   '带爸妈去昆明大理玩2天，预算3000，节奏慢一点，别安排购物。', 'LLM');

INSERT INTO preference_destination (preference_id, city_name, seq_no) VALUES
  (1, '昆明', 1), (1, '大理', 2);

INSERT INTO preference_tag (preference_id, tag_type, tag_value) VALUES
  (1, 'INTEREST', '摄影'), (1, 'INTEREST', '休闲'), (1, 'DIETARY', '忌辣');


-- ---------------------------------------------------------------- 8. 版本快照
INSERT INTO itinerary_version (itinerary_id, version, change_type, adjustment_instruction, affected_day_index, snapshot, created_by)
VALUES
  (1, 1, 'GENERATE', NULL, NULL,
   '{"itineraryNo":"01JB8Z3K7Q2M5X9V4T6R8Y0P1C","version":1,"status":"PENDING_CONFIRM","days":[{"dayIndex":1,"city":"昆明","items":5},{"dayIndex":2,"city":"大理","items":5}]}',
   2);


-- ---------------------------------------------------------------- 9. B 端埋点与订单（AC4：转化率 = 下单数/访客数）
INSERT INTO product_stat_event (product_id, user_id, event_type, itinerary_id, order_id, occurred_at) VALUES
  (1, 2,    'VISIT',           NULL, NULL, '2026-10-20 20:05:00'),
  (1, 2,    'PLAN_GENERATED',  1,    NULL, '2026-10-20 20:15:00'),
  (1, NULL, 'VISIT',           NULL, NULL, '2026-10-21 09:30:00'),
  (1, NULL, 'VISIT',           NULL, NULL, '2026-10-22 14:10:00'),
  (1, 2,    'ORDER',           NULL, 1,    '2026-10-22 14:20:00'),
  (2, 2,    'VISIT',           NULL, NULL, '2026-10-19 10:00:00'),
  (2, NULL, 'VISIT',           NULL, NULL, '2026-10-19 11:00:00'),
  (2, 2,    'PLAN_GENERATED',  NULL, NULL, '2026-10-19 10:30:00');

INSERT INTO tour_order
  (id, order_no, user_id, product_id, itinerary_id, traveler_count, total_amount, status,
   contact_name, contact_phone, created_at, paid_at)
VALUES
  (1, 'SO202610220001', 2, 1, 1, 2, 5798.00, 'PAID', '张*雨', '138****0002', '2026-10-22 14:20:00', '2026-10-22 14:22:00');


-- ---------------------------------------------------------------- 10. 工具调用日志（含一次断网降级，AC3 证据链）
INSERT INTO tool_call_log (session_id, itinerary_id, tool_name, provider, request_summary, response_status, retry_count, is_mock, latency_ms, error_message, created_at) VALUES
  (1, 1,  'WEATHER',   'qweather', 'city=昆明',                         'SUCCESS',       0, 0, 820,   NULL, '2026-10-20 20:12:07.000'),
  (1, 1,  'ATTRACTION','amap',     'city=昆明;type=ATTRACTION',         'SUCCESS',       0, 0, 640,   NULL, '2026-10-20 20:12:08.000'),
  (1, 1,  'HOTEL',     'amap',     'city=大理;near=洱海',               'SUCCESS',       1, 0, 1580,  '首次超时，重试成功', '2026-10-20 20:12:11.000'),
  (1, 1,  'FOOD',      'amap',     'city=大理;diet=忌辣',               'SUCCESS',       0, 0, 900,   NULL, '2026-10-20 20:12:12.000'),
  (1, NULL,'TRANSPORT','12306',    'from=成都;to=昆明;date=2026-11-01', 'MOCK_FALLBACK', 3, 1, 10020, '票务接口连续 3 次超时，降级为 Mock 估算价', '2026-10-22 09:00:00.000');


-- ---------------------------------------------------------------- 11. 收藏
INSERT INTO user_favorite (user_id, target_type, target_id) VALUES
  (2, 'POI', 4), (2, 'ITINERARY', 1);

COMMIT;

-- ============================================================================
--  校验查询（执行后可直接看到数据是否自洽）
-- ============================================================================
SELECT i.itinerary_no, i.status, i.version, i.total_budget_rmb,
       (i.budget_transportation_rmb + i.budget_accommodation_rmb + i.budget_admission_rmb
        + i.budget_meals_rmb + i.budget_reserve_rmb) AS budget_sum,
       ROUND(i.total_budget_rmb * 1.05, 2) AS budget_ceiling
FROM itinerary i;

SELECT p.product_no, p.title, p.status, p.is_active, p.visitor_count, p.order_count, p.conversion_rate
FROM travel_product p;
