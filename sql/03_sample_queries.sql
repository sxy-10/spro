-- ============================================================================
--  旅游规划智能体系统 · 常用查询样例（03_sample_queries.sql）
--  用途：① 证明表结构能支撑验收标准 AC1-AC4；② 直接作为 Express 数据访问层的 SQL 蓝本
--  执行：mysql -u root -p travel_agent_db < 03_sample_queries.sql
-- ============================================================================

SET NAMES utf8mb4;
USE travel_agent_db;


-- ---------------------------------------------------------------------------
-- Q1【前端时间轴】一次查出某行程的全部日程项（按天 + 时段 + 序号排序）
--    对应前端 ItineraryScreen 的渲染入参
-- ---------------------------------------------------------------------------
SELECT dp.day_index,
       dp.plan_date,
       dp.city_name,
       dp.theme_title,
       si.time_slot,
       si.seq_no,
       si.item_type,
       si.start_time,
       si.title,
       si.description,
       si.estimated_cost_rmb,
       si.is_estimated,
       p.name       AS poi_name,
       p.rating     AS poi_rating,
       st.transport_mode,
       st.origin,
       st.destination
FROM day_plan dp
JOIN schedule_item si      ON si.day_plan_id = dp.id
LEFT JOIN poi p            ON p.id = si.poi_id
LEFT JOIN schedule_transport st ON st.item_id = si.id
WHERE dp.itinerary_id = 1
ORDER BY dp.day_index,
         FIELD(si.time_slot, 'MORNING', 'AFTERNOON', 'EVENING'),
         si.seq_no;


-- ---------------------------------------------------------------------------
-- Q2【AC1 预算红线】五项之和是否 ≤ 总预算×1.05，超限的行程直接列出
-- ---------------------------------------------------------------------------
SELECT i.itinerary_no,
       i.title,
       i.total_budget_rmb,
       (i.budget_transportation_rmb + i.budget_accommodation_rmb + i.budget_admission_rmb
        + i.budget_meals_rmb + i.budget_reserve_rmb)                    AS allocated_sum,
       ROUND(i.total_budget_rmb * 1.05, 2)                              AS ceiling,
       ROUND((i.budget_transportation_rmb + i.budget_accommodation_rmb + i.budget_admission_rmb
        + i.budget_meals_rmb + i.budget_reserve_rmb) / i.total_budget_rmb * 100, 2) AS used_percent,
       CASE WHEN (i.budget_transportation_rmb + i.budget_accommodation_rmb + i.budget_admission_rmb
        + i.budget_meals_rmb + i.budget_reserve_rmb) > ROUND(i.total_budget_rmb * 1.05, 2)
            THEN '超限预警' ELSE '正常' END                               AS budget_flag
FROM itinerary i
WHERE i.status IN ('PENDING_CONFIRM', 'OPTIMIZING', 'CONFIRMED');


-- ---------------------------------------------------------------------------
-- Q3【预算结构】按日程项类型汇总实际排程费用，与预算分项对比
--    差额 = 预算 - 实排，负数说明该分项超支
-- ---------------------------------------------------------------------------
SELECT i.id AS itinerary_id,
       i.itinerary_no,
       si.item_type,
       COUNT(*)                        AS item_count,
       SUM(si.estimated_cost_rmb)      AS scheduled_cost,
       CASE si.item_type
         WHEN 'TRANSPORT'  THEN i.budget_transportation_rmb
         WHEN 'HOTEL'      THEN i.budget_accommodation_rmb
         WHEN 'ATTRACTION' THEN i.budget_admission_rmb
         WHEN 'MEAL'       THEN i.budget_meals_rmb
       END                             AS budgeted_cost
FROM itinerary i
JOIN day_plan dp      ON dp.itinerary_id = i.id
JOIN schedule_item si ON si.day_plan_id = dp.id
GROUP BY i.id, i.itinerary_no, si.item_type,
         i.budget_transportation_rmb, i.budget_accommodation_rmb, i.budget_admission_rmb, i.budget_meals_rmb
ORDER BY i.id, si.item_type;


-- ---------------------------------------------------------------------------
-- Q4【AC2 版本对比】打印每个版本的变更指令、受影响天，以及快照中第 2 天的条目数
--    实际差异比对在应用层对 snapshot JSON 做 diff（这里已验证快照可被 SQL 直接提取）
-- ---------------------------------------------------------------------------
SELECT v.itinerary_id,
       v.version,
       v.change_type,
       v.affected_day_index,
       v.adjustment_instruction,
       JSON_EXTRACT(v.snapshot, '$.days[1].items')                          AS snapshot_day2_items,
       (SELECT COUNT(*)
          FROM day_plan dp
          JOIN schedule_item si ON si.day_plan_id = dp.id
         WHERE dp.itinerary_id = v.itinerary_id AND dp.day_index = 2)       AS current_day2_items
FROM itinerary_version v
WHERE v.itinerary_id = 1
ORDER BY v.version;


-- ---------------------------------------------------------------------------
-- Q5【AC3 降级审计】哪些外部调用踩了重试/Mock 降级，占比多少，P95 延迟
-- ---------------------------------------------------------------------------
SELECT tool_name,
       provider,
       response_status,
       COUNT(*)                              AS call_count,
       SUM(is_mock)                          AS mock_count,
       ROUND(SUM(is_mock) / COUNT(*) * 100, 2) AS mock_rate_percent,
       MAX(retry_count)                      AS max_retry,
       MAX(latency_ms)                       AS max_latency_ms,
       ROUND(AVG(latency_ms), 0)             AS avg_latency_ms
FROM tool_call_log
GROUP BY tool_name, provider, response_status
ORDER BY mock_count DESC, call_count DESC;


-- ---------------------------------------------------------------------------
-- Q6【AC4 转化率看板】冗余统计字段与埋点明细对账
--    两者不一致说明埋点漏写，应立即告警
-- ---------------------------------------------------------------------------
SELECT p.product_no,
       p.title,
       p.status,
       p.visitor_count,
       p.plans_generated_count,
       p.order_count,
       p.conversion_rate,
       COALESCE(ev.visit_cnt, 0)                                   AS visit_cnt,
       COALESCE(ev.plan_cnt, 0)                                    AS plan_cnt,
       COALESCE(ev.order_cnt, 0)                                   AS order_cnt,
       ROUND(IF(COALESCE(ev.visit_cnt, 0) = 0, 0,
                COALESCE(ev.order_cnt, 0) / ev.visit_cnt), 4)        AS recomputed_rate,
       CASE WHEN (p.visitor_count, p.plans_generated_count, p.order_count)
               = (COALESCE(ev.visit_cnt, 0), COALESCE(ev.plan_cnt, 0), COALESCE(ev.order_cnt, 0))
            THEN '一致' ELSE '需重算' END                              AS reconcile_flag
FROM travel_product p
LEFT JOIN (
  SELECT product_id,
         SUM(event_type = 'VISIT')          AS visit_cnt,
         SUM(event_type = 'PLAN_GENERATED') AS plan_cnt,
         SUM(event_type = 'ORDER')          AS order_cnt
  FROM product_stat_event
  GROUP BY product_id
) ev ON ev.product_id = p.id
ORDER BY p.conversion_rate DESC;


-- ---------------------------------------------------------------------------
-- Q7【AC4 下钻】单条线路的转化漏斗明细（浏览 → 生成行程 → 下单）
-- ---------------------------------------------------------------------------
SELECT e.occurred_at,
       e.event_type,
       u.username,
       u.nickname,
       i.itinerary_no,
       o.order_no,
       o.total_amount,
       o.status AS order_status
FROM product_stat_event e
LEFT JOIN sys_user u    ON u.id = e.user_id
LEFT JOIN itinerary i   ON i.id = e.itinerary_id
LEFT JOIN tour_order o  ON o.id = e.order_id
WHERE e.product_id = 1
ORDER BY e.occurred_at;


-- ---------------------------------------------------------------------------
-- Q8【运营热点】目的地城市热度 Top N（管理端 popularDestinations）
--    用偏好里的目的地城市统计，覆盖自由对话生成的行程（不依赖线路产品）
-- ---------------------------------------------------------------------------
SELECT pd.city_name,
       COUNT(DISTINCT tp.id)                           AS plan_count,
       ROUND(COUNT(DISTINCT tp.id) / (SELECT COUNT(DISTINCT itinerary_id)
                                        FROM travel_preference
                                       WHERE itinerary_id IS NOT NULL) * 100, 1) AS share_percent
FROM preference_destination pd
JOIN travel_preference tp ON tp.id = pd.preference_id
WHERE tp.itinerary_id IS NOT NULL
GROUP BY pd.city_name
ORDER BY plan_count DESC
LIMIT 10;


-- ---------------------------------------------------------------------------
-- Q9【动线顺路计算】同一天相邻两个景点的大圆距离（米）
--    generatePlan 的「不走回头路」依据；DECIMAL(9,6) 精度直接决定结果可信度
-- ---------------------------------------------------------------------------
SELECT dp.day_index,
       a.seq_no                                     AS from_seq,
       pa.name                                      AS from_poi,
       b.seq_no                                     AS to_seq,
       pb.name                                      AS to_poi,
       ROUND(ST_Distance_Sphere(POINT(pa.longitude, pa.latitude),
                                POINT(pb.longitude, pb.latitude)), 0) AS distance_meters
FROM day_plan dp
JOIN schedule_item a  ON a.day_plan_id = dp.id AND a.poi_id IS NOT NULL
JOIN schedule_item b  ON b.day_plan_id = dp.id AND b.poi_id IS NOT NULL AND b.seq_no > a.seq_no
JOIN poi pa           ON pa.id = a.poi_id
JOIN poi pb           ON pb.id = b.poi_id
WHERE dp.itinerary_id = 1
ORDER BY dp.day_index, a.seq_no, b.seq_no;


-- ---------------------------------------------------------------------------
-- Q10【状态机巡检】卡在生成中/优化中超过 10 分钟的行程（需人工兜底）
-- ---------------------------------------------------------------------------
SELECT id, itinerary_no, title, status, version,
       TIMESTAMPDIFF(MINUTE, updated_at, NOW()) AS stuck_minutes,
       fail_reason
FROM itinerary
WHERE status IN ('DRAFT', 'PLANNING', 'OPTIMIZING')
  AND updated_at < NOW() - INTERVAL 10 MINUTE
ORDER BY updated_at;


-- ---------------------------------------------------------------------------
-- Q11【行程完整视图】给导出/打印用：行程 + 锦囊 + 天数统计
-- ---------------------------------------------------------------------------
SELECT i.itinerary_no,
       i.title,
       i.status,
       i.version,
       i.start_date,
       i.end_date,
       n.weather_overview,
       n.temperature_range,
       n.clothing_suggestions,
       JSON_LENGTH(n.avoid_trap_tips) AS trap_tip_count,
       (SELECT COUNT(*) FROM day_plan dp WHERE dp.itinerary_id = i.id)             AS day_count,
       (SELECT COUNT(*) FROM day_plan dp JOIN schedule_item si ON si.day_plan_id = dp.id
         WHERE dp.itinerary_id = i.id)                                             AS item_count
FROM itinerary i
LEFT JOIN itinerary_notice n ON n.itinerary_id = i.id
WHERE i.itinerary_no = '01JB8Z3K7Q2M5X9V4T6R8Y0P1C';
