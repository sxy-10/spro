import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { authenticateJwt } from '../auth/passport.js';
import { requireAction } from '../auth/rbac.js';
import { pool } from '../db/connection.js';
import { ApiError, id, list, page, reply, run, write } from './core.js';
import { listSince, send } from '../im/messageService.js';

export const imRouter = Router();
imRouter.use(authenticateJwt);

async function assertParticipant(conversationId: number, userId: number): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT role,last_read_seq FROM im_participant WHERE conversation_id=? AND user_id=?',
    [conversationId, userId]
  );
  if (!rows.length) throw new ApiError(404, 20016, '会话不存在或无权访问');
  return rows[0];
}

imRouter.get('/im/conversations', requireAction('im:session', 'query'), run(async (req, res) => {
  const pagination = page(req.query, ['last_message_at', 'created_at']);
  const userId = Number(res.locals.user.id);
  const where = 'FROM im_conversation c JOIN im_participant p ON p.conversation_id=c.id WHERE p.user_id=?';
  reply(res, await list(
    pool,
    `SELECT CAST(c.id AS CHAR) AS conversation_id,c.conversation_no,c.conversation_type,c.title,
            c.last_message_seq,c.last_message_at,c.created_by,c.created_at,c.updated_at
       ${where}`,
    `SELECT COUNT(*) AS total ${where}`,
    [userId],
    pagination,
    { tieBreaker: 'c.id' }
  ));
}));

imRouter.post('/im/conversations', requireAction('im:conv', 'manage'), run(async (req, res) => {
  const body = z.object({
    title: z.string().trim().min(1).max(100).nullable().optional(),
    member_ids: z.array(id).max(200).optional()
  }).strict().parse(req.body);
  await write(req, res, async (conn) => {
    const ownerId = Number(res.locals.user.id);
    const memberIds = [...new Set((body.member_ids ?? []).map(Number).filter((value) => value !== ownerId))];
    if (memberIds.length) {
      const placeholders = memberIds.map(() => '?').join(',');
      const [users] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM sys_user WHERE id IN (${placeholders}) AND status='ACTIVE'`,
        memberIds
      );
      if (users.length !== memberIds.length) throw new ApiError(404, 20016, '部分会话成员不存在或已停用');
    }

    const conversationType = memberIds.length > 1 ? 'GROUP' : 'DIRECT';
    const conversationNo = `IM${randomUUID().replace(/-/g, '').slice(0, 30)}`;
    const [created] = await conn.query<ResultSetHeader>(
      `INSERT INTO im_conversation (conversation_no,conversation_type,title,created_by)
       VALUES (?, ?, ?, ?)`,
      [conversationNo, conversationType, body.title ?? null, ownerId]
    );
    const conversationId = created.insertId;
    await conn.query(
      `INSERT INTO im_participant (conversation_id,user_id,role,last_read_seq)
       VALUES (?, ?, 'OWNER', 0)`,
      [conversationId, ownerId]
    );
    for (const memberId of memberIds) {
      await conn.query(
        `INSERT IGNORE INTO im_participant (conversation_id,user_id,role,last_read_seq)
         VALUES (?, ?, 'MEMBER', 0)`,
        [conversationId, memberId]
      );
    }
    return {
      status: 201,
      data: {
        conversation_id: String(conversationId),
        conversation_no: conversationNo,
        conversation_type: conversationType,
        title: body.title ?? null,
        created_by: String(ownerId),
        member_ids: [String(ownerId), ...memberIds.map(String)]
      }
    };
  });
}));

/** GET /v1/im/poll?convId=1&since=0 —— 长轮询/降级轮询接口（第 4 棒客户端降级兜底） */
imRouter.get('/im/poll', requireAction('im:message', 'query'), run(async (req, res) => {
  const convId = Number(id.parse(req.query.convId));
  const since = Number(req.query.since ?? 0);
  const userId = Number(res.locals.user.id);
  await assertParticipant(convId, userId);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(m.id AS CHAR) AS message_id,
            CAST(m.conversation_id AS CHAR) AS conversation_id,
            CAST(m.sender_id AS CHAR) AS sender_id,
            m.seq,
            m.client_msg_id, m.content_type, m.content, m.status, m.created_at
       FROM im_message m
      WHERE m.conversation_id = ? AND m.seq > ?
      ORDER BY m.seq ASC LIMIT 100`,
    [convId, since]
  );
  reply(res, rows);
}));

imRouter.post('/im/conversations/:id/participants', requireAction('im:conv', 'manage'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  const body = z.object({ user_ids: z.array(id).min(1).max(200) }).strict().parse(req.body);
  await write(req, res, async (conn) => {
    const [participants] = await conn.query<RowDataPacket[]>(
      'SELECT role FROM im_participant WHERE conversation_id=? AND user_id=?',
      [conversationId, Number(res.locals.user.id)]
    );
    if (!participants.length) throw new ApiError(404, 20016, '会话不存在或无权访问');
    if (participants[0].role !== 'OWNER') throw new ApiError(403, 20013, '仅会话创建者可管理成员');

    const userIds = [...new Set(body.user_ids.map(Number))];
    const placeholders = userIds.map(() => '?').join(',');
    const [users] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM sys_user WHERE id IN (${placeholders}) AND status='ACTIVE'`,
      userIds
    );
    if (users.length !== userIds.length) throw new ApiError(404, 20016, '部分用户不存在或已停用');
    await conn.query(
      `INSERT IGNORE INTO im_participant (conversation_id,user_id,role,last_read_seq)
       VALUES ${userIds.map(() => '(?, ?, \'MEMBER\', 0)').join(',')}`,
      userIds.flatMap((userId) => [conversationId, userId])
    );
    await conn.query('UPDATE im_conversation SET conversation_type=? WHERE id=?',
      ['GROUP', conversationId]);
    return {
      status: 201,
      data: { conversation_id: String(conversationId), added_user_ids: userIds.map(String) }
    };
  });
}));

imRouter.get('/im/conversations/:id/messages', requireAction('im:message', 'query'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  const query = z.object({ since_id: z.coerce.number().int().min(0).default(0) }).strict().parse(req.query);
  await assertParticipant(conversationId, Number(res.locals.user.id));
  reply(res, await listSince(conversationId, Number(res.locals.user.id), query.since_id));
}));

imRouter.post('/im/messages', requireAction('im:message', 'send'), run(async (req, res) => {
  const body = z.object({
    conversation_id: id,
    client_msg_id: z.string().trim().min(8).max(64),
    content: z.string().trim().min(1).max(5000)
  }).strict().parse(req.body);
  await write(req, res, async (conn) => {
    const message = await send(
      conn,
      Number(body.conversation_id),
      Number(res.locals.user.id),
      body.client_msg_id,
      body.content
    );
    return { status: 201, data: message };
  });
}));

imRouter.post('/im/messages/:id/read', requireAction('im:message', 'send'), run(async (req, res) => {
  const messageId = Number(id.parse(req.params.id));
  await write(req, res, async (conn) => {
    const [messages] = await conn.query<RowDataPacket[]>(
      'SELECT conversation_id,seq FROM im_message WHERE id=?',
      [messageId]
    );
    if (!messages.length) throw new ApiError(404, 20016, '消息不存在');
    const conversationId = Number(messages[0].conversation_id);
    const seq = Number(messages[0].seq);
    const [participants] = await conn.query<RowDataPacket[]>(
      'SELECT last_read_seq FROM im_participant WHERE conversation_id=? AND user_id=?',
      [conversationId, Number(res.locals.user.id)]
    );
    if (!participants.length) throw new ApiError(404, 20016, '会话不存在或无权访问');
    await conn.query(
      `UPDATE im_participant SET last_read_seq=GREATEST(last_read_seq,?)
       WHERE conversation_id=? AND user_id=?`,
      [seq, conversationId, Number(res.locals.user.id)]
    );
    await conn.query(
      `INSERT INTO im_read_cursor (conversation_id,user_id,last_read_seq,last_read_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE last_read_seq=GREATEST(last_read_seq,VALUES(last_read_seq)),last_read_at=UTC_TIMESTAMP(3)`,
      [conversationId, Number(res.locals.user.id), seq]
    );
    return {
      status: 200,
      data: {
        conversation_id: String(conversationId),
        message_id: String(messageId),
        last_read_seq: String(seq)
      }
    };
  });
}));

imRouter.get('/im/conversations/:id/unread', requireAction('im:message', 'query'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  const participant = await assertParticipant(conversationId, Number(res.locals.user.id));
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS unread_count FROM im_message WHERE conversation_id=? AND seq>? AND status=\'SENT\'',
    [conversationId, Number(participant.last_read_seq)]
  );
  reply(res, {
    conversation_id: String(conversationId),
    unread_count: Number(rows[0].unread_count),
    last_read_seq: String(participant.last_read_seq)
  });
}));
