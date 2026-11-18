import { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../db/connection.js';
import { ApiError } from '../api/core.js';

export async function listSince(conversationId: number, userId: number, sinceId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(m.id AS CHAR) AS message_id,
            CAST(m.conversation_id AS CHAR) AS conversation_id,
            CAST(m.sender_id AS CHAR) AS sender_id,
            m.client_msg_id, m.content_type, m.content, m.status, m.created_at
       FROM im_message m
       JOIN im_participant p ON p.conversation_id=m.conversation_id
      WHERE m.conversation_id=? AND p.user_id=? AND m.id>?
      ORDER BY m.id ASC LIMIT 200`,
    [conversationId, userId, sinceId]
  );
  return rows;
}

export async function send(
  conn: PoolConnection,
  conversationId: number,
  senderId: number,
  clientMsgId: string,
  content: string
) {
  const [conversations] = await conn.query<RowDataPacket[]>(
    `SELECT c.last_message_seq
       FROM im_conversation c
       JOIN im_participant p ON p.conversation_id=c.id
      WHERE c.id=? AND p.user_id=?
      FOR UPDATE`,
    [conversationId, senderId]
  );
  if (!conversations.length) throw new ApiError(404, 20016, '会话不存在或无权访问');

  const [existing] = await conn.query<RowDataPacket[]>(
    'SELECT id, conversation_id, seq, content_type, content, status, created_at FROM im_message WHERE sender_id=? AND client_msg_id=?',
    [senderId, clientMsgId]
  );
  if (existing.length) {
    if (Number(existing[0].conversation_id) !== conversationId) {
      throw new ApiError(409, 20015, 'client_msg_id 已用于其他会话');
    }
    return {
      message_id: String(existing[0].id),
      conversation_id: String(conversationId),
      sender_id: String(senderId),
      seq: Number(existing[0].seq),
      client_msg_id: clientMsgId,
      content_type: existing[0].content_type,
      content: existing[0].content,
      status: existing[0].status,
      created_at: existing[0].created_at
    };
  }

  const seq = Number(conversations[0].last_message_seq) + 1;
  const [result] = await conn.query<ResultSetHeader>(
    `INSERT INTO im_message (conversation_id,sender_id,seq,client_msg_id,content_type,content,status)
     VALUES (?, ?, ?, ?, 'TEXT', ?, 'SENT')`,
    [conversationId, senderId, seq, clientMsgId, content]
  );
  await conn.query(
    'UPDATE im_conversation SET last_message_seq=?, last_message_at=UTC_TIMESTAMP(3) WHERE id=?',
    [seq, conversationId]
  );
  await conn.query(
    'UPDATE im_participant SET last_read_seq=? WHERE conversation_id=? AND user_id=?',
    [seq, conversationId, senderId]
  );

  return {
    message_id: String(result.insertId),
    conversation_id: String(conversationId),
    sender_id: String(senderId),
    seq,
    client_msg_id: clientMsgId,
    content_type: 'TEXT',
    content,
    status: 'SENT',
    created_at: new Date()
  };
}
