/**
 * 死信队列重放工具（阶段六新增）
 *
 * 用法：
 *   npx tsx scripts/mq-replay.ts             # 把 DLQ 里的消息全部重投回主队列
 *   npx tsx scripts/mq-replay.ts --dry-run   # 只看有几条、错在哪，不动数据
 *   npx tsx scripts/mq-replay.ts --limit 50  # 只重放最近 50 条
 *
 * 为什么需要它：消息进死信说明"落库失败"，但失败原因往往是临时的
 * （数据库重启、连接池打满、乐观锁冲突）。没有重放工具，那些单就只能人工补，
 * 而且 Redis 里的库存已经被回补过，人工补单会重复扣库存。
 *
 * 实现要点：
 *   1. 用 XRANGE 读 DLQ，XADD 回主 Stream（保留 reqId，消费者靠 req_id 幂等去重）
 *   2. 重投成功后 XDEL 掉 DLQ 里的这条，避免下次重复重放
 *   3. 重放不会重新扣 Redis 库存 —— 因为进 DLQ 时已经回补过了，
 *      消费者落库失败会再回补一次（幂等靠 req_id + uk_order_req 兜底）
 */
import 'dotenv/config';
import { getRedis, redisKey } from '../src/db/redis.js';
import { SECKILL_STREAM, SECKILL_DLQ } from '../src/mq/producer.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 2000;

async function main() {
  const redis = getRedis();
  if (!redis) {
    console.error('Redis 不可用：检查 backend/.env 里的 REDIS_HOST / REDIS_PORT');
    process.exitCode = 1;
    return;
  }

  const dlqKey = redisKey(SECKILL_DLQ);
  const streamKey = redisKey(SECKILL_STREAM);

  const total = await redis.xlen(dlqKey);
  console.log(`死信队列 ${SECKILL_DLQ} 当前共 ${total} 条，本次最多处理 ${limit} 条${dryRun ? '（dry-run）' : ''}`);

  const entries = await redis.xrange(dlqKey, '-', '+', 'COUNT', limit);
  if (!entries.length) {
    console.log('没有需要重放的消息');
    return;
  }

  let replayed = 0;
  for (const [id, fields] of entries as Array<[string, string[]]>) {
    const map: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];

    if (dryRun) {
      console.log(`[dry-run] id=${id} reqId=${map.reqId} route=${map.routeId} date=${map.date} people=${map.people} error=${map.error}`);
      continue;
    }

    await redis.xadd(
      streamKey,
      'MAXLEN', '~', Number(process.env.SECKILL_STREAM_MAXLEN ?? 10000),
      '*',
      'reqId', map.reqId,
      'userId', map.userId,
      'routeId', map.routeId,
      'date', map.date,
      'people', map.people
    );
    await redis.xdel(dlqKey, id);
    replayed += 1;
    console.log(JSON.stringify({ event: 'dlq.replayed', id, reqId: map.reqId }));
  }

  console.log(dryRun ? '（dry-run 结束，未修改任何数据）' : `重放完成：${replayed} 条`);
}

main()
  .catch((error) => {
    console.error('重放失败：', error);
    process.exitCode = 1;
  })
  .finally(() => {
    // 让脚本自己退出，别被 Redis 连接挂住
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  });
