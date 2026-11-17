import { app } from './app.js';
import { secret } from './api/core.js';
import { cleanupExpiredRateLimits } from './api/core.js';
import { startStockExpiryJob } from './api/stock.js';
import { reconcileSeckillStock, warmUpAllSeckillStock } from './api/stockCache.js';
import { startSeckillConsumer, getQueueStats } from './mq/consumer.js';
import { waitForRedis } from './db/redis.js';

secret();

const server = app.listen(Number(process.env.PORT) || 3001, () => console.log('Travel Agent API started'));
server.requestTimeout = 30000;
server.headersTimeout = 15000;

const stopStockExpiry = startStockExpiryJob();
const stopSeckillConsumer = startSeckillConsumer();

/* ------------------------------------------------------------------ *
 * 启动预热：等 Redis 连上再刷库存
 *
 * 旧代码是 `void warmUpAllSeckillStock()` 直接裸调：Redis 比 Node 慢启动时，
 * 所有 SET 都会静默失败，于是整个秒杀场次"全部售罄"，日志里只有一句 warmup.no_redis。
 * 现在先 waitForRedis，失败再退避重试 3 次。
 * ------------------------------------------------------------------ */
void (async () => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const ready = await waitForRedis(10000);
    if (!ready) {
      console.log(JSON.stringify({ event: 'seckill.warmup.redis_wait_timeout', attempt }));
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    await warmUpAllSeckillStock();
    return;
  }
  console.log(JSON.stringify({ event: 'seckill.warmup.give_up' }));
})();

/* ------------------------------------------------------------------ *
 * 定时任务：限流桶清理（api_rate_limit 不再无限增长）
 * ------------------------------------------------------------------ */
const rateLimitCleanupTimer = setInterval(() => {
  void cleanupExpiredRateLimits().then((deleted) => {
    if (deleted > 0) console.log(JSON.stringify({ event: 'rate_limit.cleanup', deleted }));
  });
}, 5 * 60 * 1000);
rateLimitCleanupTimer.unref();

/* ------------------------------------------------------------------ *
 * 定时任务：秒杀库存对账（Redis 剩余数 vs MySQL 已售数）
 *
 * 只有队列完全空闲时才做：在途消息还要再扣一次库存，重刷会把它们要扣的量补回来 → 超卖。
 * ------------------------------------------------------------------ */
const reconcileTimer = setInterval(async () => {
  try {
    const stats = await getQueueStats();
    if (stats.redis !== 'ok') return;
    if ((stats.pending ?? 0) > 0 || (stats.streamLength ?? 0) > 0) return;
    const result = await reconcileSeckillStock();
    if (result.refreshed > 0) console.log(JSON.stringify({ event: 'seckill.reconcile.done', ...result }));
  } catch (error: any) {
    console.log(JSON.stringify({ event: 'seckill.reconcile.failed', message: error?.message }));
  }
}, 5 * 60 * 1000);
reconcileTimer.unref();

server.on('close', () => {
  stopStockExpiry();
  stopSeckillConsumer();
  clearInterval(rateLimitCleanupTimer);
  clearInterval(reconcileTimer);
});
