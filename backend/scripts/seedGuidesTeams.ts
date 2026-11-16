/**
 * 导游与团队演示数据补齐（幂等）
 * 目标：机构1 6 名导游 / 7 个团队，机构2 2 名导游 / 2 个团队；
 * 团队状态覆盖 RECRUITING / FULL / DEPARTED / FINISHED，成员数与上限自洽，
 * 成员尽量关联真实订单（order_id 非空），其余为手工录入（order_id 为 NULL）。
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

type GuideSeed = {
  agency: number; name: string; gender: '男' | '女'; phone: string; license: string;
  specialty: string; bio: string; status: 'ACTIVE' | 'DISABLED'; teamCount: number; rating: string;
};

type MemberSeed = { orderId: number | null; name: string; phone: string; people: number };
type TeamSeed = {
  agency: number; teamNo: string; routeId: number; travelDate: string;
  guideLicense: string | null; maxMembers: number; status: string; remark: string; members: MemberSeed[];
};

const GUIDES: GuideSeed[] = [
  { agency: 1, name: '林小满', gender: '女', phone: '13800138011', license: 'D-SC-52010041', specialty: '自然风光 · 摄影', bio: '九寨沟/黄龙专线 6 年，擅长风光摄影客群，持有高原急救证。', status: 'ACTIVE', teamCount: 12, rating: '5.0' },
  { agency: 1, name: '杨帆', gender: '男', phone: '13800138012', license: 'D-SC-52010042', specialty: '户外徒步', bio: '川西徒步线路领队，累计带团 26 次，熟悉高海拔行进节奏。', status: 'ACTIVE', teamCount: 26, rating: '4.7' },
  { agency: 1, name: '罗静', gender: '女', phone: '13800138013', license: 'D-SC-52010043', specialty: '亲子研学', bio: '亲子研学方向，擅长把在地文化讲成孩子听得懂的故事。', status: 'ACTIVE', teamCount: 19, rating: '4.9' },
  { agency: 2, name: '玉腊', gender: '女', phone: '13800138014', license: 'D-YN-53020018', specialty: '民族文化', bio: '西双版纳/黔东南在地向导，熟悉傣族与侗族村寨走访路线。', status: 'ACTIVE', teamCount: 15, rating: '4.8' },
];

const TEAMS: TeamSeed[] = [
  {
    agency: 1, teamNo: 'T-20261120-01', routeId: 11, travelDate: '2026-11-20', guideLicense: 'D-SC-52010008',
    maxMembers: 12, status: 'FULL', remark: '贵州荔波 4 天 3 晚 · 摄影团，已满员',
    members: [
      { orderId: 50, name: '王女士', phone: '13811115678', people: 2 },
      { orderId: null, name: '赵先生', phone: '13922220101', people: 2 },
      { orderId: null, name: '周女士', phone: '13733330202', people: 3 },
      { orderId: null, name: '陈先生', phone: '13644440303', people: 2 },
      { orderId: null, name: '林女士', phone: '13555550404', people: 3 },
    ],
  },
  {
    agency: 1, teamNo: 'T-20261122-01', routeId: 12, travelDate: '2026-11-22', guideLicense: 'D-SC-52010017',
    maxMembers: 20, status: 'RECRUITING', remark: '云南大理 5 天 4 晚 · 招募中',
    members: [
      { orderId: 51, name: '李先生', phone: '13522220917', people: 4 },
      { orderId: null, name: '赵女士', phone: '13866660505', people: 2 },
    ],
  },
  {
    agency: 1, teamNo: 'T-20261108-02', routeId: 13, travelDate: '2026-11-08', guideLicense: 'D-SC-52010033',
    maxMembers: 15, status: 'FINISHED', remark: '川西小环线 3 天 2 晚 · 已结束（历史团队保留）',
    members: [
      { orderId: 53, name: '刘女士', phone: '13644443352', people: 3 },
      { orderId: null, name: '郑先生', phone: '13777770606', people: 3 },
    ],
  },
  {
    agency: 1, teamNo: 'T-20261118-01', routeId: 14, travelDate: '2026-11-18', guideLicense: 'D-SC-52010041',
    maxMembers: 16, status: 'DEPARTED', remark: '丽江香格里拉 6 天 5 晚 · 出行中',
    members: [
      { orderId: 52, name: '张先生', phone: '13700000707', people: 2 },
      { orderId: null, name: '杨女士', phone: '13611110808', people: 3 },
      { orderId: null, name: '何先生', phone: '13522220909', people: 2 },
      { orderId: null, name: '马女士', phone: '13433331010', people: 2 },
    ],
  },
  {
    agency: 1, teamNo: 'T-20261205-01', routeId: 15, travelDate: '2026-12-05', guideLicense: null,
    maxMembers: 10, status: 'RECRUITING', remark: '成都周边古镇 2 天 1 晚 · 待派导游',
    members: [
      { orderId: null, name: '高先生', phone: '13344441111', people: 2 },
      { orderId: null, name: '唐女士', phone: '13255551212', people: 2 },
    ],
  },
  {
    agency: 1, teamNo: 'T-20261212-01', routeId: 11, travelDate: '2026-12-12', guideLicense: 'D-SC-52010042',
    maxMembers: 14, status: 'RECRUITING', remark: '贵州荔波 4 天 3 晚 · 徒步团招募中',
    members: [
      { orderId: null, name: '邓女士', phone: '13166661313', people: 3 },
      { orderId: null, name: '许先生', phone: '13077771414', people: 2 },
      { orderId: null, name: '冯女士', phone: '13988881515', people: 3 },
    ],
  },
  {
    agency: 1, teamNo: 'T-20261116-02', routeId: 23, travelDate: '2026-11-16', guideLicense: 'D-SC-52010043',
    maxMembers: 8, status: 'DEPARTED', remark: '川西深度游 · 小团出行中',
    members: [
      { orderId: null, name: '蒋先生', phone: '13899991616', people: 2 },
      { orderId: null, name: '邹女士', phone: '13700001717', people: 2 },
      { orderId: null, name: '贺先生', phone: '13611111818', people: 2 },
      { orderId: null, name: '彭女士', phone: '13522221919', people: 2 },
    ],
  },
  {
    agency: 2, teamNo: 'T-20261116-01', routeId: 21, travelDate: '2026-11-16', guideLicense: 'D-YN-53010021',
    maxMembers: 20, status: 'DEPARTED', remark: '西双版纳雨林 4 天 3 晚 · 出行中',
    members: [
      { orderId: 56, name: '吴女士', phone: '13811115678', people: 6 },
      { orderId: null, name: '普先生', phone: '13433332020', people: 2 },
    ],
  },
  {
    agency: 2, teamNo: 'T-20261201-01', routeId: 22, travelDate: '2026-12-01', guideLicense: 'D-YN-53020018',
    maxMembers: 15, status: 'RECRUITING', remark: '黔东南侗寨 5 天 4 晚 · 招募中',
    members: [
      { orderId: null, name: '岩先生', phone: '13344442121', people: 2 },
      { orderId: null, name: '玉女士', phone: '13255552222', people: 2 },
      { orderId: null, name: '刀先生', phone: '13166662323', people: 1 },
    ],
  },
];

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  await c.beginTransaction();
  try {
    // 1) 导游：按 license_no 幂等写入
    for (const g of GUIDES) {
      await c.query(
        `INSERT INTO guide (agency_id, name, gender, phone, license_no, specialty, bio, status, team_count, rating)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), gender=VALUES(gender), phone=VALUES(phone),
           specialty=VALUES(specialty), bio=VALUES(bio), status=VALUES(status),
           team_count=VALUES(team_count), rating=VALUES(rating)`,
        [g.agency, g.name, g.gender, g.phone, g.license, g.specialty, g.bio, g.status, g.teamCount, g.rating]);
    }
    const [guideRows] = await c.query<any[]>('SELECT id, license_no FROM guide');
    const guideByLicense = new Map<string, number>(guideRows.map((r: any) => [r.license_no, r.id]));

    // 2) 团队 + 成员
    let created = 0; let updated = 0;
    for (const t of TEAMS) {
      const guideId = t.guideLicense ? guideByLicense.get(t.guideLicense) ?? null : null;
      const memberTotal = t.members.reduce((s, m) => s + m.people, 0);
      if (t.status === 'FULL' && memberTotal !== t.maxMembers) {
        throw new Error(`${t.teamNo} 标记 FULL 但人数 ${memberTotal} ≠ 上限 ${t.maxMembers}`);
      }
      if (memberTotal > t.maxMembers) throw new Error(`${t.teamNo} 成员 ${memberTotal} 超过上限 ${t.maxMembers}`);

      const [exist] = await c.query<any[]>('SELECT id FROM tour_team WHERE team_no=? AND agency_id=?', [t.teamNo, t.agency]);
      let teamId: number;
      if (exist.length) {
        teamId = exist[0].id;
        await c.query(
          'UPDATE tour_team SET route_id=?, travel_date=?, guide_id=?, max_members=?, status=?, remark=? WHERE id=?',
          [t.routeId, t.travelDate, guideId, t.maxMembers, t.status, t.remark, teamId]);
        updated++;
      } else {
        const [rs] = await c.query<any>(
          `INSERT INTO tour_team (team_no, agency_id, route_id, travel_date, guide_id, max_members, status, remark)
           VALUES (?,?,?,?,?,?,?,?)`,
          [t.teamNo, t.agency, t.routeId, t.travelDate, guideId, t.maxMembers, t.status, t.remark]);
        teamId = rs.insertId;
        created++;
      }

      await c.query('DELETE FROM tour_team_member WHERE team_id=?', [teamId]);
      for (const m of t.members) {
        await c.query(
          'INSERT INTO tour_team_member (team_id, order_id, member_name, member_phone, people_count) VALUES (?,?,?,?,?)',
          [teamId, m.orderId, m.name, m.phone, m.people]);
      }
    }

    await c.commit();
    console.log(`团队写入完成：新增 ${created} 个，更新 ${updated} 个；导游 ${GUIDES.length} 名（幂等 upsert）`);

    const [g] = await c.query<any[]>('SELECT agency_id, COUNT(*) n FROM guide GROUP BY agency_id');
    const [t] = await c.query<any[]>(
      `SELECT t.agency_id, t.status, COUNT(*) n FROM tour_team t GROUP BY t.agency_id, t.status ORDER BY t.agency_id, t.status`);
    const [m] = await c.query<any[]>('SELECT COUNT(*) n, COALESCE(SUM(people_count),0) p FROM tour_team_member');
    console.log('导游分布:', JSON.stringify(g));
    console.log('团队分布:', JSON.stringify(t));
    console.log('成员合计:', m[0].n, '条 /', m[0].p, '人');
  } catch (e) {
    await c.rollback();
    console.log('失败已回滚:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
