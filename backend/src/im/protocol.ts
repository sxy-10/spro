import { z } from 'zod';

/**
 * IM 实时通道协议帧（第 2 棒 · 组员1）
 *
 * 这份文件是**第 3 棒、第 4 棒、第 5 棒的契约**：改字段名/改帧类型必须同步改这里
 * 和 `docs/specs/API_V1.md` §IM，否则客户端会对不上。
 *
 * 统一约定（对应分工文档 §2「WS 协议帧（t 区分，v:1）」）：
 *
 *   C→S  auth {token}                       建立连接后的第一帧，5s 内不发就断开
 *        ping {ts}                          客户端每 30s 一次，服务端回 pong
 *        msg  {convId,clientMsgId,type,content}   发消息（第 3 棒实现落库）
 *        ack  {convId,seq}                  已读到 seq（第 3 棒实现游标）
 *        sync {convId,lastSeq}              断线对账（第 3 棒实现）
 *
 *   S→C  auth_ok {userId,deviceId,serverTs}
 *        pong    {ts,serverTs}
 *        msg     {convId,seq,clientMsgId,senderId,type,content,ts}
 *        ack_ok  {clientMsgId,seq}
 *        notify  {kind,convId,preview}
 *        error   {code,msg}
 *
 * 帧格式：单行 JSON，必须带 `v`（协议版本）与 `t`（帧类型）。
 * 二进制帧一律拒绝（本项目不做二进制协议），超过 8KB 的帧直接拒绝。
 */

/** 协议版本：不兼容变更时 +1，客户端按版本号决定要不要重连 */
export const PROTOCOL_VERSION = 1;

/** WS 升级路径：与 HTTP 同端口 3001，Nginx 只需多一段 Upgrade 转发 */
export const WS_PATH = '/v1/im/ws';

/** 客户端应每 30s 发一次 ping；服务端 30s 收不到 ping 就判定掉线 */
export const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 30000);

/** 服务端探活后 10s 内拿不到底层 pong 回执，就认为连接已死 */
export const PONG_TIMEOUT_MS = Number(process.env.PONG_TIMEOUT_MS ?? 10000);

/** 连上之后多久没发 auth 就断开（防占坑） */
export const AUTH_TIMEOUT_MS = Number(process.env.WS_AUTH_TIMEOUT_MS ?? 5000);

/** 单帧最大字节数；超了直接断开，避免大 payload 打爆内存 */
export const MAX_FRAME_BYTES = Number(process.env.WS_MAX_FRAME_BYTES ?? 8192);

/** 客户端重连退避台阶（秒）：1/2/4/8/16/30，封顶 30s；客户端再叠 ±20% 抖动防重连风暴 */
export const RECONNECT_BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30] as const;

/**
 * 服务端主动关闭时用的**业务关闭码**（4000–4999 为应用自定义区间）：
 * 客户端看到 4001 就按「心跳超时」走重连，看到 4003/4004 就不要再重试（换了 token 才有意义）。
 */
export const WsCloseCode = {
  /** 30s 无 ping / 10s 无 pong 回执 */
  HEARTBEAT_TIMEOUT: 4001,
  /** 连上后没在规定时间内发 auth */
  AUTH_TIMEOUT: 4002,
  /** token 无效 / 会话已吊销 / 用户被停用 */
  AUTH_FAILED: 4003,
  /** 已登录，但没有 im:session:query 权限 */
  FORBIDDEN: 4004,
  /** 服务端优雅停机 */
  SERVER_SHUTDOWN: 4005
} as const;

/** 建立 WS 会话所需的最小权限，与 imRouter 的 requireAction('im:session','query') 同一口径 */
export const WS_REQUIRED_PERMISSION = 'im:session:query';

export type Platform = 'WEB' | 'IOS' | 'ANDROID';
export type ContentType = 'TEXT' | 'SYSTEM';

/** 帧里的 ID 可能是字符串（BIGINT 用字符串传，避免超过 2^53 精度丢失），统一归一到字符串 */
const bigId = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]);
/** seq 是会话内自增号，实际量级远小于 2^53，归一到 number 方便排序 */
const seqValue = z.union([z.string().regex(/^\d{1,15}$/), z.number().int().nonnegative()]);

const authFrame = z
  .object({
    v: z.literal(PROTOCOL_VERSION).optional(),
    t: z.literal('auth'),
    token: z.string().min(10).max(4096),
    deviceId: z.string().min(8).max(64).optional(),
    platform: z.enum(['WEB', 'IOS', 'ANDROID']).optional()
  })
  .strict();

const pingFrame = z
  .object({
    v: z.literal(PROTOCOL_VERSION).optional(),
    t: z.literal('ping'),
    ts: z.number().int().nonnegative().optional()
  })
  .strict();

const msgFrame = z
  .object({
    v: z.literal(PROTOCOL_VERSION).optional(),
    t: z.literal('msg'),
    convId: bigId,
    clientMsgId: z.string().min(8).max(64),
    type: z.enum(['TEXT', 'SYSTEM']).optional(),
    content: z.string().min(1).max(5000)
  })
  .strict();

const ackFrame = z
  .object({
    v: z.literal(PROTOCOL_VERSION).optional(),
    t: z.literal('ack'),
    convId: bigId,
    seq: seqValue
  })
  .strict();

const syncFrame = z
  .object({
    v: z.literal(PROTOCOL_VERSION).optional(),
    t: z.literal('sync'),
    convId: bigId,
    lastSeq: seqValue.optional()
  })
  .strict();

/* ---------------------------- 帧类型 ---------------------------- */

export interface AuthFrame {
  t: 'auth';
  token: string;
  deviceId?: string;
  platform?: Platform;
}

export interface PingFrame {
  t: 'ping';
  ts?: number;
}

export interface MsgFrame {
  t: 'msg';
  convId: string;
  clientMsgId: string;
  type: ContentType;
  content: string;
}

export interface AckFrame {
  t: 'ack';
  convId: string;
  seq: number;
}

export interface SyncFrame {
  t: 'sync';
  convId: string;
  lastSeq: number;
}

export type ClientFrame = AuthFrame | PingFrame | MsgFrame | AckFrame | SyncFrame;

export interface AuthOkFrame {
  v: number;
  t: 'auth_ok';
  userId: string;
  deviceId: string;
  serverTs: number;
}

export interface PongFrame {
  v: number;
  t: 'pong';
  ts: number;
  serverTs: number;
}

export interface ServerMsgFrame {
  v: number;
  t: 'msg';
  convId: string;
  seq: number;
  clientMsgId: string;
  senderId: string;
  type: ContentType;
  content: string;
  ts: number;
}

export interface AckOkFrame {
  v: number;
  t: 'ack_ok';
  clientMsgId: string;
  seq: number;
}

export interface NotifyFrame {
  v: number;
  t: 'notify';
  kind: string;
  convId: string;
  preview: string;
}

export interface ErrorFrame {
  v: number;
  t: 'error';
  code: string;
  msg: string;
}

export type ServerFrame =
  | AuthOkFrame
  | PongFrame
  | ServerMsgFrame
  | AckOkFrame
  | NotifyFrame
  | ErrorFrame;

/* ---------------------------- 解析与构造 ---------------------------- */

export type ParseResult =
  | { ok: true; frame: ClientFrame }
  | { ok: false; code: string; msg: string };

/**
 * 解析客户端帧。**任何异常都不抛**，统一返回 `{ok:false}`，
 * 由调用方回一帧 `error` 后决定是否断开。
 */
export function parseClientFrame(raw: string): ParseResult {
  if (raw.length > MAX_FRAME_BYTES) {
    return { ok: false, code: 'frame_too_large', msg: `单帧不能超过 ${MAX_FRAME_BYTES} 字节` };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_json', msg: '帧必须是合法 JSON' };
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'invalid_frame', msg: '帧必须是 JSON 对象' };
  }

  const type = (payload as { t?: unknown }).t;
  const version = (payload as { v?: unknown }).v;
  if (version !== undefined && version !== PROTOCOL_VERSION) {
    return { ok: false, code: 'unsupported_version', msg: `不支持的协议版本 ${String(version)}` };
  }

  switch (type) {
    case 'auth': {
      const parsed = authFrame.safeParse(payload);
      if (!parsed.success) return { ok: false, code: 'invalid_auth', msg: 'auth 帧缺少 token' };
      return { ok: true, frame: parsed.data as AuthFrame };
    }
    case 'ping': {
      const parsed = pingFrame.safeParse(payload);
      if (!parsed.success) return { ok: false, code: 'invalid_ping', msg: 'ping 帧格式不正确' };
      return { ok: true, frame: { t: 'ping', ts: parsed.data.ts } };
    }
    case 'msg': {
      const parsed = msgFrame.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, code: 'invalid_msg', msg: 'msg 帧需要 convId / clientMsgId / content' };
      }
      return {
        ok: true,
        frame: {
          t: 'msg',
          convId: String(parsed.data.convId),
          clientMsgId: parsed.data.clientMsgId,
          type: parsed.data.type ?? 'TEXT',
          content: parsed.data.content
        }
      };
    }
    case 'ack': {
      const parsed = ackFrame.safeParse(payload);
      if (!parsed.success) return { ok: false, code: 'invalid_ack', msg: 'ack 帧需要 convId / seq' };
      return { ok: true, frame: { t: 'ack', convId: String(parsed.data.convId), seq: Number(parsed.data.seq) } };
    }
    case 'sync': {
      const parsed = syncFrame.safeParse(payload);
      if (!parsed.success) return { ok: false, code: 'invalid_sync', msg: 'sync 帧需要 convId' };
      return {
        ok: true,
        frame: {
          t: 'sync',
          convId: String(parsed.data.convId),
          lastSeq: Number(parsed.data.lastSeq ?? 0)
        }
      };
    }
    default:
      return { ok: false, code: 'unknown_frame', msg: `未知帧类型 ${String(type)}` };
  }
}

/** 服务端帧序列化：统一补上协议版本号，保证客户端能判断兼容性 */
export function encodeFrame(frame: ServerFrame): string {
  // 展开写在前面、v 写在后面：这样 TS 不会报「v 被重复指定且会被覆盖」，
  // 同时保证发出去的版本号永远等于服务端当前的 PROTOCOL_VERSION
  return JSON.stringify({ ...frame, v: PROTOCOL_VERSION });
}

export function authOkFrame(userId: string | number, deviceId: string): AuthOkFrame {
  return { v: PROTOCOL_VERSION, t: 'auth_ok', userId: String(userId), deviceId, serverTs: Date.now() };
}

export function pongFrame(clientTs: number | undefined): PongFrame {
  return { v: PROTOCOL_VERSION, t: 'pong', ts: clientTs ?? 0, serverTs: Date.now() };
}

export function ackOkFrame(clientMsgId: string, seq: number): AckOkFrame {
  return { v: PROTOCOL_VERSION, t: 'ack_ok', clientMsgId, seq };
}

export function errorFrame(code: string, msg: string): ErrorFrame {
  return { v: PROTOCOL_VERSION, t: 'error', code, msg };
}

export function notifyFrame(kind: string, convId: string | number, preview: string): NotifyFrame {
  return { v: PROTOCOL_VERSION, t: 'notify', kind, convId: String(convId), preview };
}

/**
 * 第 n 次重连的等待毫秒数（供客户端实现参考，服务端只导出常量）。
 * 台阶到顶后保持 30s，并叠加 ±20% 抖动：`backoffDelayMs(n, true)`。
 */
export function backoffDelayMs(attempt: number, jitter = false, jitterRatio = 0.2): number {
  const index = Math.min(Math.max(attempt, 1), RECONNECT_BACKOFF_SECONDS.length) - 1;
  const base = RECONNECT_BACKOFF_SECONDS[index] * 1000;
  if (!jitter) return base;
  const delta = base * jitterRatio * (Math.random() * 2 - 1);
  return Math.max(500, Math.round(base + delta));
}

/** 统一的事件日志格式，与项目既有 `JSON.stringify({event:...})` 风格一致，便于 grep/jq */
export function logEvent(event: string, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...payload }));
}
