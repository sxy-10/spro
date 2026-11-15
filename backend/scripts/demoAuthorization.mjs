#!/usr/bin/env node
/**
 * 授权层演示脚本（组员2 · 阶段二上台演示用）
 *
 * 演示内容：
 *   第 1 幕  认证 vs 授权三态：无 token → 401/20012；游客 → 403/20013；超管 → 200
 *   第 2 幕（--hot-reload）：给「旅行社管理员」角色摘掉/补回 system:role:query 权限，
 *           每次改动后下一次请求立即生效（写接口成功 → Casbin 策略缓存自动失效），
 *           演示结束自动还原角色原有授权，不留痕。
 *
 * 运行（在项目任意目录）：
 *   node backend/scripts/demoAuthorization.mjs
 *   node backend/scripts/demoAuthorization.mjs --hot-reload
 *
 * 前置：travel_agent_db 已执行 01→05 脚本；backend/.env 配好 DB_* 与 JWT_SECRET。
 *       脚本会自起后端服务（演示端口 3019）并自动准备 3 个联调账号，跑完自动关闭。
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const PORT = 3019;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const DEMO_PASSWORD = 'Passw0rd!23';
const HOT_RELOAD = process.argv.includes('--hot-reload');

/* ---------- .env 解析（只取 DB_* 与 JWT 相关键） ---------- */
function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(path.join(BACKEND, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    console.error('✗ 读不到 backend/.env —— 请先按交付说明配置数据库连接');
    process.exit(1);
  }
  return env;
}

/* ---------- 联调账号（与 e2e 同款，幂等） ---------- */
async function ensureDemoAccounts(env) {
  const pool = await mysql.createConnection({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_NAME || 'travel_agent_db',
    charset: 'utf8mb4'
  });
  await pool.query(
    `INSERT INTO travel_agency (id, agency_name, license_no, contact_name, contact_phone, status)
     VALUES (1, '联调旅行社', 'E2E-DEMO-LICENSE-0001', '联调', '13800000000', 'ACTIVE')
     ON DUPLICATE KEY UPDATE id = id`
  );
  const [roles] = await pool.query('SELECT id, code FROM sys_role');
  const roleIdByCode = new Map(roles.map((r) => [String(r.code), Number(r.id)]));
  const accounts = [
    { phone: '13800000001', username: 'rbac_super',   nickname: '联调-超管',         role: 'ADMIN',   agencyId: 1,    roleCode: 'SUPER_ADMIN' },
    { phone: '13800000002', username: 'rbac_agency',  nickname: '联调-旅行社管理员',  role: 'ADMIN',   agencyId: 1,    roleCode: 'AGENCY_ADMIN' },
    { phone: '13800000003', username: 'rbac_tourist', nickname: '联调-游客',         role: 'TOURIST', agencyId: null, roleCode: 'TOURIST' }
  ];
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 12);
  for (const a of accounts) {
    const roleId = roleIdByCode.get(a.roleCode);
    if (!roleId) { console.error(`✗ 角色不存在：${a.roleCode}，请先执行 database/05_rbac_schema.sql`); process.exit(1); }
    await pool.query(
      `INSERT INTO sys_user (username, phone, password_hash, nickname, role, agency_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), nickname = VALUES(nickname),
         agency_id = VALUES(agency_id), status = 'ACTIVE'`,
      [a.username, a.phone, hash, a.nickname, a.role, a.agencyId]
    );
    const [[user]] = await pool.query('SELECT id FROM sys_user WHERE phone = ?', [a.phone]);
    await pool.query('DELETE FROM sys_user_role WHERE user_id = ?', [user.id]);
    await pool.query('INSERT INTO sys_user_role (user_id, role_id) VALUES (?,?)', [user.id, roleId]);
  }
  await pool.end();
  console.log(`联调账号就绪（13800000001 超管 / 13800000002 社管 / 13800000003 游客，密码 ${DEMO_PASSWORD}）\n`);
}

/* ---------- 起停后端服务 ---------- */
function needRebuild() {
  const distEntry = path.join(BACKEND, 'dist', 'server.js');
  if (!existsSync(distEntry)) return true;
  const distMtime = statSync(distEntry).mtimeMs;
  const srcDir = path.join(BACKEND, 'src');
  for (const p of ['.env', ...readdirSync(srcDir, { recursive: true }).map((f) => path.join(srcDir, f))]) {
    try { if (statSync(p).isFile() && statSync(p).mtimeMs > distMtime) return true; } catch { /* 忽略 */ }
  }
  return false;
}

function startServer(env) {
  // 不用 tsx：这台机器上 tsx 依赖的 esbuild 原生二进制会被拦截，导致进程随机崩溃。
  // 改为 tsc 编译产物 + 纯 node 运行，行为一致且更稳。
  if (needRebuild()) {
    console.log('检测到代码比编译产物新（或产物缺失），先执行 tsc 编译…');
    const { status } = spawnSync('npx', ['tsc'], { cwd: BACKEND, shell: true, stdio: 'inherit' });
    if (status !== 0) { console.error('✗ 编译失败，请进 backend 目录手动执行 npm run build 查看报错'); process.exit(1); }
  }
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: BACKEND,
    env: { ...process.env, ...env, PORT: String(PORT) },
    // 注意：stdin 必须保持打开（不能 'ignore'），部分运行时检测到 stdin EOF 会退出
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(d));
  return child;
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/auth/login`, { method: 'OPTIONS' });
      return;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  console.error('✗ 后端服务 30 秒内未就绪，请检查 MySQL 是否启动、.env 是否正确');
  process.exit(1);
}

/* ---------- HTTP 小工具 ---------- */
async function login(mobile) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ mobile, password: DEMO_PASSWORD })
  });
  const body = await res.json();
  if (!body.data?.token) throw new Error(`登录失败 ${mobile}: ${JSON.stringify(body)}`);
  return body.data.token;
}

async function call(token, path, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

function show(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(34)} HTTP ${actual[0]} / 业务码 ${actual[1]}${ok ? '' : `   （预期 ${JSON.stringify(expected)}）`}`);
  return ok;
}
const statusOf = (r) => [r.status, r.json.code];

/* ---------- 主流程 ---------- */
const server = startServer(loadEnv());
let ok = true;
try {
  await ensureDemoAccounts(loadEnv());
  await waitReady();
  console.log(`后端已就绪：${BASE}\n`);

  const superToken = await login('13800000001');
  const agencyToken = await login('13800000002');
  const touristToken = await login('13800000003');

  console.log('━━ 第 1 幕：认证（你是谁）与授权（你能干什么）是两层 ━━');
  ok &= show('无 token 查角色列表（未登录）', statusOf(await call(null, '/roles')), [401, 20012]);
  ok &= show('游客 token 查角色列表（无权限）', statusOf(await call(touristToken, '/roles')), [403, 20013]);
  ok &= show('超管 token 查角色列表（放行）', statusOf(await call(superToken, '/roles')), [200, 0]);
  console.log();

  if (HOT_RELOAD) {
    console.log('━━ 第 2 幕：改完权限立即生效（无需重启 / 不用等缓存过期）━━');
    // 找 AGENCY_ADMIN 的 role_id
    const rolesRes = await call(superToken, '/roles');
    const agencyRole = (rolesRes.json.data?.list ?? rolesRes.json.data ?? [])
      .find?.((r) => r.code === 'AGENCY_ADMIN');
    if (!agencyRole) throw new Error('找不到 AGENCY_ADMIN 角色');
    const roleId = agencyRole.role_id ?? agencyRole.id;

    // system:role:query 是按钮权限：在 data.buttons 里找（权限树 list 只含菜单节点）
    const treeRes = await call(superToken, '/permissions');
    const button = (treeRes.json.data?.buttons ?? []).find((b) => b.code === 'system:role:query');
    let queryPid = button ? String(button.permission_id) : null;
    if (!queryPid) {
      (function walk(nodes) {
        for (const n of nodes ?? []) {
          if (n.code === 'system:role:query') queryPid = String(n.permission_id);
          walk(n.children);
        }
      })(treeRes.json.data?.list ?? treeRes.json.data);
    }
    if (!queryPid) throw new Error('权限树里找不到 system:role:query');

    // 剧本（社管在种子数据里本就没有 system:role:query）：
    //   ① 社管查角色列表 → 403（本来就没权限）
    //   ② 超管给社管「补上」query → 下一次请求立即 200（缓存已被写操作作废）
    //   ③ 再「摘掉」→ 立即回到 403
    //   ③ 的结果恰好等于原始授权（快照不含 query），数据自动还原，无需回滚
    const snapshot = (await call(superToken, `/roles/${roleId}/permissions`)).json.data.permission_ids;
    ok &= show('初始：社管无权查角色列表', statusOf(await call(agencyToken, '/roles')), [403, 20013]);

    console.log(`  超管给社管补上 system:role:query（id=${queryPid}）→ 社管授权 ${snapshot.length} → ${snapshot.length + 1} 条`);
    await call(superToken, `/roles/${roleId}/permissions`, 'PUT', { permission_ids: [...snapshot, queryPid] });
    ok &= show('补上后社管立即能查（200）', statusOf(await call(agencyToken, '/roles')), [200, 0]);

    await call(superToken, `/roles/${roleId}/permissions`, 'PUT', { permission_ids: snapshot });
    ok &= show('摘掉后社管立即查不了（403）', statusOf(await call(agencyToken, '/roles')), [403, 20013]);
    console.log('  ✓ 摘掉后恰好等于原始授权，数据已还原，不留痕\n');
  }

  console.log(HOT_RELOAD ? '演示完成（含热更新）' : '演示完成（加 --hot-reload 可看「改完权限立即生效」）');
  process.exitCode = ok ? 0 : 1;
} catch (err) {
  console.error('✗ 演示中断：', err.message);
  process.exitCode = 1;
} finally {
  server.kill();
}
