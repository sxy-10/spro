/**
 * IM 离线通知消费者（组员3 · 第 3 棒）
 *
 * 链路：XREADGROUP 阻塞读 im:notify → 查会话所有参与者 →
 *       在线（Redis im:online:{uid} 存在）跳过 / 离线 INCR im:offline:{uid} → XACK。
 * 模式与 seckill 消费者一致：崩溃后 pending 消息留在 PEL，可重新认领，不丢不重放业务副作用
 * （INCR 是幂等兜底计数，重复消费最多多计一次，对"提醒"场景可接受）。
 */
import { pool } from '../db/connection.js';
import { getRedis, redisKey } from '../db/redis.js';
import { IM_STREAM } from './producer.js';
import { logEvent } from '../im/protocol.js';

const GROUP_NAME = 'im-notify-group';
const CONSUMER_NAME = `im-notify-${process.pid}`;
const BLOCK_MS = 5000;
const BATCH = 50;

let running = false;

/** 会话所有参与者中，当前不在线（Redis 在线 hash 不存在）的用户 id 列表 */
async function offlineParticipants(convId: number): Promise<number[]> {
  const [rows] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT p.user_id AS userId
       FROM im_participant p
      WHERE p.conversation_id=?`,
    [convId]
  );
  const redis = getRedis();
  if (!redis) return []; // Redis 不可用时安静降级，不堆死信
  const offline: number[] = [];
  for (const r of rows) {
    const uid = String(r.userId);
    const exists = await redis.exists(redisKey(`im:online:${uid}`));
    if (!exists) offline.push(Number(uid));
  }
  return offline;
}

export function startImNotifyConsumer(): () => void {
  const redis = getRedis();
  if (!redis || running) return () => {};
  running = true;
  void (async () => {
    try {
      await redis.xgroup('CREATE', redisKey(IM_STREAM), GROUP_NAME, '0', 'MKSTREAM');
    } catch (err) {
      if (!String(err).includes('BUSYGROUP')) {
        logEvent('im.notify.group_create_fail', { err: String(err) });
      }
    }
    while (running) {
      try {
        const res = await redis.xreadgroup(
          'GROUP', GROUP_NAME, CONSUMER_NAME,
          'COUNT', BATCH, 'BLOCK', BLOCK_MS,
          'STREAMS', redisKey(IM_STREAM), '>'
        );
        if (!res) continue;
        const stream = (res as Array<[string, Array<[string, string[]]>]>)[0][1];
        for (const [messageId, fields] of stream) {
          const map: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
          const convId = Number(map.convId);
          try {
            const users = await offlineParticipants(convId);
            for (const uid of users) {
              await redis.incr(redisKey(`im:offline:${uid}`));
            }
            logEvent('im.notify.consumed', { convId, offline: users.length });
          } catch (err) {
            logEvent('im.notify.consume_fail', { convId, err: String(err) });
          }
          await redis.xack(redisKey(IM_STREAM), GROUP_NAME, messageId);
        }
      } catch {
        await new Promise((r) => setTimeout(r, 1000)); // Redis 抖动退避 1s
      }
    }
  })();
  return stopImNotifyConsumer;
}

export function stopImNotifyConsumer(): void {
  running = false;
}
