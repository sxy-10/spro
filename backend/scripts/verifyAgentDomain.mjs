/**
 * scripts/verifyAgentDomain.mjs —— 客服接待域自检
 *
 * 用途：跑完 13_im_agent.sql 之后，用一条命令确认「表、列、索引、权限码、话术种子」
 *      五件事都到位了；也用来验证脚本可重复执行（第二次跑不应该有任何变化）。
 *
 * 运行：cd backend && node scripts/verifyAgentDomain.mjs
 * 只读：不建表、不改数据。
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const DB = process.env.DB_NAME || 'travel_agent_db';
const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB
});

const ok = (msg) => console.log(`  [OK]   ${msg}`);
const bad = (msg) => console.log(`  [缺]   ${msg}`);
let failed = 0;

console.log(`\n=== 1. im_conversation 接待列 ===`);
const [cols] = await conn.query(
  `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='im_conversation'
    ORDER BY ORDINAL_POSITION`, [DB]);
const need = ['assignee_id', 'status', 'queued_at', 'assigned_at', 'closed_at', 'agent_note'];
for (const name of need) {
  const col = cols.find((c) => c.name === name);
  if (col) ok(`${name.padEnd(12)} ${col.type}${col.nullable === 'YES' ? ' NULL' : ' NOT NULL'}${col.def ? ` default ${col.def}` : ''}`);
  else { bad(`${name} 不存在`); failed += 1; }
}

console.log(`\n=== 2. 新表 ===`);
for (const table of ['im_agent_status', 'im_quick_reply', 'im_rating']) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [DB, table]);
  if (Number(rows[0].n) === 0) { bad(`${table} 不存在`); failed += 1; continue; }
  const [count] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  ok(`${table.padEnd(18)} 存在（${count[0].n} 行）`);
}

console.log(`\n=== 3. 索引与外键 ===`);
const [idx] = await conn.query(
  `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=? AND TABLE_NAME='im_conversation' AND INDEX_NAME IN ('idx_im_conv_pool','idx_im_conv_assignee')
    GROUP BY INDEX_NAME`, [DB]);
for (const name of ['idx_im_conv_pool', 'idx_im_conv_assignee']) {
  if (idx.some((i) => i.name === name)) ok(`${name}`);
  else { bad(`${name} 不存在`); failed += 1; }
}
const [fk] = await conn.query(
  `SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA=? AND TABLE_NAME='im_conversation' AND CONSTRAINT_NAME='fk_im_conv_assignee'`, [DB]);
if (fk.length) ok('fk_im_conv_assignee → sys_user(id) ON DELETE SET NULL');
else { bad('fk_im_conv_assignee 不存在'); failed += 1; }

console.log(`\n=== 4. 权限码与授权 ===`);
const [perms] = await conn.query(
  `SELECT p.code, p.resource_type AS type FROM sys_permission p
    WHERE p.code IN ('im:agent','im:agent:query','im:agent:manage',
                     'im:quick_reply','im:quick_reply:query','im:quick_reply:manage',
                     'im:rating','im:rating:query','im:rating:add')
    ORDER BY p.code`);
const expected = ['im:agent','im:agent:manage','im:agent:query','im:quick_reply','im:quick_reply:manage',
  'im:quick_reply:query','im:rating','im:rating:add','im:rating:query'];
for (const code of expected) {
  const row = perms.find((p) => p.code === code);
  if (row) ok(`${code.padEnd(24)} ${row.type}`);
  else { bad(`${code} 未插入`); failed += 1; }
}

const [grants] = await conn.query(
  `SELECT r.code AS role, COUNT(*) AS n FROM sys_role_permission rp
     JOIN sys_role r ON r.id = rp.role_id
     JOIN sys_permission p ON p.id = rp.permission_id
    WHERE p.code LIKE 'im:agent%' OR p.code LIKE 'im:quick_reply%' OR p.code LIKE 'im:rating%'
    GROUP BY r.code`);
for (const row of grants) ok(`${row.role} 持有接待域权限 ${row.n} 条`);

// 角色有权限 ≠ 人能用：12_im_perm.sql 建的 AGENT 角色没有绑定任何账号，
// 真实客服（staff02）绑的是 AGENCY_STAFF，所以必须验到「用户有效权限」这一层。
const [staffPerms] = await conn.query(
  `SELECT p.code FROM sys_user_role ur
     JOIN sys_role_permission rp ON rp.role_id = ur.role_id
     JOIN sys_permission p ON p.id = rp.permission_id
    WHERE ur.user_id = 20 AND p.code IN ('im:agent:query','im:agent:manage','im:message:send')`);
const staffCodes = staffPerms.map((row) => row.code);
for (const code of ['im:agent:query', 'im:agent:manage', 'im:message:send']) {
  if (staffCodes.includes(code)) ok(`staff02（user 20）有效权限含 ${code}`);
  else { bad(`staff02（user 20）缺 ${code}，客服台接口会 403`); failed += 1; }
}

// 游客必须能发起咨询（POST /v1/im/conversations 的守卫是 im:conv:manage）
const [touristConv] = await conn.query(
  `SELECT COUNT(*) AS n FROM sys_role_permission rp
     JOIN sys_role r ON r.id = rp.role_id
     JOIN sys_permission p ON p.id = rp.permission_id
    WHERE r.code = 'TOURIST' AND p.code = 'im:conv:manage'`);
if (Number(touristConv[0].n) > 0) ok('TOURIST 可发起咨询（im:conv:manage）');
else { bad('TOURIST 缺 im:conv:manage，C 端「发起咨询」会 403'); failed += 1; }

console.log(`\n=== 5. 话术种子 ===`);
const [seed] = await conn.query(
  `SELECT COUNT(*) AS n FROM im_quick_reply WHERE owner_id IS NULL AND seed_key IS NOT NULL`);
if (Number(seed[0].n) >= 7) ok(`全局公共话术 ${seed[0].n} 条（重跑不会翻倍）`);
else { bad(`全局公共话术只有 ${seed[0].n} 条，期望 7 条`); failed += 1; }

console.log(`\n=== 6. 会话接待分布 ===`);
const [dist] = await conn.query(
  `SELECT SUM(status='ACTIVE' AND assignee_id IS NULL) AS pool,
          SUM(status='ACTIVE' AND assignee_id IS NOT NULL) AS serving,
          SUM(status='CLOSED') AS closed,
          COUNT(*) AS total
     FROM im_conversation`);
const d = dist[0];
console.log(`         待接入 ${d.pool ?? 0} · 接待中 ${d.serving ?? 0} · 已结束 ${d.closed ?? 0} · 共 ${d.total ?? 0}`);

await conn.end();
console.log(`\n=== 结论 ===`);
if (failed) {
  console.log(`  有 ${failed} 项缺失，重跑：npx tsx scripts/migrate.ts`);
  process.exit(1);
}
console.log('  接待域已就绪：可以跑接口验收（见 docs/plan/补漏-客服接待域.md §五）。');
