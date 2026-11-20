// 批量已读压测：逐条 UPDATE vs 一条 GREATEST 批量 UPDATE 的耗时对比
// 回答老师"10 万人批量已读怎么写"的实证答案（跑完截图，答辩用）。
//
// 设计要点：
// - im_participant.user_id 有外键 → 压测用户必须真实存在于 sys_user，
//   脚本自建 N 个 username 前缀为 bench_ 的临时用户，跑完全程自动清理，可重复运行。
// - 用专用压测会话（conversation_no=BENCHREAD），不动演示会话 convId=1。
// - A/B 两组都先归零 last_read_seq，保证 GREATEST 都真实生效，对比公平。
import 'dotenv/config';
import mysql from 'mysql2/promise';

const N = Number(process.env.BENCH_N || 5000); // 压测人数，可用 BENCH_N=200 先小跑验证
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'travel_agent_db',
  waitForConnections: true,
  connectionLimit: 10
});

const BENCH_SEQ = 9_000_000_000; // 足够大的 seq，保证 GREATEST(last_read_seq, X) 一定前进

async function cleanup(conn) {
  // 顺序：先删参与者/会话，再删压测用户（外键级联兜底，但显式删更稳）
  await conn.query(`DELETE FROM im_participant WHERE conversation_id IN
                    (SELECT id FROM im_conversation WHERE conversation_no='BENCHREAD')`);
  await conn.query(`DELETE FROM im_conversation WHERE conversation_no='BENCHREAD'`);
  await conn.query(`DELETE FROM sys_user WHERE username LIKE 'bench\\_%'`);
}

const conn = await pool.getConnection();
let tLoop = 0, tBatch = 0;
try {
  // ---- 0. 幂等清理（上次运行可能残留）+ 造数 ----
  await cleanup(conn);

  const [r] = await conn.query(
    `INSERT INTO sys_user (username, password_hash, role, status) VALUES ?`,
    [Array.from({ length: N }, (_, i) =>
      [`bench_${String(i + 1).padStart(6, '0')}`, 'bench-no-login-hash', 'TOURIST', 'ACTIVE'])]
  );
  const [convRes] = await conn.query(
    `INSERT INTO im_conversation (conversation_no, conversation_type, title, last_message_seq, created_by)
     VALUES ('BENCHREAD','GROUP','批量已读压测',0,?)`,
    [r.insertId] // 用第一个 bench 用户当 created_by，避免依赖演示账号
  );
  const benchConvId = convRes.insertId;
  await conn.query(
    `INSERT INTO im_participant (conversation_id, user_id, role)
     SELECT ?, id, 'MEMBER' FROM sys_user WHERE username LIKE 'bench\\_%'`,
    [benchConvId]
  );
  const [[p]] = await conn.query(
    `SELECT COUNT(*) c FROM im_participant WHERE conversation_id=?`, [benchConvId]);
  console.log(`压测就绪：会话 ${benchConvId}，参与者 ${p.c} 人`);

  // ---- A. 逐条 UPDATE（模拟"循环里一条条发已读"） ----
  await conn.query(`UPDATE im_participant SET last_read_seq=0 WHERE conversation_id=?`, [benchConvId]);
  let t0 = Date.now();
  await conn.beginTransaction();
  const [rows] = await conn.query(
    `SELECT user_id FROM im_participant WHERE conversation_id=?`, [benchConvId]);
  for (const row of rows) {
    await conn.query(
      `UPDATE im_participant SET last_read_seq=? WHERE conversation_id=? AND user_id=?`,
      [BENCH_SEQ, benchConvId, row.user_id]);
  }
  await conn.commit();
  tLoop = Date.now() - t0;

  // ---- B. 归零后一条批量 UPDATE（GREATEST 保证只前进不后退） ----
  await conn.query(`UPDATE im_participant SET last_read_seq=0 WHERE conversation_id=?`, [benchConvId]);
  t0 = Date.now();
  await conn.query(
    `UPDATE im_participant SET last_read_seq=GREATEST(last_read_seq,?) WHERE conversation_id=?`,
    [BENCH_SEQ, benchConvId]);
  tBatch = Date.now() - t0;

  // ---- 结果 ----
  console.log(`逐条 ${N} 人: ${tLoop} ms`);
  console.log(`一条批量 UPDATE: ${tBatch} ms`);
  console.log(`加速比 ≈ ${(tLoop / Math.max(tBatch, 1)).toFixed(0)} 倍`);
  console.log('✅ 把这个数字截图，答辩时就是「10 万批量已读」问题的实证答案');
} catch (err) {
  console.error('压测失败:', err.message);
  process.exitCode = 1;
} finally {
  // ---- 清理压测数据（无论成败） ----
  try { await cleanup(conn); console.log('压测数据已清理（bench_ 用户 + BENCHREAD 会话）'); }
  catch (e) { console.log('清理失败，手动执行：DELETE FROM sys_user WHERE username LIKE "bench\\_%";'); }
  conn.release();
  await pool.end();
}
