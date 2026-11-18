import { RowDataPacket } from 'mysql2/promise';
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

export async function send(): Promise<never> {
  throw new ApiError(501, 50001, '即时消息发送功能尚未实现');
}
