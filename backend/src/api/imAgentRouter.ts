/**
 * 客服接待域接口（第 5 棒补漏）
 *
 * 解决 11_im.sql 遗留的四个空白（原交接文档 §四「缺口」）：
 *   1. 会话没有归属：谁接待、排多久、什么时候结束，全靠猜；
 *   2. 客服「接待中 / 小休」只能放 localStorage，换台机器就丢；
 *   3. GET /v1/im/conversations 固定 WHERE p.user_id=?，客服看不到待接入的池子；
 *   4. 没有话术表、没有满意度评价。
 *
 * 与 imRouter 的分工（刻意不合并，不碰第 4 棒已交付的路由）：
 *   imRouter       —— 面向「会话内的人」：拉历史、发消息、已读、成员管理；
 *   imAgentRouter  —— 面向「接待工作台」：队列、接入、转交、结束、状态、评价、话术。
 *   两条路由共用同一批表与同一套鉴权（authenticateJwt + requireAction）。
 *
 * 全项目唯一「待接入」口径（SQL、接口、前端、文档四处一致）：
 *   status = 'ACTIVE' AND assignee_id IS NULL
 *
 * 写操作一律走 core.write()：幂等键 + HMAC 签名 + 事务，与全项目其他写接口同款。
 */
import { Router } from 'express';
import { z } from 'zod';
import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { authenticateJwt } from '../auth/passport.js';
import { requireAction } from '../auth/rbac.js';
import { pool } from '../db/connection.js';
import { ApiError, id, page, reply, run, write } from './core.js';
import { onlineDevices } from '../im/presence.js';

export const imAgentRouter = Router();
imAgentRouter.use(authenticateJwt);

/** 待接入超过多少秒算「超 SLA」（前端红闪用的口径，服务端算好再下发，避免前后端时钟漂移） */
const SLA_SECONDS = Number(process.env.AGENT_SLA_SECONDS ?? 120);

/** 队列行：一处定义，待接入 / 我的接待 / 已结束 / 全部 四种视角复用 */
const QUEUE_SELECT = `
SELECT CAST(c.id AS CHAR) AS conversation_id,
       c.conversation_no,
       c.conversation_type,
       c.title,
       c.status,
       CAST(c.assignee_id AS CHAR) AS assignee_id,
       c.queued_at,
       c.assigned_at,
       c.closed_at,
       c.agent_note,
       c.last_message_seq,
       c.last_message_at,
       c.created_at,
       CAST((SELECT p.user_id
               FROM im_participant p
              WHERE p.conversation_id = c.id AND p.user_id <> ?
              ORDER BY (p.role = 'OWNER') DESC, p.joined_at ASC
              LIMIT 1) AS CHAR) AS counterpart_id,
       (SELECT COALESCE(NULLIF(u.nickname, ''), u.username)
          FROM im_participant p
          JOIN sys_user u ON u.id = p.user_id
         WHERE p.conversation_id = c.id AND p.user_id <> ?
         ORDER BY (p.role = 'OWNER') DESC, p.joined_at ASC
         LIMIT 1) AS counterpart_name,
       (SELECT u.phone
          FROM im_participant p
          JOIN sys_user u ON u.id = p.user_id
         WHERE p.conversation_id = c.id AND p.user_id <> ?
         ORDER BY (p.role = 'OWNER') DESC, p.joined_at ASC
         LIMIT 1) AS counterpart_phone,
       (SELECT COALESCE(NULLIF(au.nickname, ''), au.username)
          FROM sys_user au WHERE au.id = c.assignee_id) AS assignee_name,
       GREATEST(c.last_message_seq - COALESCE(mp.last_read_seq, 0), 0) AS unread_count,
       (SELECT LEFT(m.content, 80)
          FROM im_message m
         WHERE m.conversation_id = c.id AND m.status = 'SENT'
         ORDER BY m.seq DESC
         LIMIT 1) AS last_message_preview,
       CAST(TIMESTAMPDIFF(SECOND,
              COALESCE(c.queued_at, c.last_message_at, c.created_at),
              UTC_TIMESTAMP(3)) AS SIGNED) AS wait_seconds
  FROM im_conversation c
  LEFT JOIN im_participant mp ON mp.conversation_id = c.id AND mp.user_id = ?`;

type Conn = typeof pool | PoolConnection;

const meOf = (res: any): number => Number(res.locals.user?.id ?? 0);

/** 手机号脱敏（只在列表里露前 3 后 4，详情由客服点开会话再看） */
const maskPhone = (phone: unknown): string | null => {
  const text = phone == null ? '' : String(phone);
  return /^\d{11}$/.test(text) ? `${text.slice(0, 3)}****${text.slice(7)}` : text || null;
};

async function loadOf(conn: Conn, userId: number) {
  const [statusRows] = await conn.query<RowDataPacket[]>(
    'SELECT status, max_concurrent FROM im_agent_status WHERE user_id=?',
    [userId]
  );
  const [loadRows] = await conn.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS c FROM im_conversation WHERE assignee_id=? AND status='ACTIVE'",
    [userId]
  );
  return {
    status: String(statusRows[0]?.status ?? 'OFFLINE'),
    maxConcurrent: Number(statusRows[0]?.max_concurrent ?? 5),
    activeLoad: Number(loadRows[0]?.c ?? 0)
  };
}

/** 锁住一行会话（必须在事务里调用），返回归属信息 */
async function lockConversation(conn: Conn, conversationId: number): Promise<RowDataPacket> {
  const [rows] = await conn.query<RowDataPacket[]>(
    'SELECT id, status, assignee_id, last_message_seq FROM im_conversation WHERE id=? FOR UPDATE',
    [conversationId]
  );
  if (!rows.length) throw new ApiError(404, 20016, '会话不存在');
  return rows[0];
}

/**
 * 只有「当前接待人」或「无主会话」可以被操作。
 * 无主会话任何人（持有 im:agent:manage）都能结束/转交，用来清理脏数据；
 * 有主会话别人抢不动 —— 这是客服之间最基本的边界。
 */
function assertOperable(row: RowDataPacket, me: number): number | null {
  const assignee = row.assignee_id === null ? null : Number(row.assignee_id);
  if (assignee !== null && assignee !== me) {
    throw new ApiError(403, 20013, '该会话由其他客服接待，请让对方转交');
  }
  return assignee;
}

/* ==================================================================== *
 * 一、接入队列
 * ==================================================================== */

/**
 * GET /v1/im/agent/queue?scope=pool|mine|closed|all
 *
 * 与 imRouter 的 GET /im/conversations 的差别：那条按「我参与的会话」查，
 * 这条按「接待归属」查 —— 客服在接入之前根本不是会话参与者，
 * 用参与关系永远查不到待接入的池子，这正是原来的缺口。
 *
 * 排序口径（单坐席简化版）：默认按「最后一条消息时间」倒序 —— 最近有人说话的会话排最前。
 * page() 的通用默认是 -created_at（按会话创建时间），对接待队列不合适，这里显式改写。
 */
imAgentRouter.get('/im/agent/queue', requireAction('im:agent', 'query'), run(async (req, res) => {
  const me = meOf(res);
  const pagination = page(
    { ...(req.query as Record<string, unknown>), sort: (req.query as any).sort ?? '-last_message_at' },
    ['last_message_at', 'created_at', 'queued_at', 'assigned_at'],
    { scope: z.enum(['pool', 'mine', 'closed', 'all']).default('pool') }
  );
  const scope = String(pagination.scope);

  let where = "c.status='ACTIVE' AND c.assignee_id IS NULL";
  const whereParams: any[] = [];
  if (scope === 'mine') {
    where = "c.assignee_id=? AND c.status='ACTIVE'";
    whereParams.push(me);
  } else if (scope === 'closed') {
    where = "c.status='CLOSED'";
  } else if (scope === 'all') {
    where = '1=1';
  }

  // sort 已在 page() 里过了白名单，这里再加表别名限定，避免与 mp 的列重名
  const sortField = `c.${pagination.sort.replace(/^-/, '')}`;
  const direction = pagination.sort.startsWith('-') ? 'DESC' : 'ASC';
  const offset = (pagination.page - 1) * pagination.size;

  const [rows] = await pool.query<RowDataPacket[]>(
    `${QUEUE_SELECT} WHERE ${where} ORDER BY ${sortField} ${direction}, c.id DESC LIMIT ? OFFSET ?`,
    [me, me, me, me, ...whereParams, pagination.size, offset]
  );
  const [totals] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM im_conversation c WHERE ${where}`,
    whereParams
  );
  const total = Number(totals[0]?.total ?? 0);

  // 三个 tab 的角标一次带回，避免前端为拿个数字再打两次接口
  const [counterRows] = await pool.query<RowDataPacket[]>(
    `SELECT SUM(c.status='ACTIVE' AND c.assignee_id IS NULL) AS pool,
            SUM(c.assignee_id=? AND c.status='ACTIVE') AS mine,
            SUM(c.status='CLOSED') AS closed
       FROM im_conversation c`,
    [me]
  );
  const counters = counterRows[0] ?? {};

  reply(res, {
    scope,
    sla_seconds: SLA_SECONDS,
    counters: {
      pool: Number(counters.pool ?? 0),
      mine: Number(counters.mine ?? 0),
      closed: Number(counters.closed ?? 0)
    },
    list: rows.map((row) => {
      const waitSeconds = Number(row.wait_seconds ?? 0);
      return {
        ...row,
        counterpart_phone: maskPhone(row.counterpart_phone),
        unread_count: Number(row.unread_count ?? 0),
        wait_seconds: Math.max(waitSeconds, 0),
        // 单列表模式：不再依赖 scope 参数，按会话自身状态判断（仅「无人接待的进行中会话」算 SLA 超时）
        sla_breached: row.status === 'ACTIVE' && row.assignee_id == null && waitSeconds > SLA_SECONDS
      };
    }),
    total,
    has_more: pagination.page * pagination.size < total
  });
}));

/** POST /v1/im/agent/conversations/:id/claim —— 接入（抢单，乐观交给行锁） */
/**
 * POST /v1/im/agent/conversations/:id/claim —— 接入（抢单，乐观交给行锁）
 *
 * 单坐席口径：平台端 / 旅行社端各只有一个客服，不存在「接待上限」和「上线状态」，
 * 所以这里不再校验 max_concurrent，也不写 im_agent_status。
 * 行锁仍然保留 —— 抢单幂等与「已被别人接入」的提示还要靠它。
 */
imAgentRouter.post('/im/agent/conversations/:id/claim', requireAction('im:agent', 'manage'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  const me = meOf(res);

  await write(req, res, async (conn) => {
    const row = await lockConversation(conn, conversationId);
    if (row.status === 'CLOSED') throw new ApiError(409, 20016, '会话已结束，请先重新打开再接入');

    const currentAssignee = row.assignee_id === null ? null : Number(row.assignee_id);
    if (currentAssignee !== null && currentAssignee !== me) {
      throw new ApiError(409, 20016, '该会话已被接入');
    }
    if (currentAssignee === me) {
      return {
        status: 200,
        data: { conversation_id: String(conversationId), assignee_id: String(me), claimed: false }
      };
    }

    await conn.query(
      'UPDATE im_conversation SET assignee_id=?, status=?, assigned_at=UTC_TIMESTAMP(3), queued_at=NULL WHERE id=?',
      [me, 'ACTIVE', conversationId]
    );
    // 接入即成为会话参与者：之后这个会话的 msg/notify 帧才会经 WS 推给我（第 4 棒 hub 按 participant 投递）
    await conn.query(
      "INSERT IGNORE INTO im_participant (conversation_id,user_id,role,last_read_seq) VALUES (?,?,'MEMBER',0)",
      [conversationId, me]
    );

    return {
      status: 200,
      data: { conversation_id: String(conversationId), assignee_id: String(me), claimed: true }
    };
  });
}));

/** POST /v1/im/agent/conversations/:id/release —— 放回待接入池（接了但处理不了） */
imAgentRouter.post('/im/agent/conversations/:id/release', requireAction('im:agent', 'manage'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  const me = meOf(res);

  await write(req, res, async (conn) => {
    const row = await lockConversation(conn, conversationId);
    assertOperable(row, me);
    await conn.query(
      'UPDATE im_conversation SET assignee_id=NULL, status=?, queued_at=UTC_TIMESTAMP(3), assigned_at=NULL WHERE id=?',
      ['ACTIVE', conversationId]
    );
    return { status: 200, data: { conversation_id: String(conversationId), assignee_id: null, status: 'ACTIVE' } };
  });
}));

/** POST /v1/im/agent/conversations/:id/transfer —— 转交给另一位在线且未满负荷的客服 */
imAgentRouter.post('/im/agent/conversations/:id/transfer', requireAction('im:agent', 'manage'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  const me = meOf(res);
  const body = z.object({ assignee_id: id }).strict().parse(req.body);
  const targetId = Number(body.assignee_id);

  await write(req, res, async (conn) => {
    const row = await lockConversation(conn, conversationId);
    if (row.status === 'CLOSED') throw new ApiError(409, 20016, '会话已结束，无法转交');
    assertOperable(row, me);
    if (targetId === me) throw new ApiError(409, 20016, '不能转交给自己');

    const [targets] = await conn.query<RowDataPacket[]>(
      `SELECT s.status, s.max_concurrent,
              (SELECT COUNT(*) FROM im_conversation c WHERE c.assignee_id=s.user_id AND c.status='ACTIVE') AS active_load,
              u.status AS user_status,
              COALESCE(NULLIF(u.nickname, ''), u.username) AS name
         FROM im_agent_status s
         JOIN sys_user u ON u.id = s.user_id
        WHERE s.user_id = ?`,
      [targetId]
    );
    if (!targets.length || targets[0].user_status !== 'ACTIVE') {
      throw new ApiError(404, 20016, '目标客服不存在或账号已停用');
    }
    if (targets[0].status !== 'ONLINE') throw new ApiError(409, 20016, '目标客服当前不在接待中（小休或离线）');
    if (Number(targets[0].active_load) >= Number(targets[0].max_concurrent)) {
      throw new ApiError(409, 20016, '目标客服已达接待上限');
    }

    await conn.query(
      'UPDATE im_conversation SET assignee_id=?, assigned_at=UTC_TIMESTAMP(3), queued_at=NULL WHERE id=?',
      [targetId, conversationId]
    );
    await conn.query(
      "INSERT IGNORE INTO im_participant (conversation_id,user_id,role,last_read_seq) VALUES (?,?,'MEMBER',0)",
      [conversationId, targetId]
    );
    // 原接待人保留参与者身份（还能回看会话），只是不再计入接待量
    return {
      status: 200,
      data: {
        conversation_id: String(conversationId),
        from_assignee_id: String(me),
        assignee_id: String(targetId),
        assignee_name: targets[0].name
      }
    };
  });
}));

/** POST /v1/im/agent/conversations/:id/close —— 结束会话（结单备注落 agent_note） */
imAgentRouter.post('/im/agent/conversations/:id/close', requireAction('im:agent', 'manage'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  const me = meOf(res);
  const body = z.object({ note: z.string().trim().max(255).optional() }).strict().parse(req.body ?? {});

  await write(req, res, async (conn) => {
    const row = await lockConversation(conn, conversationId);
    assertOperable(row, me);
    await conn.query(
      "UPDATE im_conversation SET status='CLOSED', closed_at=UTC_TIMESTAMP(3), agent_note=? WHERE id=?",
      [body.note ?? null, conversationId]
    );
    return {
      status: 200,
      data: { conversation_id: String(conversationId), status: 'CLOSED', agent_note: body.note ?? null }
    };
  });
}));

/** POST /v1/im/agent/conversations/:id/reopen —— 重新打开（客户又回来了） */
imAgentRouter.post('/im/agent/conversations/:id/reopen', requireAction('im:agent', 'manage'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  const me = meOf(res);

  await write(req, res, async (conn) => {
    const row = await lockConversation(conn, conversationId);
    if (row.status === 'ACTIVE') {
      return { status: 200, data: { conversation_id: String(conversationId), status: 'ACTIVE', reopened: false } };
    }
    const assignee = row.assignee_id === null ? me : Number(row.assignee_id);
    await conn.query(
      "UPDATE im_conversation SET status='ACTIVE', closed_at=NULL, assignee_id=?, queued_at=NULL, assigned_at=UTC_TIMESTAMP(3) WHERE id=?",
      [assignee, conversationId]
    );
    return {
      status: 200,
      data: { conversation_id: String(conversationId), status: 'ACTIVE', reopened: true, assignee_id: String(assignee) }
    };
  });
}));

/**
 * POST /v1/im/agent/auto-assign —— 把池子里等最久的会话分给最闲的在线客服
 *
 * 分配口径（答辩可讲）：
 *   1. 只考虑 im_agent_status.status='ONLINE' 且账号 ACTIVE 的客服；
 *   2. 每人已接待数 < max_concurrent 才有名额（负载均衡，避免一个人堆 20 个会话）；
 *   3. 会话按「进入队列时间」升序，先到先服务（FIFO），不搞插队；
 *   4. 每分一个就更新内存里的负载计数，保证同一批里不会全压给同一个人。
 * 整个过程在一个事务里完成，中途失败不会出现「分了一半」的脏状态。
 */
imAgentRouter.post('/im/agent/auto-assign', requireAction('im:agent', 'manage'), run(async (req, res) => {
  const body = z.object({ limit: z.number().int().min(1).max(20).default(5) }).strict().parse(req.body ?? {});

  await write(req, res, async (conn) => {
    const [agents] = await conn.query<RowDataPacket[]>(
      `SELECT s.user_id, s.max_concurrent,
              (SELECT COUNT(*) FROM im_conversation c WHERE c.assignee_id=s.user_id AND c.status='ACTIVE') AS active_load
         FROM im_agent_status s
         JOIN sys_user u ON u.id = s.user_id
        WHERE s.status='ONLINE' AND u.status='ACTIVE'
        ORDER BY active_load ASC, s.user_id ASC`
    );
    const slots = agents
      .map((agent) => ({
        userId: Number(agent.user_id),
        maxConcurrent: Number(agent.max_concurrent),
        activeLoad: Number(agent.active_load)
      }))
      .filter((agent) => agent.activeLoad < agent.maxConcurrent);

    if (!slots.length) {
      return { status: 200, data: { assigned: [], reason: '当前没有空闲的在线客服' } };
    }

    const [queue] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM im_conversation
        WHERE status='ACTIVE' AND assignee_id IS NULL
        ORDER BY COALESCE(queued_at, last_message_at, created_at) ASC
        LIMIT ?`,
      [body.limit]
    );
    if (!queue.length) {
      return { status: 200, data: { assigned: [], reason: '待接入队列为空' } };
    }

    const assigned: { conversation_id: string; assignee_id: string }[] = [];
    for (const row of queue) {
      slots.sort((a, b) => a.activeLoad - b.activeLoad || a.userId - b.userId);
      const target = slots.find((slot) => slot.activeLoad < slot.maxConcurrent);
      if (!target) break;
      const conversationId = Number(row.id);
      await conn.query(
        'UPDATE im_conversation SET assignee_id=?, status=?, assigned_at=UTC_TIMESTAMP(3), queued_at=NULL WHERE id=?',
        [target.userId, 'ACTIVE', conversationId]
      );
      await conn.query(
        "INSERT IGNORE INTO im_participant (conversation_id,user_id,role,last_read_seq) VALUES (?,?,'MEMBER',0)",
        [conversationId, target.userId]
      );
      target.activeLoad += 1;
      assigned.push({ conversation_id: String(conversationId), assignee_id: String(target.userId) });
    }

    return {
      status: 200,
      data: { assigned, remaining_in_queue: queue.length - assigned.length }
    };
  });
}));

/* ==================================================================== *
 * 二、客服接待状态（落库，不再依赖 localStorage）
 * ==================================================================== */

imAgentRouter.get('/im/agent/status', requireAction('im:agent', 'query'), run(async (req, res) => {
  const me = meOf(res);
  const snapshot = await loadOf(pool, me);
  const devices = await onlineDevices(me);
  reply(res, {
    user_id: String(me),
    status: snapshot.status,
    max_concurrent: snapshot.maxConcurrent,
    active_load: snapshot.activeLoad,
    available: snapshot.status === 'ONLINE' && snapshot.activeLoad < snapshot.maxConcurrent,
    ws_online: Boolean(devices),
    device_count: devices ? Object.keys(devices).length : 0
  });
}));

imAgentRouter.put('/im/agent/status', requireAction('im:agent', 'manage'), run(async (req, res) => {
  const me = meOf(res);
  const body = z.object({
    status: z.enum(['ONLINE', 'AWAY', 'OFFLINE']),
    max_concurrent: z.number().int().min(1).max(20).optional()
  }).strict().parse(req.body);

  await write(req, res, async (conn) => {
    const current = await loadOf(conn, me);
    const maxConcurrent = body.max_concurrent ?? current.maxConcurrent;
    if (body.status === 'ONLINE' && body.max_concurrent !== undefined && body.max_concurrent < current.activeLoad) {
      throw new ApiError(409, 20016, `上限不能低于当前接待数（已接 ${current.activeLoad} 个）`);
    }
    await conn.query(
      `INSERT INTO im_agent_status (user_id,status,max_concurrent,last_heartbeat_at)
       VALUES (?,?,?,UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE status=VALUES(status), max_concurrent=VALUES(max_concurrent),
                               last_heartbeat_at=UTC_TIMESTAMP(3)`,
      [me, body.status, maxConcurrent]
    );
    return {
      status: 200,
      data: {
        user_id: String(me),
        status: body.status,
        max_concurrent: maxConcurrent,
        active_load: current.activeLoad,
        available: body.status === 'ONLINE' && current.activeLoad < maxConcurrent
      }
    };
  });
}));

/** 可转交的客服候选：库里 ONLINE 且未满负荷（前端转交下拉框直接用这个） */
imAgentRouter.get('/im/agent/candidates', requireAction('im:agent', 'query'), run(async (_req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(s.user_id AS CHAR) AS user_id,
            COALESCE(NULLIF(u.nickname, ''), u.username) AS name,
            s.status, s.max_concurrent,
            (SELECT COUNT(*) FROM im_conversation c WHERE c.assignee_id=s.user_id AND c.status='ACTIVE') AS active_load
       FROM im_agent_status s
       JOIN sys_user u ON u.id = s.user_id
      WHERE s.status='ONLINE' AND u.status='ACTIVE'
      ORDER BY active_load ASC, s.user_id ASC`
  );
  reply(res, rows.map((row) => ({
    ...row,
    max_concurrent: Number(row.max_concurrent),
    active_load: Number(row.active_load),
    available: Number(row.active_load) < Number(row.max_concurrent)
  })));
}));

/* ==================================================================== *
 * 三、在线状态（补上「逐用户在线查询」这个缺口）
 *
 *    数据来源刻意分成两层，答辩时说清楚：
 *      Redis im:online:{userId}  → 连接是否活着（TTL 60s，进程挂了会自然消失）
 *      im_agent_status.status    → 人为选择的接待意愿（ONLINE / AWAY / OFFLINE）
 *    online=true 只代表「客户端连上了」，不代表「在接单」。
 * ==================================================================== */

async function presenceOf(userIds: number[]) {
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => '?').join(',');
  const [agents] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(s.user_id AS CHAR) AS user_id, s.status, s.max_concurrent, s.last_heartbeat_at,
            (SELECT COUNT(*) FROM im_conversation c WHERE c.assignee_id=s.user_id AND c.status='ACTIVE') AS active_load
       FROM im_agent_status s
      WHERE s.user_id IN (${placeholders})`,
    userIds
  );
  const byId = new Map(agents.map((agent) => [Number(agent.user_id), agent]));

  return Promise.all(userIds.map(async (userId) => {
    const devices = await onlineDevices(userId);
    const agent = byId.get(userId);
    const lastSeen = devices
      ? Math.max(...Object.values(devices).map((value) => Number(value)))
      : null;
    return {
      user_id: String(userId),
      online: Boolean(devices),
      device_count: devices ? Object.keys(devices).length : 0,
      last_seen_at: lastSeen ? new Date(lastSeen).toISOString() : null,
      agent_status: agent ? String(agent.status) : 'UNKNOWN',
      max_concurrent: agent ? Number(agent.max_concurrent) : null,
      active_load: agent ? Number(agent.active_load) : 0
    };
  }));
}

/** GET /v1/im/presence?user_ids=1,2,3 —— 批量（列表页一次问清，不逐个打） */
imAgentRouter.get('/im/presence', requireAction('im:agent', 'query'), run(async (req, res) => {
  const query = z.object({ user_ids: z.string().min(1).max(600) }).strict().parse(req.query);
  const userIds = [...new Set(
    query.user_ids.split(',').map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
  )].slice(0, 50);
  reply(res, { items: await presenceOf(userIds) });
}));

/** GET /v1/im/presence/:userId —— 单个（打开某个会话时查对方在不在线） */
imAgentRouter.get('/im/presence/:userId', requireAction('im:agent', 'query'), run(async (req, res) => {
  const userId = Number(id.parse(req.params.userId));
  const [row] = await presenceOf([userId]);
  reply(res, row ?? { user_id: String(userId), online: false, agent_status: 'UNKNOWN' });
}));

/* ==================================================================== *
 * 四、快捷话术
 * ==================================================================== */

imAgentRouter.get('/im/quick-replies', requireAction('im:quick_reply', 'query'), run(async (req, res) => {
  const me = meOf(res);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) AS id, CAST(owner_id AS CHAR) AS owner_id, category, content, sort,
            (owner_id IS NULL) AS is_shared
       FROM im_quick_reply
      WHERE enabled=1 AND (owner_id IS NULL OR owner_id=?)
      ORDER BY (owner_id IS NULL) ASC, category ASC, sort ASC, id ASC`,
    [me]
  );
  reply(res, rows.map((row) => ({ ...row, is_shared: Boolean(row.is_shared), sort: Number(row.sort) })));
}));

imAgentRouter.post('/im/quick-replies', requireAction('im:quick_reply', 'manage'), run(async (req, res) => {
  const me = meOf(res);
  const body = z.object({
    content: z.string().trim().min(1).max(500),
    category: z.string().trim().min(1).max(32).default('通用'),
    sort: z.number().int().min(0).max(9999).default(0)
  }).strict().parse(req.body);

  await write(req, res, async (conn) => {
    const [result] = await conn.query<ResultSetHeader>(
      'INSERT INTO im_quick_reply (owner_id,category,content,sort) VALUES (?,?,?,?)',
      [me, body.category, body.content, body.sort]
    );
    return {
      status: 201,
      data: {
        id: String(result.insertId),
        owner_id: String(me),
        category: body.category,
        content: body.content,
        sort: body.sort,
        is_shared: false
      }
    };
  });
}));

/** 只允许删自己的话术：公共话术删了会影响所有人，这类改动留给运营脚本 */
imAgentRouter.delete('/im/quick-replies/:id', requireAction('im:quick_reply', 'manage'), run(async (req, res) => {
  const replyId = Number(id.parse(req.params.id));
  const me = meOf(res);

  await write(req, res, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT owner_id FROM im_quick_reply WHERE id=?',
      [replyId]
    );
    if (!rows.length) throw new ApiError(404, 20016, '话术不存在');
    if (rows[0].owner_id === null) throw new ApiError(403, 20013, '公共话术不允许删除');
    if (Number(rows[0].owner_id) !== me) throw new ApiError(403, 20013, '只能删除自己的话术');
    await conn.query('DELETE FROM im_quick_reply WHERE id=?', [replyId]);
    return { status: 200, data: { id: String(replyId), deleted: true } };
  });
}));

/* ==================================================================== *
 * 五、满意度评价
 * ==================================================================== */

/** POST /v1/im/conversations/:id/rating —— 游客/客户给这次接待打分（会话结束前后都可评，一次为限） */
imAgentRouter.post('/im/conversations/:id/rating', requireAction('im:rating', 'add'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  const me = meOf(res);
  const body = z.object({
    score: z.number().int().min(1).max(5),
    comment: z.string().trim().max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(20)).max(6).optional()
  }).strict().parse(req.body);

  await write(req, res, async (conn) => {
    const [participants] = await conn.query<RowDataPacket[]>(
      'SELECT p.role, c.assignee_id FROM im_participant p JOIN im_conversation c ON c.id=p.conversation_id WHERE p.conversation_id=? AND p.user_id=?',
      [conversationId, me]
    );
    if (!participants.length) throw new ApiError(404, 20016, '会话不存在或无权评价');

    const [existing] = await conn.query<RowDataPacket[]>(
      'SELECT id FROM im_rating WHERE conversation_id=? AND rater_id=?',
      [conversationId, me]
    );
    if (existing.length) throw new ApiError(409, 20015, '这次会话你已经评价过了');

    const agentId = participants[0].assignee_id === null ? null : Number(participants[0].assignee_id);
    const [result] = await conn.query<ResultSetHeader>(
      'INSERT INTO im_rating (conversation_id,rater_id,agent_id,score,comment,tags) VALUES (?,?,?,?,?,?)',
      [conversationId, me, agentId, body.score, body.comment ?? null, body.tags ? JSON.stringify(body.tags) : null]
    );
    return {
      status: 201,
      data: {
        id: String(result.insertId),
        conversation_id: String(conversationId),
        agent_id: agentId === null ? null : String(agentId),
        score: body.score,
        comment: body.comment ?? null,
        tags: body.tags ?? []
      }
    };
  });
}));

/** GET /v1/im/agent/ratings?agent_id= —— 客服评分汇总（默认看自己） */
imAgentRouter.get('/im/agent/ratings', requireAction('im:rating', 'query'), run(async (req, res) => {
  const me = meOf(res);
  const query = z.object({ agent_id: id.optional() }).strict().parse(req.query);
  const agentId = query.agent_id ? Number(query.agent_id) : me;

  const [summary] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            ROUND(AVG(score), 2) AS avg_score,
            SUM(score = 5) AS s5, SUM(score = 4) AS s4, SUM(score = 3) AS s3,
            SUM(score = 2) AS s2, SUM(score = 1) AS s1
       FROM im_rating WHERE agent_id = ?`,
    [agentId]
  );
  const [recent] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(r.id AS CHAR) AS id, CAST(r.conversation_id AS CHAR) AS conversation_id,
            r.score, r.comment, r.tags, r.created_at,
            COALESCE(NULLIF(u.nickname, ''), u.username) AS rater_name
       FROM im_rating r
       JOIN sys_user u ON u.id = r.rater_id
      WHERE r.agent_id = ?
      ORDER BY r.created_at DESC
      LIMIT 10`,
    [agentId]
  );

  const row = summary[0] ?? {};
  reply(res, {
    agent_id: String(agentId),
    total: Number(row.total ?? 0),
    avg_score: row.avg_score === null || row.avg_score === undefined ? null : Number(row.avg_score),
    distribution: {
      '5': Number(row.s5 ?? 0), '4': Number(row.s4 ?? 0), '3': Number(row.s3 ?? 0),
      '2': Number(row.s2 ?? 0), '1': Number(row.s1 ?? 0)
    },
    recent
  });
}));
