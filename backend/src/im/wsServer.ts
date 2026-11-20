import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import type { RowDataPacket } from 'mysql2/promise';
import { secret } from '../api/core.js';
import { pool } from '../db/connection.js';
import { isCodeGranted, loadPermissions } from '../auth/rbac.js';
import { readCachedUser } from '../auth/sessionCache.js';
import type { AuthenticatedUserPayload } from '../auth/passport.js';
import { hub, type WsConnection } from './hub.js';
import { markOffline, markOnline, touch } from './presence.js';
import { send as sendMessage, listSince } from './messageService.js';
import { publishImNotify } from '../mq/producer.js';
import { incrBy } from '../db/redis.js';
import { sendToConv } from './hub.js';
import {
  AUTH_TIMEOUT_MS,
  HEARTBEAT_MS,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  PONG_TIMEOUT_MS,
  WS_PATH,
  WS_REQUIRED_PERMISSION,
  WsCloseCode,
  ackOkFrame,
  authOkFrame,
  encodeFrame,
  errorFrame,
  logEvent,
  parseClientFrame,
  pongFrame,
  type ClientFrame,
  type Platform,
  type ServerFrame
} from './protocol.js';

/**
 * IM WebSocket 服务端（第 2 棒 · 组员1）
 *
 * 这一棒只负责"把电话线架通"，四件事：
 *   ① 握手：`ws://host:3001/v1/im/ws?token=<access token>`，验 JWT + api_session + 权限
 *   ② 心跳：客户端 30s 一次 ping；30s 收不到 ping 或 10s 收不到底层 pong → close(4001)
 *   ③ 在线状态：连接/心跳时写 Redis `im:online:{userId}`（见 presence.ts）
 *   ④ 推送通道：暴露 hub.sendToUser / sendToConv 给第 3 棒用
 *
 * **不做**：消息落库、发号、ACK、断线对账、离线补偿 —— 那是第 3 棒（组员3）的活，
 * 本文件里对应的分支留了 `TODO(第3棒)` 标记并回 `not_implemented` 错误帧。
 *
 * 为什么用 `noServer: true`：
 *   express 的 app 和 ws 共用一个 3001 端口，必须自己接管 `upgrade` 事件；
 *   用 noServer 模式才能先判断路径（/v1/im/ws），别的路径直接 404 掉，
 *   不会把普通 HTTP 请求误升级。
 */

/** 一条连接在服务端的运行期状态（WsConnection 是"身份"，这里是"健康度"） */
interface LiveConnection {
  state: WsConnection;
  /** 是否已完成鉴权 */
  authed: boolean;
  /** 最近一次发底层 ping 的时间，用于 10s 无 pong 的判定 */
  lastTransportProbeAt: number;
  /** 是否还在等底层 pong 回执 */
  awaitingPong: boolean;
}

export interface WsServerHandle {
  /** 优雅停机：给所有连接发 4005 后关掉 wss 与定时器 */
  close: () => Promise<void>;
  /** 给 /v1/health 之类的地方用 */
  stats: () => { connections: number; users: number };
}

type AuthOutcome =
  | { ok: true; user: AuthenticatedUserPayload }
  | { ok: false; reason: 'invalid_token' | 'forbidden' };

/**
 * 校验 WS 握手 token。
 *
 * 走两条路（与 HTTP 的 authenticateJwt 保持同一套语义）：
 *   1. Redis 登录态缓存命中 → 直接拿 userId/权限（readCachedUser 内部仍会重新验签 JWT）
 *   2. 未命中 → 验签 + 查 api_session/sys_user + 实时加载权限码
 *
 * 注意：WS 不像 HTTP 那样有 req.user，所以这里自己算一遍，
 * 但**判定口径完全一致**（同为 `im:session:query`），避免"HTTP 能看会话、WS 连不上"的割裂。
 */
async function authenticateToken(token: string): Promise<AuthOutcome> {
  const cached = await readCachedUser(token);
  if (cached) {
    if (!isCodeGranted(WS_REQUIRED_PERMISSION, cached.permissions ?? [])) {
      return { ok: false, reason: 'forbidden' };
    }
    return { ok: true, user: cached };
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret(), {
      algorithms: ['HS256'],
      issuer: 'travel-agent',
      audience: 'travel-client'
    }) as jwt.JwtPayload;
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }

  const userId = Number(payload.sub);
  const sessionId = String(payload.jti ?? '');
  if (!Number.isInteger(userId) || userId <= 0 || !sessionId) {
    return { ok: false, reason: 'invalid_token' };
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.phone, u.role, u.agency_id
       FROM api_session s
       JOIN sys_user u ON u.id = s.user_id
      WHERE s.session_id = ? AND s.user_id = ?
        AND s.is_revoked = 0 AND s.expires_at > UTC_TIMESTAMP()
        AND u.status = 'ACTIVE'`,
    [sessionId, userId]
  );
  if (!rows.length) return { ok: false, reason: 'invalid_token' };

  const permissions = await loadPermissions(userId);
  if (!isCodeGranted(WS_REQUIRED_PERMISSION, permissions)) {
    return { ok: false, reason: 'forbidden' };
  }

  return {
    ok: true,
    user: {
      id: String(userId),
      phone: rows[0].phone,
      role: rows[0].role,
      agency_id: rows[0].agency_id,
      roles: [],
      permissions,
      sessionId
    }
  };
}

/** 记录设备（多端在线排查用；失败不影响连接本身） */
async function upsertDevice(userId: number, deviceId: string, platform: Platform): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO im_device (user_id, device_id, platform, last_seen_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE platform = VALUES(platform), last_seen_at = UTC_TIMESTAMP(3)`,
      [userId, deviceId, platform]
    );
  } catch (error: any) {
    logEvent('im.ws.device_upsert_failed', {
      userId: String(userId),
      message: error?.message ?? String(error)
    });
  }
}

/**
 * 把一个 HTTP Server 挂上 WS 能力。
 * 用法（见 server.ts）：
 *   const server = createServer(app);
 *   const ws = attachWs(server);
 *   server.listen(3001);
 */
export function attachWs(server: HttpServer): WsServerHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const live = new Map<WebSocket, LiveConnection>();

  /* ---------------------- 握手前的路径检查 ---------------------- */

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname = '';
    let queryToken: string | null = null;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      pathname = url.pathname;
      queryToken = url.searchParams.get('token');
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    if (pathname !== WS_PATH) {
      // 不是 WS 路径：明确回 404，避免健康检查/爬虫把端口打满
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      // 把 query 里的 token 带进去（wscat 之类不支持自定义帧的客户端靠它）
      (ws as WebSocket & { __queryToken?: string | null }).__queryToken = queryToken;
      wss.emit('connection', ws, req);
    });
  };

  server.on('upgrade', onUpgrade);

  /* ---------------------- 连接建立 ---------------------- */

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const now = Date.now();
    const remote = req.socket.remoteAddress ?? 'unknown';

    // 身份字段先占位，鉴权成功后回填
    const connection: LiveConnection = {
      state: {
        connId: randomUUID(),
        userId: 0,
        deviceId: '',
        platform: 'WEB',
        socket: ws,
        connectedAt: now,
        lastPingAt: now,
        lastPongAt: 0
      },
      authed: false,
      lastTransportProbeAt: 0,
      awaitingPong: false
    };
    live.set(ws, connection);

    logEvent('im.ws.connected', { connId: connection.state.connId, remote });

    const send = (frame: ServerFrame): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(encodeFrame(frame));
      } catch (error: any) {
        logEvent('im.ws.send_failed', {
          connId: connection.state.connId,
          message: error?.message ?? String(error)
        });
      }
    };

    /** 主动断开：先发 close 帧（客户端能拿到 4001/4003 等业务码），1s 后强制 terminate */
    const closeWith = (code: number, reason: string): void => {
      try {
        ws.close(code, reason);
      } catch {
        /* 已经断了 */
      }
      const timer = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          /* 忽略 */
        }
      }, 1000);
      timer.unref?.();
    };

    /* ---------------- 鉴权 ---------------- */

    const doAuth = async (token: string, deviceIdHint?: string, platformHint?: Platform): Promise<void> => {
      if (connection.authed) return;

      let outcome: AuthOutcome;
      try {
        outcome = await authenticateToken(token);
      } catch (error: any) {
        logEvent('im.ws.auth_failed', {
          connId: connection.state.connId,
          reason: 'exception',
          message: error?.message ?? String(error)
        });
        send(errorFrame('auth_failed', '鉴权过程异常'));
        closeWith(WsCloseCode.AUTH_FAILED, 'auth_failed');
        return;
      }

      if (!outcome.ok) {
        logEvent('im.ws.auth_failed', {
          connId: connection.state.connId,
          reason: outcome.reason
        });
        send(errorFrame(outcome.reason, outcome.reason === 'forbidden' ? '缺少 im:session:query 权限' : '登录已失效'));
        closeWith(
          outcome.reason === 'forbidden' ? WsCloseCode.FORBIDDEN : WsCloseCode.AUTH_FAILED,
          outcome.reason
        );
        return;
      }

      const userId = Number(outcome.user.id);
      const deviceId = deviceIdHint ?? randomUUID();
      const platform: Platform = platformHint ?? 'WEB';

      connection.authed = true;
      connection.state.userId = userId;
      connection.state.deviceId = deviceId;
      connection.state.platform = platform;
      connection.state.lastPingAt = Date.now();

      // 1) 登记到连接表（此后 sendToUser 就能找到这条连接）
      hub.register(connection.state);
      // 2) 在线状态（Redis，失败不影响连接）
      void markOnline(userId, deviceId);
      // 3) 设备记录（失败不影响连接）
      void upsertDevice(userId, deviceId, platform);

      send(authOkFrame(userId, deviceId));
      logEvent('im.ws.auth_ok', {
        connId: connection.state.connId,
        userId: String(userId),
        deviceId,
        platform,
        protocol: PROTOCOL_VERSION
      });
    };

    // 支持 `?token=` 直接握手（分工文档的交棒验收用 wscat，它不会发 auth 帧）
    const queryToken = (ws as WebSocket & { __queryToken?: string | null }).__queryToken ?? null;
    if (queryToken) void doAuth(queryToken);

    /* ---------------- 收帧 ---------------- */

    ws.on('message', (raw: unknown, isBinary: boolean) => {
      if (isBinary) {
        send(errorFrame('unsupported_binary', '本项目不支持二进制帧'));
        return;
      }

      const text = String(raw);
      const parsed = parseClientFrame(text);
      if (!parsed.ok) {
        send(errorFrame(parsed.code, parsed.msg));
        return;
      }

      const frame: ClientFrame = parsed.frame;

      if (frame.t === 'auth') {
        void doAuth(frame.token, frame.deviceId, frame.platform);
        return;
      }

      // 除 auth 之外的帧都要求先鉴权
      if (!connection.authed) {
        send(errorFrame('not_authenticated', '请先发送 auth 帧'));
        return;
      }

      switch (frame.t) {
        case 'ping': {
          connection.state.lastPingAt = Date.now();
          connection.state.lastPongAt = Date.now();
          send(pongFrame(frame.ts));
          void touch(connection.state.userId, connection.state.deviceId);
          return;
        }

        case 'msg': {
          // 第 3 棒：发号+落库（messageService.send 内含幂等预检）+ ACK + 广播 + 离线 MQ 通知
          // 注意：ws.on('message') 回调是同步的，异步逻辑必须包进 IIFE，不能直接 await
          void (async () => {
            const connIdNum = Number(frame.convId);
            const userIdNum = Number(connection.state.userId);
            const db = await pool.getConnection();   // 行锁 FOR UPDATE 必须在事务里
            let sent;
            try {
              await db.beginTransaction();
              sent = await sendMessage(db, connIdNum, userIdNum, frame.clientMsgId, frame.content);
              await db.commit();
            } catch (err) {
              await db.rollback();
              db.release();
              logEvent('im.ws.msg_fail', { convId: connIdNum, err: String(err) });
              send(errorFrame('msg_failed', '消息发送失败，请重试'));
              return;
            }
            db.release();

            // 1) 先给发送者回 ACK（客户端最关心"存上没有，seq 是几"）
            send(ackOkFrame(frame.clientMsgId, sent.seq));

            // 2) 大屏计数（失败不影响主流程）
            void incrBy('im:stat:msg', 1).catch(() => {});

            // 3) 广播给会话内其他人（排除发送者自己）——传帧对象，不是 encodeFrame 字符串
            let delivered = 0;
            try {
              delivered = await sendToConv(
                connIdNum,
                {
                  v: PROTOCOL_VERSION,
                  t: 'msg',
                  convId: String(sent.conversation_id),
                  seq: sent.seq,
                  clientMsgId: sent.client_msg_id,
                  senderId: sent.sender_id,
                  type: sent.content_type,
                  content: sent.content,
                  ts: new Date(sent.created_at).getTime()
                },
                { excludeUserId: userIdNum }
              );
            } catch (err) {
              logEvent('im.ws.broadcast_fail', { convId: connIdNum, err: String(err) });
            }

            // 4) 全员离线 → MQ 离线通知（消费者按参与者 INCR im:offline:{uid}）
            if (delivered === 0) {
              void publishImNotify({
                convId: connIdNum,
                seq: sent.seq,
                preview: sent.content.slice(0, 30)
              }).catch((err) => logEvent('im.notify.publish_fail', { err: String(err) }));
            }

            logEvent('im.ws.msg_sent', { convId: connIdNum, seq: sent.seq, delivered });
          })();
          return;
        }

        case 'ack': {
          // 已读游标：GREATEST 只前进不后退；两表同事务，避免游标不一致
          void (async () => {
            const ackSeq = Number(frame.seq);
            const ackConvId = Number(frame.convId);
            const ackUserId = Number(connection.state.userId);
            const db = await pool.getConnection();
            try {
              await db.beginTransaction();
              await db.query(
                `UPDATE im_participant SET last_read_seq=GREATEST(last_read_seq,?)
                 WHERE conversation_id=? AND user_id=?`,
                [ackSeq, ackConvId, ackUserId]
              );
              await db.query(
                `INSERT INTO im_read_cursor (conversation_id, user_id, last_read_seq)
                 VALUES (?,?,?)
                 ON DUPLICATE KEY UPDATE last_read_seq=GREATEST(last_read_seq,VALUES(last_read_seq)), last_read_at=CURRENT_TIMESTAMP(3)`,
                [ackConvId, ackUserId, ackSeq]
              );
              await db.commit();
              logEvent('im.ws.ack', { convId: ackConvId, seq: ackSeq });
            } catch (err) {
              await db.rollback();
              logEvent('im.ws.ack_fail', { err: String(err) });
              send(errorFrame('ack_failed', '已读游标写入失败'));
            } finally {
              db.release();
            }
          })();
          return;
        }

        case 'sync': {
          // 离线同步：重放 lastSeq 之后的消息（≤200 条内存过滤，量大再改 SQL 按 seq 过滤）
          void (async () => {
            const lastSeq = Number(frame.lastSeq ?? 0);
            const rows = await listSince(
              Number(frame.convId),
              Number(connection.state.userId),
              0
            );
            const replay = rows.filter((r) => Number(r.seq) > lastSeq);
            for (const r of replay) {
              send({
                v: PROTOCOL_VERSION,
                t: 'msg',
                convId: String(r.conversation_id),
                seq: Number(r.seq),
                clientMsgId: String(r.client_msg_id),
                senderId: String(r.sender_id),
                type: r.content_type,
                content: r.content,
                ts: new Date(r.created_at as string).getTime()
              });
            }
            logEvent('im.ws.sync_done', { convId: frame.convId, lastSeq, replayed: replay.length });
          })();
          return;
        }

        default: {
          send(errorFrame('unknown_frame', '未知帧类型'));
          return;
        }
      }
    });

    /* ---------------- 底层探活回执 ---------------- */

    ws.on('pong', () => {
      connection.awaitingPong = false;
    });

    ws.on('error', (error: Error) => {
      logEvent('im.ws.error', {
        connId: connection.state.connId,
        userId: connection.state.userId ? String(connection.state.userId) : null,
        message: error.message
      });
    });

    ws.on('close', (code: number, reasonBuffer: Buffer) => {
      live.delete(ws);
      const reason = reasonBuffer?.toString() || '';
      if (connection.authed) {
        const { userFullyOffline } = hub.unregister(connection.state);
        void markOffline(connection.state.userId, connection.state.deviceId, userFullyOffline);
        logEvent('im.ws.closed', {
          connId: connection.state.connId,
          userId: String(connection.state.userId),
          deviceId: connection.state.deviceId,
          code,
          reason
        });
      } else {
        logEvent('im.ws.closed', { connId: connection.state.connId, code, reason, unauthenticated: true });
      }
    });
  });

  /* ---------------------- 心跳巡检 ---------------------- */

  const TICK_MS = 5000;
  let tick = 0;

  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    tick += 1;

    for (const [ws, connection] of live) {
      // 1) 连上但一直不鉴权：占坑超时
      if (!connection.authed) {
        if (now - connection.state.connectedAt > AUTH_TIMEOUT_MS) {
          logEvent('im.ws.auth_timeout', { connId: connection.state.connId });
          try {
            ws.close(WsCloseCode.AUTH_TIMEOUT, 'auth_timeout');
          } catch {
            /* 忽略 */
          }
        }
        continue;
      }

      // 2) 应用层心跳：30s 没收到客户端 ping 就判定掉线
      if (now - connection.state.lastPingAt > HEARTBEAT_MS) {
        logEvent('im.ws.heartbeat_timeout', {
          connId: connection.state.connId,
          userId: String(connection.state.userId),
          deviceId: connection.state.deviceId,
          idleMs: now - connection.state.lastPingAt,
          reason: 'no_ping'
        });
        try {
          ws.close(WsCloseCode.HEARTBEAT_TIMEOUT, 'heartbeat_timeout');
        } catch {
          /* 忽略 */
        }
        // 1s 后强杀，防止客户端不回 close 帧
        const killer = setTimeout(() => {
          try {
            ws.terminate();
          } catch {
            /* 忽略 */
          }
        }, 1000);
        killer.unref?.();
        continue;
      }

      // 3) 传输层探活：每 3 个 tick（15s）发一次原生 ping；
      //    10s 内拿不到原生 pong 说明 TCP 已经半死（拔网线/睡死），同样按 4001 处理
      if (connection.awaitingPong && now - connection.lastTransportProbeAt > PONG_TIMEOUT_MS) {
        logEvent('im.ws.heartbeat_timeout', {
          connId: connection.state.connId,
          userId: String(connection.state.userId),
          deviceId: connection.state.deviceId,
          reason: 'no_pong'
        });
        try {
          ws.close(WsCloseCode.HEARTBEAT_TIMEOUT, 'pong_timeout');
        } catch {
          /* 忽略 */
        }
        const killer = setTimeout(() => {
          try {
            ws.terminate();
          } catch {
            /* 忽略 */
          }
        }, 1000);
        killer.unref?.();
        continue;
      }

      if (!connection.awaitingPong && tick % 3 === 0) {
        connection.awaitingPong = true;
        connection.lastTransportProbeAt = now;
        try {
          ws.ping();
        } catch {
          /* 忽略 */
        }
      }
    }
  }, TICK_MS);
  heartbeatTimer.unref?.();

  /* ---------------------- 停机 ---------------------- */

  const handle: WsServerHandle = {
    stats: () => ({ connections: hub.connectionCount(), users: hub.onlineUserCount() }),
    close: async () => {
      clearInterval(heartbeatTimer);
      server.off('upgrade', onUpgrade);
      hub.closeAll(WsCloseCode.SERVER_SHUTDOWN, 'server_shutdown');
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      live.clear();
    }
  };

  return handle;
}
