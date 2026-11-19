// 解析 autocannon 原始 JSON，输出压测汇总表
// 用法：node perf/summarize.mjs（在任意目录执行都可以，路径按本文件位置解析）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const groups = [
  ['A 直连 3001', 'A-direct.json'],
  ['B 经 Nginx 8080（无限流）', 'B-nginx.json'],
  ['C 经 Nginx 8088（限流）', 'C-limited.json'],
  ['D 经 8080 /v1/routes（带数据库）', 'D-routes-db.json'],
];

const rows = [];
for (const [name, file] of groups) {
  const j = JSON.parse(fs.readFileSync(path.join(HERE, file), 'utf8'));
  const sc = j.statusCodeStats || {};
  const ok = sc['200']?.count ?? 0;
  const blocked = sc['503']?.count ?? 0;
  rows.push({
    name,
    rps: Math.round(j.requests.average),
    total: j.requests.total,
    avg: Number(j.latency.average.toFixed(2)),
    p99: j.latency.p99,
    max: j.latency.max,
    ok,
    blocked,
    non2xx: j.non2xx,
    errors: j.errors,
    timeouts: j.timeouts,
  });
}

console.log('| 组 | RPS | 总请求 | 平均延迟(ms) | p99(ms) | 200 | 503 | 错误 | 超时 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.rps} | ${r.total} | ${r.avg} | ${r.p99} | ${r.ok} | ${r.blocked} | ${r.errors} | ${r.timeouts} |`);
}

const a = rows[0], b = rows[1], c = rows[2], d = rows[3];
console.log('');
console.log(`- 反代损耗（B vs A）：RPS ${a.rps} → ${b.rps}，变化 ${(((b.rps - a.rps) / a.rps) * 100).toFixed(1)}%`);
console.log(`- 反代延迟增量（B vs A）：${a.avg}ms → ${b.avg}ms，+${(b.avg - a.avg).toFixed(2)}ms`);
console.log(`- 限流拦截率（C）：503 ${c.blocked} / 总 ${c.total} = ${((c.blocked / c.total) * 100).toFixed(2)}%`);
console.log(`- C 组放行数 ${c.ok}，理论值 = 20r/s × 20s + burst 40 = 440`);
console.log(`- 数据库接口（D）：RPS ${d.rps}，p99 ${d.p99}ms，错误 ${d.errors}`);
