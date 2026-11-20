import { createServer } from 'node:http';
import { app } from './app.js';
import { secret } from './api/core.js';
import { cleanupExpiredRateLimits } from './api/core.js';
import { startStockExpiryJob } from './api/stock.js';
import { reconcileSeckillStock, warmUpAllSeckillStock } from './api/stockCache.js';
import { startSeckillConsumer, getQueueStats } from './mq/consumer.js';
import { startImNotifyConsumer, stopImNotifyConsumer } from './mq/imNotifyConsumer.js';
import { waitForRedis } from './db/redis.js';
import { attachWs } from './im/wsServer.js';
import { startPresenceJanitor } from './im/presence.js';
import { logEvent } from './im/protocol.js';

secret();

/* ------------------------------------------------------------------ *
 * 第 2 棒改动：由 app.listen 改为 http.createServer(app) + attachWs
 *
 * 原因：WS 与 HTTP 必须共用一个 3001 端口（分工文档 §2「端口」决策），
 *      而 express 的 app.listen 内部自己建了 server，拿不到句柄去挂 upgrade 事件。
 *      这里显式建 server，先 attachWs 再 listen，顺序不能反 ——
 *      反了的话启动瞬间进来的 upgrade 请求会因为没监听器而被直接销毁。
 * ------------------------------------------------------------------ */
const server = createServer(app);
const wsServer = attachWs(server);

server.listen(Number(process.env.PORT) || 3001, () => {
  console.log('Travel Agent API started');
  logEvent('im.ws.listening', {
    port: Number(process.env.PORT) || 3001,
    path: '/v1/im/ws'
  });
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;

const stopStockExpiry = startStockExpiryJob();
const stopSeckillConsumer = startSeckillConsumer();
// IM 离线通知消费者（组员3 · 第 3 棒）：读 im:notify，离线参与者 INCR im:offline:{uid}
startImNotifyConsumer();
// 在线状态清理：清掉"进程被 kill 后遗留在 im:online:set 里"的僵尸用户
const stopPresenceJanitor = startPresenceJanitor();

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
  stopImNotifyConsumer();
  stopPresenceJanitor();
  clearInterval(rateLimitCleanupTimer);
  clearInterval(reconcileTimer);
  // 给所有 WS 连接发 4005 再关，客户端据此不再重试（换进程重启才有意义）
  void wsServer.close();
});
