import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket } from 'mysql2/promise';
import { authenticateJwt } from '../auth/passport.js';
import { requireAction } from '../auth/rbac.js';
import { pool } from '../db/connection.js';
import { ApiError, id, reply, run } from './core.js';
import { listSince, send } from '../im/messageService.js';

export const imRouter = Router();
imRouter.use(authenticateJwt);

const notImplemented = (): never => {
  throw new ApiError(501, 50001, '即时通讯接口尚未实现');
};

async function assertParticipant(conversationId: number, userId: number): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT role,last_read_seq FROM im_participant WHERE conversation_id=? AND user_id=?',
    [conversationId, userId]
  );
  if (!rows.length) throw new ApiError(404, 20016, '会话不存在或无权访问');
  return rows[0];
}

imRouter.get('/im/conversations', requireAction('im:session', 'query'), run(async (_req, _res) => {
  notImplemented();
}));

imRouter.post('/im/conversations', requireAction('im:conv', 'manage'), run(async (req, _res) => {
  z.object({
    title: z.string().trim().min(1).max(100).nullable().optional(),
    member_ids: z.array(id).max(200).optional()
  }).strict().parse(req.body);
  notImplemented();
}));

imRouter.post('/im/conversations/:id/participants', requireAction('im:conv', 'manage'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  z.object({ user_ids: z.array(id).min(1).max(200) }).strict().parse(req.body);
  const participant = await assertParticipant(conversationId, Number(res.locals.user.id));
  if (participant.role !== 'OWNER') throw new ApiError(403, 20013, '仅会话创建者可管理成员');
  notImplemented();
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
  await assertParticipant(Number(body.conversation_id), Number(res.locals.user.id));
  await send();
}));

imRouter.post('/im/messages/:id/read', requireAction('im:message', 'send'), run(async (req, res) => {
  const messageId = Number(id.parse(req.params.id));
  const [messages] = await pool.query<RowDataPacket[]>(
    'SELECT conversation_id FROM im_message WHERE id=?',
    [messageId]
  );
  if (!messages.length) throw new ApiError(404, 20016, '消息不存在');
  await assertParticipant(Number(messages[0].conversation_id), Number(res.locals.user.id));
  notImplemented();
}));

imRouter.get('/im/conversations/:id/unread', requireAction('im:message', 'query'), run(async (req, res) => {
  const conversationId = Number(id.parse(req.params.id));
  await assertParticipant(conversationId, Number(res.locals.user.id));
  notImplemented();
}));
