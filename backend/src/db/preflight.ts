/**
 * 数据库与配置体检（只读，不建表、不改数据）
 *
 * 作用：回答「我到底有没有按顺序执行过 01/04/05/06/08」这个问题，
 *      并把「缺哪一段、下一条命令是什么」直接打印出来。
 *
 * 运行：cd backend && npm run db:check
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const ROOT = path.resolve(__dirname, '../..');
const ENV_PATH = path.join(ROOT, '.env');

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'travel_agent_db'
};

/** 每个脚本「负责」的表；用于反推缺的是哪一段。顺序即依赖顺序。 */
const SCRIPT_TABLES: { file: string; tables: string[] }[] = [
  {
    file: '01_schema.sql',
    tables: [
      'travel_agency', 'sys_user', 'user_favorite', 'chat_session', 'chat_message',
      'poi', 'poi_attraction', 'poi_restaurant', 'poi_hotel', 'travel_product',
      'itinerary', 'itinerary_notice', 'travel_preference', 'preference_destination',
      'preference_tag', 'day_plan', 'day_tip', 'schedule_item', 'schedule_transport',
      'itinerary_version', 'export_record', 'product_stat_event', 'tour_order', 'tool_call_log'
    ]
  },
  {
    file: '04_api_v1.sql',
    tables: ['api_session', 'api_idempotency', 'api_nonce', 'api_rate_limit', 'spot_comment']
  },
  {
    file: '05_rbac_schema.sql',
    tables: ['sys_role', 'sys_permission', 'sys_user_role', 'sys_role_permission']
  },
  {
    file: '06_route_stock.sql',
    tables: ['route_stock']
  },
  {
    file: '08_rbac_complete.sql',
    tables: ['sys_audit_log']
  }
];

const ok = (msg: string) => console.log(`  [OK]   ${msg}`);
const bad = (msg: string) => console.log(`  [缺]   ${msg}`);
const info = (msg: string) => console.log(`         ${msg}`);

function checkEnv(): string[] {
  console.log('\n=== 1. 配置文件 backend/.env ===');
  const problems: string[] = [];

  if (!fs.existsSync(ENV_PATH)) {
    bad('.env 不存在（数据库连接参数和 JWT 密钥都读不到）');
    info('修复：cp .env.example .env，然后填 DB_PASSWORD 与 JWT_SECRET');
    return ['没有 .env'];
  }
  ok('.env 存在');

  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32) {
    bad(`JWT_SECRET 长度 ${secret.length} < 32，服务会在签发 token 时直接抛错`);
    info('修复：换成 32 个字符以上的随机串');
    problems.push('JWT_SECRET 太短');
  } else if (/replace-with|change-me|your_/i.test(secret)) {
    bad('JWT_SECRET 还是 .env.example 里的占位值');
    problems.push('JWT_SECRET 是占位值');
  } else {
    ok(`JWT_SECRET 长度 ${secret.length}，可用`);
  }

  if (!process.env.DB_PASSWORD || /your_mysql_password/i.test(process.env.DB_PASSWORD)) {
    bad('DB_PASSWORD 没填（还是空值或示例占位符）');
    info('修复：填入本机 MySQL root 的真实密码');
    problems.push('DB_PASSWORD 未填写');
  } else {
    ok('DB_PASSWORD 已填写');
  }

  console.log(`         连接目标：${DB.user}@${DB.host}:${DB.port}/${DB.database}`);
  return problems;
}

async function checkDatabase(): Promise<boolean> {
  console.log('\n=== 2. MySQL 连通性与建库情况 ===');
  let conn: mysql.Connection;
  try {
    // 先不带 database 连接：库可能根本还没建，带库名会直接报 Unknown database
    conn = await mysql.createConnection({
      host: DB.host, port: DB.port, user: DB.user, password: DB.password, connectTimeout: 5000
    });
  } catch (error: any) {
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      bad(`MySQL 拒绝登录（${DB.user}）→ 密码不对`);
      info('修复：把正确密码写进 backend/.env 的 DB_PASSWORD');
    } else if (error.code === 'ECONNREFUSED') {
      bad(`连不上 ${DB.host}:${DB.port} → MySQL 服务没启动`);
      info('修复：Win+R 输入 services.msc，启动 MySQL80 服务');
    } else {
      bad(`连接失败：${error.code || error.message}`);
    }
    return false;
  }

  try {
    ok(`MySQL 已连通（${DB.host}:${DB.port}）`);

    const [dbs] = await conn.query<mysql.RowDataPacket[]>('SHOW DATABASES LIKE ?', [DB.database]);
    if (dbs.length === 0) {
      bad(`数据库 ${DB.database} 不存在 → 连 01_schema.sql 都没执行过`);
      return false;
    }
    ok(`数据库 ${DB.database} 存在`);

    await conn.query(`USE \`${DB.database}\``);
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [DB.database]
    );
    const existing = new Set(rows.map((row) => String(row.name)));

    console.log('\n=== 3. 五段脚本的执行情况 ===');
    let allTables = true;
    for (const script of SCRIPT_TABLES) {
      const missing = script.tables.filter((table) => !existing.has(table));
      if (missing.length === 0) {
        ok(`${script.file} 已执行（${script.tables.length} 张表齐全）`);
      } else {
        allTables = false;
        bad(`${script.file} 未执行或不完整：缺 ${missing.length} 张表`);
        info(`缺：${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}`);
      }
    }

    if (!allTables) {
      console.log('\n  建议按顺序补齐（缺哪段补哪段，顺序不能反，后面依赖前面的表）：');
      console.log(`  mysql -u ${DB.user} -p < ../database/01_schema.sql`);
      console.log(`  mysql -u ${DB.user} -p < ../database/04_api_v1.sql`);
      console.log(`  mysql -u ${DB.user} -p < ../database/05_rbac_schema.sql`);
      console.log(`  mysql -u ${DB.user} -p < ../database/06_route_stock.sql`);
      console.log(`  mysql -u ${DB.user} -p < ../database/08_rbac_complete.sql`);
      return false;
    }

    // 表都在，再看种子数据：e2e 依赖 3 个角色、44 条权限和 6 个游客按钮权限。
    console.log('\n=== 4. RBAC 种子数据（e2e 断言依赖）===');
    const [counts] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM sys_role) AS roles,
         (SELECT COUNT(*) FROM sys_permission) AS perms,
         (SELECT COUNT(*) FROM sys_role_permission) AS role_perms,
         (SELECT COUNT(*) FROM sys_role_permission rp
            JOIN sys_role r ON r.id = rp.role_id
            JOIN sys_permission p ON p.id = rp.permission_id
           WHERE r.code = 'TOURIST' AND p.resource_type = 'BUTTON') AS tourist_permissions,
         (SELECT COUNT(*) FROM travel_agency WHERE id = 1) AS agency1`
    );
    const c = counts[0];
    const expect: [string, number, number, string][] = [
      ['sys_role 应有 3 个内置角色', Number(c.roles), 3, '05_rbac_schema.sql'],
      ['sys_permission 应有 44 条权限', Number(c.perms), 44, '08_rbac_complete.sql'],
      ['TOURIST 应有 6 个业务按钮权限', Number(c.tourist_permissions), 6, '08_rbac_complete.sql']
    ];
    let seedsOk = true;
    for (const [label, actual, expected, source] of expect) {
      if (actual >= expected) ok(`${label}（实际 ${actual}）`);
      else { seedsOk = false; bad(`${label}，实际 ${actual} → 重跑 ${source}`); }
    }
    if (Number(c.agency1) === 0) {
      info('travel_agency 为空：不阻塞，e2e 会自动建 id=1 的联调机构供账号外键使用');
    } else {
      ok('travel_agency 已有 id=1（账号外键可用）');
    }
    if (Number(c.role_perms) === 0) {
      info('sys_role_permission 为空：内置角色没有任何权限，e2e 第 2/6 段会失败');
      seedsOk = false;
    } else {
      ok(`sys_role_permission 有 ${c.role_perms} 条授权`);
    }

    return seedsOk;
  } finally {
    await conn.end();
  }
}

(async () => {
  console.log('数据库体检（只读，不改任何数据）');
  const envProblems = checkEnv();

  if (!fs.existsSync(ENV_PATH) || envProblems.includes('DB_PASSWORD 未填写')) {
    console.log('\n=== 结论 ===');
    console.log('  先补 backend/.env（尤其是 DB_PASSWORD），否则连数据库都进不去，无法判断脚本执行情况。');
    console.log('  步骤：cp .env.example .env  →  编辑 DB_PASSWORD / JWT_SECRET  →  再跑一次 npm run db:check');
    process.exit(1);
  }

  const dbReady = await checkDatabase();

  console.log('\n=== 结论 ===');
  if (!dbReady) {
    console.log('  还没到能跑 e2e 的状态，先按上面提示修 .env / 补 SQL 脚本，再执行本命令复检。');
    process.exit(1);
  }
  console.log('  数据库已就绪，可以执行：npm run e2e:rbac');
  if (envProblems.length > 0) console.log(`  但 .env 仍有问题：${envProblems.join('、')}`);
  process.exit(0);
})().catch((error) => {
  console.error('体检异常：', error);
  process.exit(1);
});
