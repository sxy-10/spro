/**
 * scripts/seedDemo.ts —— Web 端（B 端 + 平台端）演示数据播种
 * 用途：在 migrate.ts 之后执行，为 17 个后台页面提供真实可查的数据。
 * 运行：npx tsx scripts/seedDemo.ts
 * 幂等：全部走 ON DUPLICATE KEY UPDATE / INSERT IGNORE，可重复执行。
 * 账号（密码统一 Admin@2026，演示环境仅此强度）：
 *   super     平台超级管理员（SUPER_ADMIN）
 *   admin     四川山水行 旅行社管理员（AGENCY_ADMIN）
 *   staff02   四川山水行 业务专员（AGENCY_STAFF）
 *   yun_admin 云南风旅行社 旅行社管理员（AGENCY_ADMIN）
 *   xiaoyu 等 4 位游客（TOURIST）
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'travel_agent_db';

const PASSWORD = 'Admin@2026';

const run = async () => {
  if (!DB_PASSWORD) {
    console.error('[seed] 缺少 DB_PASSWORD，请先配置 backend/.env');
    process.exit(1);
  }
  const conn = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: DB_NAME });
  const hash = bcrypt.hashSync(PASSWORD, 12);
  const q = async (sql: string, params: unknown[] = []) => {
    try {
      // MariaDB 10.4 对部分预编译表达式（如 ROUND(?*0.05,2)）兼容性差，播种用文本协议 query()
      return (await conn.query(sql, params))[0];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[seed] 语句失败：${sql.slice(0, 120)}\n[seed] 参数：${JSON.stringify(params).slice(0, 200)}\n[seed] 错误：${msg}`);
      throw err;
    }
  };

  await conn.beginTransaction();
  try {
    // ---------------------------------------------------------------- 1. 机构
    await q(`UPDATE travel_agency SET agency_name='四川山水行旅行社', license_no='L-SC-01234',
               contact_name='彭湘媛', contact_phone='028-88886666',
               intro='专注西南自然风光与休闲度假线路，提供 AI 辅助规划与跟团出行服务。',
               notify_prefs=JSON_OBJECT('new_order',TRUE,'pending_warn',TRUE,'stock_warn',FALSE,'daily_report',TRUE)
             WHERE id=1`);
    await q(`INSERT INTO travel_agency (id, agency_name, license_no, contact_name, contact_phone, status, intro, commission_rate)
               VALUES (2,'云南风旅行社','LL-YN-00871','杨女士','0871-66668888','ACTIVE','深耕云南本地游与雨林生态线路。',0.0500)
             ON DUPLICATE KEY UPDATE agency_name=VALUES(agency_name)`);
    await q(`INSERT INTO travel_agency (id, agency_name, license_no, contact_name, contact_phone, status, intro)
               VALUES (9,'平台运营中心','PLAT-00001','平台管理员','010-90000000','ACTIVE','平台方内部机构（承载平台管理员账号）。')
             ON DUPLICATE KEY UPDATE agency_name=VALUES(agency_name)`);

    // ---------------------------------------------------------------- 2. 账号与角色
    await q(`UPDATE sys_user SET nickname='彭湘媛', password_hash=? WHERE id=1 AND username='admin'`, [hash]);
    await q(`UPDATE sys_user SET password_hash=? WHERE id=2 AND username='xiaoyu'`, [hash]);
    const users: Array<[number, number | null, string, string, string, string, string]> = [
      // [id, agency_id, username, nickname, phone, role, departure]
      [10, 9, 'super', '平台超管', '13800000010', 'ADMIN', '北京'],
      [11, null, 'tourist01', '山间清风', '13811115678', 'TOURIST', '成都'],
      [12, null, 'tourist02', '徒步阿凯', '13522220917', 'TOURIST', '绵阳'],
      [13, null, 'tourist03', '朵朵妈', '13733338433', 'TOURIST', '成都'],
      [14, null, 'tourist04', '远山回响', '13644443352', 'TOURIST', '重庆'],
      [20, 1, 'staff02', '小周', '13755553310', 'ADMIN', '成都'],
      [21, 2, 'yun_admin', '杨女士', '13866668888', 'ADMIN', '昆明']
    ];
    for (const [id, agencyId, username, nickname, phone, role, city] of users) {
      await q(`INSERT INTO sys_user (id, agency_id, username, password_hash, nickname, phone, role, default_departure_city)
                 VALUES (?,?,?,?,?,?,?,?)
               ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), nickname=VALUES(nickname)`,
        [id, agencyId, username, hash, nickname, phone, role, city]);
    }
    const userRoles: Array<[number, number]> = [
      [1, 2], [2, 1], [10, 3], [11, 1], [12, 1], [13, 1], [14, 1], [20, 4], [21, 2]
    ];
    for (const [uid, rid] of userRoles) {
      await q('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [uid, rid]);
    }

    // ---------------------------------------------------------------- 3. 线路产品
    const products: Array<[number, string, number, string, string, number, string, string, string, number, number, number, string]> = [
      // [id, no, agency, title, dest, days, style, status, audit, visitor, plans, orders, desc]
      [11, 'prod_101', 1, '贵州荔波 4 天 3 晚', '黔南 · 荔波', 4, '休闲慢节奏', 'ON_SALE', 'APPROVED', 326, 98, 49, '小七孔、茂兰与瑶山古寨，山水休闲慢节奏，含特色酸汤鱼宴。'],
      [12, 'prod_102', 1, '云南大理 5 天 4 晚', '大理', 5, '自然风光', 'ON_SALE', 'APPROVED', 287, 86, 40, '洱海生态廊道骑行 + 苍山步道 + 双廊古镇，全程无购物。'],
      [13, 'prod_103', 1, '川西小环线 3 天 2 晚', '甘孜', 3, '户外徒步', 'DRAFT', 'NONE', 192, 54, 22, '四姑娘山—丹巴—新都桥轻徒步小环线。'],
      [14, 'prod_104', 1, '丽江香格里拉 6 天 5 晚', '滇西北', 6, '深度游', 'ON_SALE', 'APPROVED', 164, 41, 16, '丽江古城 + 虎跳峡 + 普达措国家公园深度游。'],
      [15, 'prod_105', 1, '成都周边古镇 2 天 1 晚', '成都', 2, '亲子休闲', 'OFF_SALE', 'APPROVED', 123, 30, 10, '黄龙溪 + 安仁古镇亲子慢游，含非遗体验课。'],
      [21, 'prod_201', 2, '西双版纳雨林 4 天 3 晚', '西双版纳', 4, '自然风光', 'ON_SALE', 'APPROVED', 210, 60, 28, '中科院植物园 + 野象谷 + 傣族园，雨林生态研学。'],
      [22, 'prod_202', 2, '黔东南侗寨 5 天 4 晚', '黔东南', 5, '休闲慢节奏', 'DRAFT', 'PENDING', 0, 0, 0, '涵盖肇兴侗寨、堂安梯田、岜沙苗寨，含特色长桌宴与非遗体验，节奏休闲。']
    ];
    for (const [id, no, agency, title, dest, days, style, status, audit, visitor, plans, orders, desc] of products) {
      await q(`INSERT INTO travel_product (id, product_no, agency_id, title, destination, default_days, style_tag,
                 base_price_rmb, status, audit_status, visitor_count, plans_generated_count, order_count, created_by, description)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON DUPLICATE KEY UPDATE title=VALUES(title), status=VALUES(status), audit_status=VALUES(audit_status),
                 visitor_count=VALUES(visitor_count), plans_generated_count=VALUES(plans_generated_count), order_count=VALUES(order_count)`,
        [id, no, agency, title, dest, days, style, 1000, status, audit, visitor, plans, orders, agency === 1 ? 1 : 21, desc]);
    }
    // 基准价单独 UPDATE（插入时用 1000 占位满足 chk_product_price），避免 ON DUPLICATE 覆盖时的参数混乱
    await q(`UPDATE travel_product SET base_price_rmb=2680 WHERE id=11`);
    await q(`UPDATE travel_product SET base_price_rmb=2800 WHERE id=12`);
    await q(`UPDATE travel_product SET base_price_rmb=1980 WHERE id=13`);
    await q(`UPDATE travel_product SET base_price_rmb=3480 WHERE id=14`);
    await q(`UPDATE travel_product SET base_price_rmb=680 WHERE id=15`);
    await q(`UPDATE travel_product SET base_price_rmb=2560 WHERE id=21`);
    await q(`UPDATE travel_product SET base_price_rmb=2980 WHERE id=22`);

    // ---------------------------------------------------------------- 4. 库存（未来 14 天）
    for (const rid of [11, 12, 14, 21]) {
      await q(`INSERT IGNORE INTO route_stock (route_id, travel_date, total_seats, locked_seats, sold_seats)
                 SELECT ?, DATE_ADD(CURDATE(), INTERVAL seq DAY), 40, 0, 0
                 FROM (SELECT (@s := @s + 1) AS seq FROM information_schema.columns, (SELECT @s := -1) init LIMIT 14) d`, [rid]);
    }
    await q(`UPDATE route_stock SET sold_seats=12 WHERE route_id=11 AND travel_date=DATE_ADD(CURDATE(), INTERVAL 8 DAY)`);
    await q(`UPDATE route_stock SET sold_seats=8  WHERE route_id=12 AND travel_date=DATE_ADD(CURDATE(), INTERVAL 10 DAY)`);
    await q(`UPDATE route_stock SET total_seats=20, sold_seats=18 WHERE route_id=12 AND travel_date=DATE_ADD(CURDATE(), INTERVAL 7 DAY)`);
    await q(`UPDATE route_stock SET sold_seats=6  WHERE route_id=14 AND travel_date=DATE_ADD(CURDATE(), INTERVAL 3 DAY)`);
    await q(`UPDATE route_stock SET sold_seats=9  WHERE route_id=21 AND travel_date=DATE_ADD(CURDATE(), INTERVAL 4 DAY)`);

    // ---------------------------------------------------------------- 5. 订单
    const orders: Array<[string, number, number, number, string, string, string, string | null]> = [
      // [order_no, user, product, people, status, travel_date_offset, contact_name, contact_phone]
      ['SO2026111208', 11, 11, 2, 'PAID', '8', '王女士', '13811115678'],
      ['SO2026111207', 12, 12, 4, 'PAID', '10', '李先生', '13522220917'],
      ['SO2026111206', 13, 14, 2, 'CONFIRMED', '3', '张先生', '13733338433'],
      ['SO2026111119', 14, 11, 3, 'COMPLETED', '-6', '刘女士', '13644443352'],
      ['SO2026111115', 12, 14, 2, 'CANCELLED', '5', '陈先生', '13522220917'],
      ['SO2026111110', 13, 11, 5, 'REFUNDED', '6', '赵女士', '13733338433'],
      ['SO2026111104', 11, 21, 6, 'CONFIRMED', '4', '吴女士', '13811115678'],
      ['SO2026111105', 12, 12, 2, 'PENDING', '9', '孙先生', '13522220917']
    ];
    for (const [no, uid, pid, people, status, off, cname, cphone] of orders) {
      await q(`INSERT INTO tour_order (order_no, user_id, product_id, traveler_count, total_amount, status,
                 contact_name, contact_phone, travel_date, is_stock_locked, expires_at,
                 created_at, paid_at, confirmed_at, confirm_remark, refunded_at, refund_reason, cancelled_at)
                 VALUES (?, ?, ?, ?,
                   (SELECT base_price_rmb FROM travel_product WHERE id=?)*?, ?, ?, ?,
                   DATE_ADD(CURDATE(), INTERVAL ? DAY), 0, NULL,
                   DATE_ADD(NOW(), INTERVAL -3 DAY),
                   IF(? IN ('PAID','CONFIRMED','COMPLETED','REFUNDED'), DATE_ADD(NOW(), INTERVAL -3 DAY), NULL),
                   IF(? = 'CONFIRMED', DATE_ADD(NOW(), INTERVAL -1 DAY), NULL),
                   IF(? = 'CONFIRMED', '已电话确认出行细节', NULL),
                   IF(? = 'REFUNDED', DATE_ADD(NOW(), INTERVAL -1 DAY), NULL),
                   IF(? = 'REFUNDED', '行程冲突，游客申请退款', NULL),
                   IF(? = 'CANCELLED', DATE_ADD(NOW(), INTERVAL -1 DAY), NULL))
               ON DUPLICATE KEY UPDATE status=VALUES(status)`,
        [no, uid, pid, people, pid, people, status, cname, cphone, off,
          status, status, status, status, status, status]);
    }

    // ---------------------------------------------------------------- 6. 特产
    const souvenirs: Array<[number, string, number, string, string, number | null, string, number, number, number, string, string]> = [
      // [id, no, agency, name, category, link_route, price, stock, sales, status, audit, desc]
      [1, 'sou_001', 1, '荔波青梅蜜饯', '特色食品', 11, 39, 120, 46, 'ON_SALE', 'APPROVED', '荔波本地青梅古法腌制，酸甜适口。'],
      [2, 'sou_002', 1, '白族扎染手帕', '手工艺品', 12, 89, 60, 18, 'ON_SALE', 'APPROVED', '大理周城白族手工扎染，一巾一纹样。'],
      [3, 'sou_003', 1, '川西牦牛肉干', '特色食品', 13, 68, 0, 73, 'OFF_SALE', 'APPROVED', '高原散养牦牛，五香味。'],
      [14, 'sou_014', 2, '大理乳扇礼盒', '特色食品', null, 79, 200, 5, 'OFF_SALE', 'PENDING', '云南风味乳制品礼盒，含烤制说明。'],
      [15, 'sou_015', 2, '苗族银饰书签', '手工艺品', null, 45, 150, 22, 'ON_SALE', 'APPROVED', '黔东南手工苗银书签。']
    ];
    for (const [id, no, agency, name, category, link, price, stock, sales, status, audit, desc] of souvenirs) {
      await q(`INSERT INTO souvenir (id, product_no, agency_id, name, category, link_route_id, price, stock, sales, status, audit_status, description, created_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON DUPLICATE KEY UPDATE name=VALUES(name), price=VALUES(price), stock=VALUES(stock),
                 sales=VALUES(sales), status=VALUES(status), audit_status=VALUES(audit_status)`,
        [id, no, agency, name, category, link, price, stock, sales, status, audit, desc, agency === 1 ? 1 : 21]);
    }

    // ---------------------------------------------------------------- 7. 导游
    const guides: Array<[number, number, string, string, string, string, string, string, number, string]> = [
      // [id, agency, name, gender, phone, license, specialty, status, teamCount]
      [1, 1, '周导', '男', '13800001120', 'D-SC-52010008', '自然风光', 'ACTIVE', 26],
      [2, 1, '吴导', '女', '13900006634', 'D-SC-52010017', '亲子休闲', 'ACTIVE', 18],
      [3, 1, '郑导', '男', '13700009025', 'D-SC-52010033', '户外徒步', 'DISABLED', 31],
      [4, 2, '和导', '女', '13600004421', 'D-YN-53010021', '深度游', 'ACTIVE', 22]
    ];
    for (const [id, agency, name, gender, phone, license, specialty, status, teamCount] of guides) {
      await q(`INSERT INTO guide (id, agency_id, name, gender, phone, license_no, specialty, bio, status, team_count, rating)
                 VALUES (?,?,?,?,?,?,?,?,?,?,4.8)
               ON DUPLICATE KEY UPDATE name=VALUES(name), status=VALUES(status), team_count=VALUES(team_count)`,
        [id, agency, name, gender, phone, license, specialty, `${specialty}方向资深导游，从业 8 年。`, status, teamCount]);
    }

    // ---------------------------------------------------------------- 8. 团队
    await q(`INSERT INTO tour_team (id, team_no, agency_id, route_id, travel_date, guide_id, max_members, status, remark)
               VALUES (1,'T-20261120-01',1,11,DATE_ADD(CURDATE(), INTERVAL 8 DAY),1,20,'FULL','荔波小团，含 2 名儿童')
             ON DUPLICATE KEY UPDATE status=VALUES(status)`);
    await q(`INSERT INTO tour_team (id, team_no, agency_id, route_id, travel_date, guide_id, max_members, status)
               VALUES (2,'T-20261122-01',1,12,DATE_ADD(CURDATE(), INTERVAL 10 DAY),NULL,20,'RECRUITING')
             ON DUPLICATE KEY UPDATE status=VALUES(status)`);
    await q(`INSERT INTO tour_team (id, team_no, agency_id, route_id, travel_date, guide_id, max_members, status)
               VALUES (3,'T-20261108-02',1,13,DATE_ADD(CURDATE(), INTERVAL -6 DAY),3,15,'FINISHED')
             ON DUPLICATE KEY UPDATE status=VALUES(status)`);
    await q(`INSERT INTO tour_team (id, team_no, agency_id, route_id, travel_date, guide_id, max_members, status)
               VALUES (4,'T-20261116-01',2,21,DATE_ADD(CURDATE(), INTERVAL 4 DAY),4,25,'DEPARTED')
             ON DUPLICATE KEY UPDATE status=VALUES(status)`);
    await q(`INSERT IGNORE INTO tour_team_member (team_id, order_id, member_name, member_phone, people_count)
               SELECT 1, id, contact_name, contact_phone, traveler_count FROM tour_order WHERE order_no='SO2026111208'`);
    await q(`INSERT IGNORE INTO tour_team_member (team_id, order_id, member_name, member_phone, people_count)
               SELECT 2, id, contact_name, contact_phone, traveler_count FROM tour_order WHERE order_no='SO2026111207'`);
    await q(`INSERT IGNORE INTO tour_team_member (team_id, order_id, member_name, member_phone, people_count)
               SELECT 3, id, contact_name, contact_phone, traveler_count FROM tour_order WHERE order_no='SO2026111119'`);
    await q(`INSERT IGNORE INTO tour_team_member (team_id, order_id, member_name, member_phone, people_count)
               SELECT 4, id, contact_name, contact_phone, traveler_count FROM tour_order WHERE order_no='SO2026111104'`);

    // ---------------------------------------------------------------- 9. 结算单
    const settlements: Array<[number, string, number, string, number, string, number]> = [
      // [id, no, agency, period, orderCount, status, gross]
      [1, 'ST202611-001', 1, '2026-11 上半月', 23, 'PENDING', 28400],
      [2, 'ST202611-002', 2, '2026-11 上半月', 18, 'PENDING', 16200],
      [3, 'ST202610-014', 1, '2026-10 下半月', 14, 'SETTLED', 12600],
      [4, 'ST202610-011', 2, '2026-10 下半月', 5, 'REJECTED', 3400]
    ];
    for (const [id, no, agency, period, count, status, gross] of settlements) {
      await q(`INSERT INTO settlement (id, settlement_no, agency_id, period_label, order_count, gross_amount,
                 commission_rate, commission_amount, payable_amount, status, reject_reason, settled_at)
                 VALUES (?,?,?,?,?,?,0.0500, ROUND(?*0.05,2), ROUND(?*0.95,2), ?, NULL, NULL)
               ON DUPLICATE KEY UPDATE status=VALUES(status), gross_amount=VALUES(gross_amount)`,
        [id, no, agency, period, count, gross, gross, gross, status,
          status === 'REJECTED' ? '结算周期内含争议订单，暂缓结算' : null]);
    }
    // 修正 rejected/settled 字段
    await q(`UPDATE settlement SET reject_reason='结算周期内含争议订单，暂缓结算' WHERE settlement_no='ST202610-011'`);
    await q(`UPDATE settlement SET settled_at=NOW(), reject_reason=NULL WHERE settlement_no='ST202610-014'`);
    await q(`UPDATE settlement SET reject_reason=NULL WHERE status='PENDING'`);
    // 已完成订单挂到已结算单
    await q(`UPDATE tour_order o JOIN settlement s ON s.settlement_no='ST202610-014'
               SET o.settlement_id = s.id WHERE o.order_no='SO2026111119'`);

    // ---------------------------------------------------------------- 10. 埋点事件（近 14 天）
    const eventCount = (await q(`SELECT COUNT(*) AS n FROM product_stat_event WHERE product_id BETWEEN 11 AND 21`)) as mysql.RowDataPacket[];
    if (Number(eventCount[0].n) === 0) {
      const evTypes = ['VISIT', 'PLAN_GENERATED', 'ORDER'] as const;
      // [productId, 日均访客, 日均生成, 日均下单]
      const weights: Array<[number, number, number, number]> = [
        [11, 30, 9, 5], [12, 26, 8, 4], [13, 18, 5, 2], [14, 15, 4, 2], [15, 11, 3, 1], [21, 20, 6, 3]
      ];
      const values: unknown[] = [];
      const marks: string[] = [];
      for (const [pid, wV, wP, wO] of weights) {
        const ws = [wV, wP, wO];
        for (let day = 0; day < 14; day++) {
          for (let t = 0; t < 3; t++) {
            const cnt = Math.round(ws[t] / 14) + (day % 2 === 0 ? 1 : 0);
            for (let i = 0; i < cnt; i++) {
              marks.push('(?,?,?,NULL,NULL,DATE_SUB(NOW(), INTERVAL ? DAY))');
              values.push(pid, 11, evTypes[t], day);
            }
          }
        }
      }
      await q(`INSERT INTO product_stat_event (product_id, user_id, event_type, itinerary_id, order_id, occurred_at) VALUES ${marks.join(',')}`, values);
    }

    // ---------------------------------------------------------------- 11. AI 会话 / 消息 / 工具调用
    const sessionCount = (await q('SELECT COUNT(*) AS n FROM chat_session')) as mysql.RowDataPacket[];
    if (Number(sessionCount[0].n) === 0) {
      await q(`INSERT INTO chat_session (id, user_id, title, status, message_count, last_active_at, created_at) VALUES
                 (1, 11, '成都出发去贵州 4 天，偏好自然风光', 'ACTIVE', 6, NOW(), DATE_SUB(NOW(), INTERVAL 1 HOUR)),
                 (2, 12, '大理亲子 5 天平缓线路',      'ACTIVE', 4, DATE_SUB(NOW(), INTERVAL 3 HOUR), DATE_SUB(NOW(), INTERVAL 4 HOUR)),
                 (3, 13, '川西小环线装备咨询',          'CLOSED', 2, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY))`);
      await q(`INSERT INTO chat_message (session_id, sender, content, intent_tags, tool_tags, created_at) VALUES
                 (1,'USER','成都出发去贵州 4 天，2 个人，预算 3000 左右，偏好自然风光、慢节奏。', JSON_ARRAY('4天','贵州','2人','¥3000'), NULL, NOW()),
                 (1,'ASSISTANT','已为您生成荔波 4 天 3 晚方案，覆盖小七孔、茂兰与瑶山古寨，节奏偏休闲。', JSON_ARRAY('4天3晚','黔南·荔波'), JSON_ARRAY('ATTRACTION','TRANSPORT','HOTEL'), NOW()),
                 (1,'USER','第二天想少走路，换成平缓一点的景点。', NULL, NULL, NOW()),
                 (1,'ASSISTANT','已调整：第二天改为樟江沿岸休闲游览，取消爬山路段，增加休息与用餐缓冲。', JSON_ARRAY('慢节奏'), JSON_ARRAY('ATTRACTION','FOOD'), NOW()),
                 (2,'USER','大理亲子游有哪些平缓线路？', JSON_ARRAY('亲子','大理'), NULL, NOW()),
                 (2,'ASSISTANT','推荐洱海生态廊道骑行与喜洲古镇半日游，均为平缓路线，适合带儿童出行。', JSON_ARRAY('亲子','平缓'), JSON_ARRAY('ATTRACTION'), NOW())`);
      const tools: Array<[number, string, string, number, number]> = [
        [1, 'ATTRACTION', 'SUCCESS', 220, 0], [2, 'ATTRACTION', 'SUCCESS', 180, 0],
        [1, 'WEATHER', 'SUCCESS', 150, 1], [2, 'TRANSPORT', 'SUCCESS', 260, 0],
        [1, 'HOTEL', 'SUCCESS', 310, 0], [2, 'HOTEL', 'TIMEOUT', 3000, 0],
        [1, 'FOOD', 'SUCCESS', 190, 1], [3, 'ATTRACTION', 'SUCCESS', 170, 1],
        [3, 'WEATHER', 'FAILED', 1200, 0], [2, 'FOOD', 'SUCCESS', 210, 1]
      ];
      for (const [sid, tool, status, latency, mock] of tools) {
        await q(`INSERT INTO tool_call_log (session_id, tool_name, provider, request_summary, response_status, latency_ms, is_mock, created_at)
                   VALUES (?, ?, 'mock', '演示请求摘要', ?, ?, ?, NOW())`, [sid, tool, status, latency, mock]);
      }
    }

    // ---------------------------------------------------------------- 12. 偏好（客户画像）
    const prefs: Array<[number, number, string, number, number, number, number, string]> = [
      // [prefId, userId(经 session 关联可空), city, days, people, budget, style?, tag]
      [1, 11, '成都', 4, 2, 6000, 'LEISURE', '自然风光'],
      [2, 12, '绵阳', 5, 3, 9000, 'HIKING', '户外徒步'],
      [3, 13, '成都', 5, 2, 7000, 'FAMILY', '亲子休闲'],
      [4, 14, '重庆', 6, 2, 8000, 'PHOTOGRAPHY', '深度游']
    ];
    for (const [pid, , city, days, people, budget, style, tag] of prefs) {
      await q(`INSERT INTO travel_preference (id, departure_city, days_count, nights_count, traveler_count,
                 budget_total_rmb, pace, travel_style, hotel_preference, avoid_shopping, extract_source)
                 VALUES (?, ?, ?, ?, ?, ?, 'NORMAL', ?, 'NEAR_ATTRACTION', 1, 'RULE_FALLBACK')
               ON DUPLICATE KEY UPDATE departure_city=VALUES(departure_city)`,
        [pid, city, days, days - 1, people, budget, style]);
      await q(`INSERT IGNORE INTO preference_destination (preference_id, city_name, seq_no) VALUES (?, '贵州', 1), (?, '云南', 2)`, [pid, pid]);
      await q(`INSERT IGNORE INTO preference_tag (preference_id, tag_type, tag_value) VALUES (?, 'INTEREST', ?)`, [pid, tag]);
    }
    // 关联游客：preference 无 user 外键，通过 itinerary? —— 用 session 挂到用户，简单起见给每个游客建一条会话承载
    await q(`INSERT IGNORE INTO chat_session (id, user_id, title, status, message_count) VALUES
               (11, 11, '历史偏好会话', 'CLOSED', 0), (12, 12, '历史偏好会话', 'CLOSED', 0),
               (13, 13, '历史偏好会话', 'CLOSED', 0), (14, 14, '历史偏好会话', 'CLOSED', 0)`);
    await q(`UPDATE travel_preference SET session_id=11 WHERE id=1`);
    await q(`UPDATE travel_preference SET session_id=12 WHERE id=2`);
    await q(`UPDATE travel_preference SET session_id=13 WHERE id=3`);
    await q(`UPDATE travel_preference SET session_id=14 WHERE id=4`);

    // ---------------------------------------------------------------- 13. 字典 / 审计 / 客户备注
    await q(`INSERT INTO sys_dict (dict_type, dict_key, dict_value, sort) VALUES
               ('style_tag','LEISURE','休闲慢节奏',1),('style_tag','NATURE','自然风光',2),
               ('style_tag','HIKING','户外徒步',3),('style_tag','FAMILY','亲子休闲',4),
               ('style_tag','DEPTH','深度游',5),('style_tag','FOOD','美食探店',6),
               ('departure_city','成都','成都',1),('departure_city','重庆','重庆',2),
               ('departure_city','绵阳','绵阳',3),('departure_city','贵阳','贵阳',4),
               ('departure_city','昆明','昆明',5)
             ON DUPLICATE KEY UPDATE dict_value=VALUES(dict_value)`);
    await q(`INSERT INTO sys_audit_log (operator_id, operator_name, action, object_type, object_no, detail, trace_id, created_at) VALUES
               (1,'admin','确认订单','order','SO2026111206','电话确认出行细节','tr-seed-0001',DATE_SUB(NOW(), INTERVAL 2 HOUR)),
               (1,'admin','编辑线路','route','prod_102','更新描述与基准价','tr-seed-0002',DATE_SUB(NOW(), INTERVAL 1 DAY)),
               (1,'admin','下架产品','route','prod_105','换季下架','tr-seed-0003',DATE_SUB(NOW(), INTERVAL 2 DAY))`);
    await q(`INSERT INTO agency_customer_note (agency_id, user_id, note) VALUES
               (1, 11,'老客，偏好自然风光，可推宽裕型行程。'),
               (1, 13,'亲子客户，注意安排午休时间。')
             ON DUPLICATE KEY UPDATE note=VALUES(note)`);

    await conn.commit();
    console.log('[seed] 演示数据播种完成。账号：super / admin / staff02 / yun_admin，密码均为 ' + PASSWORD);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
};

run().catch((e) => {
  console.error('[seed] 失败：', e instanceof Error ? e.message : e);
  process.exit(1);
});
