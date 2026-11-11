import { Router } from 'express';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { requirePermission } from '../auth/rbac.js';
import { pool } from '../db/connection.js';
import { ApiError, id, list, page, reply, run, write } from './core.js';

export const chatRouter = Router();

const messageInput = z.object({ content: z.string().trim().min(1).max(2000) }).strict();

chatRouter.get('/sessions', requirePermission('chat:session:query'), run(async (req, res) => {
  const pagination = page(req.query, ['last_active_at', 'created_at']);
  const where = 'FROM chat_session WHERE user_id = ? AND status = \'ACTIVE\'';
  reply(res, await list(
    pool,
    `SELECT CAST(id AS CHAR) AS session_id, title, status, message_count, last_active_at, created_at ${where}`,
    `SELECT COUNT(*) AS total ${where}`,
    [res.locals.user.id],
    pagination
  ));
}));

chatRouter.get('/sessions/:id/messages', requirePermission('chat:message:query'), run(async (req, res) => {
  const sessionId = id.parse(req.params.id);
  const [sessions] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM chat_session WHERE id = ? AND user_id = ?',
    [sessionId, res.locals.user.id]
  );
  if (!sessions.length) throw new ApiError(404, 20016, '会话不存在');

  const pagination = page(req.query, ['created_at']);
  const where = 'FROM chat_message WHERE session_id = ?';
  reply(res, await list(
    pool,
    `SELECT CAST(id AS CHAR) AS message_id, sender, content, itinerary_id, created_at ${where}`,
    `SELECT COUNT(*) AS total ${where}`,
    [sessionId],
    pagination
  ));
}));

chatRouter.post('/sessions', requirePermission('chat:message:add'), run(async (req, res) => {
  const { content } = messageInput.parse(req.body);
  await write(req, res, async (conn) => {
    const [session] = await conn.query<ResultSetHeader>(
      `INSERT INTO chat_session (user_id, title, message_count, last_active_at)
       VALUES (?, ?, 1, UTC_TIMESTAMP())`,
      [res.locals.user.id, content.slice(0, 100)]
    );
    const sessionId = session.insertId;
    const [message] = await conn.query<ResultSetHeader>(
      `INSERT INTO chat_message (session_id, sender, content)
       VALUES (?, 'USER', ?)`,
      [sessionId, content]
    );
    return {
      data: {
        session_id: String(sessionId),
        message_id: String(message.insertId),
        sender: 'USER',
        content
      },
      status: 201
    };
  });
}));
