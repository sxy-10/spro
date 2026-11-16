/**
 * scripts/migrate.ts —— 数据库迁移执行器
 * 用途：按顺序执行 database/01..07 SQL 脚本（绕过 mysql CLI 依赖）。
 * 运行：npx tsx scripts/migrate.ts
 * 幂等：01 建库失败会报「已存在」，07 的 ALTER 重复执行会报重复列——
 *      本脚本对这两类已知错误做跳过处理；全新库一次跑通。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'travel_agent_db';

const SCRIPT_DIR = path.resolve(process.cwd(), '../database');
const FILES = [
  '01_schema.sql', '02_seed.sql', '04_api_v1.sql', '05_rbac_schema.sql', '06_route_stock.sql',
  '07_dict.sql', '07_web_extension.sql', '08_rbac_complete.sql'
];
// 03_sample_queries.sql 为只读样例查询，不在迁移序列中
// 09_stock_version.sql（秒杀乐观锁）单独处理：其使用 ADD COLUMN IF NOT EXISTS，
// MySQL 8 不支持该语法，改为先查 information_schema 再逐条补列。
const BENIGN = [/ER_DB_CREATE_EXISTS/i, /ER_DUP_FIELDNAME/i, /ER_DUP_ENTRY/i, /already exists/i];

/** MariaDB 等旧版本兼容：utf8mb4_0900_ai_ci 为 MySQL 8 独有排序规则 */
const sanitize = (sql: string) =>
  process.env.DB_COMPAT_COLLATION === '0' ? sql : sql.replace(/utf8mb4_0900_ai_ci/g, 'utf8mb4_general_ci');

const run09 = async (admin: mysql.Connection) => {
  const file = '09_stock_version.sql';
  const sql = sanitize(fs.readFileSync(path.join(SCRIPT_DIR, file), 'utf8'));
  // 先尝试按原文执行（未来 MySQL 支持 IF NOT EXISTS 时可直接走通）
  try {
    await admin.query(sql);
    console.log(`[migrate] ${file} ✔`);
    return;
  } catch { /* 落入兼容路径 */ }

  const [cols] = await admin.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'route_stock'`, [DB_NAME]);
  const has = (name: string) => cols.some((c) => String(c.name) === name);
  const stmts: string[] = [];
  if (!has('version')) stmts.push("ALTER TABLE route_stock ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '乐观锁版本号'");
  if (!has('seckill_total_seats')) stmts.push("ALTER TABLE route_stock ADD COLUMN seckill_total_seats INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '秒杀总名额'");
  if (!has('seckill_sold_seats')) stmts.push("ALTER TABLE route_stock ADD COLUMN seckill_sold_seats INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '秒杀已售名额'");
  if (!has('req_id')) stmts.push("ALTER TABLE tour_order ADD COLUMN req_id VARCHAR(64) NULL COMMENT '秒杀请求ID（幂等键）'");
  const [keys] = await admin.query<mysql.RowDataPacket[]>(
    `SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tour_order' AND CONSTRAINT_TYPE = 'UNIQUE'`, [DB_NAME]);
  if (!keys.some((k) => String(k.name) === 'uk_order_req')) {
    stmts.push('ALTER TABLE tour_order ADD UNIQUE KEY uk_order_req (req_id)');
  }
  for (const stmt of stmts) await admin.query(stmt);
  // 09 的种子数据（幂等 INSERT ... WHERE NOT EXISTS）
  await admin.query(`INSERT INTO route_stock (route_id, travel_date, total_seats, locked_seats, sold_seats, version, seckill_total_seats, seckill_sold_seats)
    SELECT 1, '2026-12-01', 50, 0, 0, 0, 10, 0 WHERE NOT EXISTS
      (SELECT 1 FROM (SELECT 1 FROM route_stock WHERE route_id = 1 AND travel_date = '2026-12-01') x)`);
  console.log(`[migrate] ${file} ✔（兼容路径：按需补列 ${stmts.length} 条）`);
};

/** 06 重跑会被「route_stock 已存在」误判跳过，导致 tour_order 缺锁位列 —— 幂等补齐 */
const ensureOrderStockColumns = async (admin: mysql.Connection) => {
  const [cols] = await admin.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tour_order'`, [DB_NAME]);
  const has = (name: string) => cols.some((c) => String(c.name) === name);
  if (!has('is_stock_locked')) {
    await admin.query("ALTER TABLE tour_order ADD COLUMN is_stock_locked BOOLEAN NOT NULL DEFAULT FALSE");
    console.log('[migrate] 补列 tour_order.is_stock_locked ✔');
  }
  if (!has('expires_at')) {
    await admin.query('ALTER TABLE tour_order ADD COLUMN expires_at DATETIME NULL');
    console.log('[migrate] 补列 tour_order.expires_at ✔');
  }
  const [idx] = await admin.query<mysql.RowDataPacket[]>(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tour_order' AND INDEX_NAME = 'idx_order_expiry'`, [DB_NAME]);
  if (!idx.length) {
    await admin.query('ALTER TABLE tour_order ADD INDEX idx_order_expiry (status, is_stock_locked, expires_at)');
    console.log('[migrate] 补索引 tour_order.idx_order_expiry ✔');
  }
};

const run = async () => {
  if (DB_PASSWORD === undefined || process.env.DB_PASSWORD === undefined) {
    console.error('[migrate] 未读取到 DB_PASSWORD（.env 缺失或未加载），请先配置 backend/.env');
    process.exit(1);
  }
  if (!DB_PASSWORD) console.warn('[migrate] DB_PASSWORD 为空（本机 root 无密码场景）');
  const admin = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, multipleStatements: true });
  try {
    for (const file of FILES) {
      const sql = sanitize(fs.readFileSync(path.join(SCRIPT_DIR, file), 'utf8'));
      try {
        await admin.query(sql);
        console.log(`[migrate] ${file} ✔`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (BENIGN.some((re) => re.test(msg))) {
          console.log(`[migrate] ${file} 已存在，跳过`);
        } else {
          console.error(`[migrate] ${file} 失败：${msg}`);
          throw err;
        }
      }
    }
    await run09(admin);
    await ensureOrderStockColumns(admin);
    const [rows] = await admin.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?', [DB_NAME]);
    console.log(`[migrate] 完成：${DB_NAME} 共 ${rows[0].n} 张表`);
  } finally {
    await admin.end();
  }
};

run().catch((e) => {
  console.error('[migrate] 中止：', e instanceof Error ? e.message : e);
  process.exit(1);
});
