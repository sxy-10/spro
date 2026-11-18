// 用值导入（不是 type 导入）：下面要读 WebSocket.OPEN 这个静态常量
import { WebSocket } from 'ws';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { incrBy } from '../db/redis.js';
import { encodeFrame, logEvent, type Platform, type ServerFrame } from './protocol.js';

/**
 * 连接注册表（第 2 棒 · 组员1）
 *
 * 职责只有一件：**知道"谁在哪几条连接上"，并把帧推过去**。
 * 不做落库、不做发号、不做 ACK —— 那些是第 3 棒的事。
 *
 * 数据结构：
 *   byUser:  userId → Set<连接>      （一个用户可以多端在线，第 3 棒推消息时按端分发）
 *   byConnId: connId → 连接           （关闭时按连接 id 摘除，O(1)）
 *
 * 为什么 sendToConv 要查库而不是内存缓存参与者：
 *   会话成员会被第 1 棒的 `imRouter` 动态增删（POST /im/conversations/:id/participants），
 *   内存缓存一旦不同步就会出现"新成员收不到消息"这种极难查的问题。
 *   im_participant 的主键就是 (conversation_id, user_id)，单次查询是覆盖索引扫描，
 *   单机 demo 规模下代价可以忽略；真要优化，等第 6 棒压测有数据了再加带失效的缓存。
 */

/** 一条 WS 连接的全部运行期状态 */
export interface WsConnection {
  /** 内部连接 id，仅用于日志与去重 */
  connId: string;
  userId: number;
  deviceId: string;
  platform: Platform;
  socket: WebSocket;
  connectedAt: number;
  /** 最近一次收到客户端 ping 的时间（毫秒） */
  lastPingAt: number;
  /** 最近一次服务端回 pong 的时间（毫秒） */
  lastPongAt: number;
}

class ConnectionHub {
  private readonly byUser = new Map<number, Set<WsConnection>>();
  private readonly byConnId = new Map<string, WsConnection>();

  /** 注册连接，并把 `im:stat:conn` 这个 gauge +1（Redis 不可用时静默跳过） */
  register(connection: WsConnection): void {
    let bucket = this.byUser.get(connection.userId);
    if (!bucket) {
      bucket = new Set<WsConnection>();
      this.byUser.set(connection.userId, bucket);
    }
    bucket.add(connection);
    this.byConnId.set(connection.connId, connection);
    void incrBy('im:stat:conn', 1);
  }

  /** 注销连接；返回该用户是否已经没有其它在线连接了（用于决定是否清 presence） */
  unregister(connection: WsConnection): { userFullyOffline: boolean } {
    const bucket = this.byUser.get(connection.userId);
    if (bucket) {
      bucket.delete(connection);
      if (bucket.size === 0) this.byUser.delete(connection.userId);
    }
    this.byConnId.delete(connection.connId);
    void incrBy('im:stat:conn', -1);
    return { userFullyOffline: !this.byUser.has(connection.userId) };
  }

  /** 某用户的全部连接（多端） */
  connectionsOf(userId: number): WsConnection[] {
    return [...(this.byUser.get(userId) ?? [])];
  }

  connectionCount(): number {
    return this.byConnId.size;
  }

  /** 去重后的在线用户数（进程内视角；跨实例请看 presence 的 Redis 计数） */
  onlineUserCount(): number {
    return this.byUser.size;
  }

  /**
   * 推给某个用户的所有端。返回成功写出的连接数。
   * 写失败的连接直接摘掉并关闭，避免"僵尸连接"长期占着在线名额。
   */
  sendToUser(userId: number, frame: ServerFrame): number {
    const bucket = this.byUser.get(userId);
    if (!bucket || bucket.size === 0) return 0;
    const payload = encodeFrame(frame);
    let delivered = 0;
    for (const connection of [...bucket]) {
      if (connection.socket.readyState !== WebSocket.OPEN) {
        this.unregister(connection);
        continue;
      }
      try {
        connection.socket.send(payload);
        delivered += 1;
      } catch (error: any) {
        logEvent('im.ws.send_failed', {
          connId: connection.connId,
          userId: String(userId),
          message: error?.message ?? String(error)
        });
        this.unregister(connection);
        try {
          connection.socket.terminate();
        } catch {
          /* 已经断了 */
        }
      }
    }
    return delivered;
  }

  /** 关闭所有连接（优雅停机用） */
  closeAll(code: number, reason: string): void {
    for (const connection of [...this.byConnId.values()]) {
      try {
        connection.socket.close(code, reason);
      } catch {
        /* 忽略 */
      }
    }
    this.byUser.clear();
    this.byConnId.clear();
  }
}

export const hub = new ConnectionHub();

/**
 * 推给某个会话的所有参与者（不含自己发的回显由调用方决定）。
 *
 * 用法（第 3 棒在 messageService.send() 落库成功后调用）：
 *   sendToConv(convId, { v:1, t:'msg', convId, seq, clientMsgId, senderId, type, content, ts: Date.now() })
 *
 * @returns 实际送达的连接数（0 表示全离线 —— 第 3 棒据此决定要不要写 MQ 离线通知）
 */
export async function sendToConv(
  conversationId: string | number,
  frame: ServerFrame,
  options: { excludeUserId?: number | string } = {}
): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT user_id FROM im_participant WHERE conversation_id = ?',
    [Number(conversationId)]
  );
  const exclude = options.excludeUserId === undefined ? null : Number(options.excludeUserId);

  let delivered = 0;
  for (const row of rows) {
    const userId = Number(row.user_id);
    if (exclude !== null && userId === exclude) continue;
    delivered += hub.sendToUser(userId, frame);
  }
  return delivered;
}
