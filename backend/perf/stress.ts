/**
 * 登录接口限流压测（组员6 · 第四阶段待实测项）
 *
 * 目的：验证高频请求登录接口时，超过阈值（同一IP 10次/分钟）是否被 429/20014 拦下。
 *
 * 前置：
 *   1. 后端已启动：cd backend && npm run dev   （默认 http://localhost:3001）
 *   2. 数据库已连接（.env 配好 DB_*）
 *
 * 运行：
 *   cd backend
 *   npx tsx perf/stress.ts
 *
 * 预期结果：
 *   - 前 ~10 次返回 400（密码错误，说明接口正常处理）
 *   - 超过 10 次后返回 429（说明限流生效，防刷成功）
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const TOTAL = 30; // 打 30 次

async function hitOnce(i: number): Promise<{ i: number; status: number; code?: number; ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `stress-${i}-${Date.now()}` },
      body: JSON.stringify({ mobile: '13800009999', password: 'WrongPass@123' }),
    });
    const body: any = await res.json().catch(() => ({}));
    return { i, status: res.status, code: body?.code, ms: Date.now() - start };
  } catch (e: any) {
    return { i, status: 0, ms: Date.now() - start };
  }
}

(async () => {
  console.log(`压测目标: ${BASE}/v1/auth/login  共 ${TOTAL} 次并发`);
  console.log('限流规则: 同一IP 登录 10 次/分钟，超过返回 429/20014\n');

  // 并发打 30 次（不等待，全发出去）
  const results = await Promise.all(Array.from({ length: TOTAL }, (_, i) => hitOnce(i)));

  // 统计状态码分布
  const byStatus = new Map<number, number>();
  const byCode = new Map<string, number>();
  for (const r of results) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    const key = r.code != null ? `code=${r.code}` : `status=${r.status}`;
    byCode.set(key, (byCode.get(key) ?? 0) + 1);
  }

  const p95 = [...results].sort((a, b) => a.ms - b.ms)[Math.floor(TOTAL * 0.95)]?.ms ?? 0;

  console.log('=== 状态码分布 ===');
  for (const [s, n] of byStatus) console.log(`  HTTP ${s}: ${n} 次`);

  console.log('\n=== 业务码分布 ===');
  for (const [k, n] of byCode) console.log(`  ${k}: ${n} 次`);

  console.log(`\n=== 性能 ===`);
  console.log(`  P95 响应时间: ${p95}ms`);

  // 判定
  const blocked = byStatus.get(429) ?? 0;
  console.log('\n=== 验收判定 ===');
  if (blocked >= 1) {
    console.log(`✅ 限流生效：有 ${blocked} 次请求被 429 拦截，防刷机制正常`);
    process.exit(0);
  } else {
    console.log('❌ 未触发 429：限流可能未生效，检查 rateLimit 配置或数据库 api_rate_limit 表');
    process.exit(1);
  }
})();
