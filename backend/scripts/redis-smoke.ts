/**
 * Redis / Lua 自检脚本（阶段六新增）
 *
 * 用法：npx tsx scripts/redis-smoke.ts
 *
 * 为什么需要它：Lua 脚本是"改了看不出错"的那种代码 ——
 * 语法错会抛异常，但**逻辑错**（比如令牌桶算错补充量、库存返回码反了）
 * 只会在并发压测时才暴露。这个脚本用确定性的小例子把三个脚本各跑一遍，
 * 交作业前跑一次，比肉眼 review 一百遍强。
 *
 * 检查项：
 *   1. token_bucket.lua     容量 3、不补充 → 前 3 次放行，第 4 次拒绝
 *   2. deduct_stock.lua     10 个名额：扣 7 成功剩 3、再扣 5 失败且不改值、key 不存在返回 not_warmed
 *   3. login_fail.lua       连续 5 次计数正确、TTL 存在（不会永久锁定）、成功后能清空
 *   4. 连接与 key 前缀      REDIS_KEY_PREFIX 生效
 */
import 'dotenv/config';
import {
  bumpLoginFailure,
  clearLoginFailures,
  getRedis,
  isRedisReady,
  peekLoginFailure,
  preDeductStock,
  readStock,
  redisKey,
  tokenBucket,
  waitForRedis
} from '../src/db/redis.js';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name} —— ${detail}`);
}

async function checkTokenBucket() {
  const key = `smoke:bucket:${Date.now()}`;
  // 容量 3，补充速率 0（纯消耗），验证"放行 3 次、第 4 次拒绝"
  const outcomes: boolean[] = [];
  for (let i = 0; i < 4; i += 1) {
    const reply = await tokenBucket(key, 3, 0);
    outcomes.push(Boolean(reply?.allowed));
  }
  record(
    'token_bucket.lua 令牌桶',
    outcomes.filter(Boolean).length === 3 && outcomes[3] === false,
    `放行序列 = ${outcomes.map((v) => (v ? 1 : 0)).join('')}（期望 1110）`
  );
  await getRedis()?.del(redisKey(key));
}

async function checkDeductStock() {
  const key = `smoke:stock:${Date.now()}`;
  const redis = getRedis();
  await redis?.set(redisKey(key), '10', 'EX', 60);

  const first = await preDeductStock(key, 7);
  const second = await preDeductStock(key, 5);
  const afterFailed = await readStock(key);
  const missing = await preDeductStock(`smoke:missing:${Date.now()}`, 1);

  record('deduct_stock.lua 扣 7 剩 3', first.ok && first.remaining === 3, `ok=${first.ok} remaining=${first.remaining}`);
  record('deduct_stock.lua 库存不足不改值', !second.ok && second.reason === 'sold_out' && afterFailed === 3, `reason=${second.reason} 实际剩余=${afterFailed}`);
  record('deduct_stock.lua 未预热返回 not_warmed', missing.reason === 'not_warmed', `reason=${missing.reason}`);
  await redis?.del(redisKey(key));
}

async function checkLoginFailure() {
  const key = `smoke:login_fail:${Date.now()}`;
  const states = [];
  for (let i = 0; i < 5; i += 1) states.push(await bumpLoginFailure(key, 900));
  const peeked = await peekLoginFailure(key, 900);

  record(
    'login_fail.lua 计数递增',
    states.map((s) => s?.count).join(',') === '1,2,3,4,5',
    `计数 = ${states.map((s) => s?.count).join(',')}（期望 1,2,3,4,5）`
  );
  record(
    'login_fail.lua 一定有 TTL（不会永久锁定）',
    (peeked?.ttlSeconds ?? -1) > 0 && peeked?.count === 5,
    `count=${peeked?.count} ttl=${peeked?.ttlSeconds}s`
  );

  // 模拟历史脏 key：直接写一个没有 TTL 的计数，脚本应该自愈
  const redis = getRedis();
  await redis?.set(redisKey(key), '5');
  const healed = await peekLoginFailure(key, 900);
  record('login_fail.lua 自愈无 TTL 脏 key', (healed?.ttlSeconds ?? -1) > 0, `修复后 ttl=${healed?.ttlSeconds}s`);

  await clearLoginFailures(key);
  const cleared = await peekLoginFailure(key, 900);
  record('login_fail.lua 清理后可重新计数', (cleared?.count ?? 0) === 0, `count=${cleared?.count}`);
}

async function main() {
  const ready = await waitForRedis(5000);
  if (!ready || !isRedisReady()) {
    console.error('❌ Redis 不可用：检查 backend/.env 的 REDIS_HOST / REDIS_PORT，或 Memurai/redis-server 是否启动');
    process.exitCode = 1;
    return;
  }

  const prefix = process.env.REDIS_KEY_PREFIX ?? '';
  console.log(`Redis 已连接，key 前缀 = "${prefix}"，开始自检\n`);

  await checkTokenBucket();
  await checkDeductStock();
  await checkLoginFailure();

  const failed = results.filter((item) => !item.ok);
  console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length} 项`);
  if (failed.length) {
    console.log('失败项：', failed.map((item) => item.name).join(' / '));
    process.exitCode = 1;
  }
  getRedis()?.disconnect();
}

main().catch((error) => {
  console.error('自检异常：', error);
  process.exitCode = 1;
});
