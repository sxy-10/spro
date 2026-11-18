import { Router } from 'express';
import { authenticateJwt } from '../auth/passport.js';
import { requireAction } from '../auth/rbac.js';
import { pool } from '../db/connection.js';
import { run } from './core.js';
import { RowDataPacket } from 'mysql2/promise';

export const statsRouter = Router();
statsRouter.use(authenticateJwt);

statsRouter.get('/stats/live', requireAction('analytics:live', 'query'), run(async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendStats = async () => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT
          (SELECT COUNT(DISTINCT s.user_id)
             FROM api_session s
            WHERE s.is_revoked=0 AND s.expires_at>UTC_TIMESTAMP()) AS online_count,
          (SELECT COUNT(*)
             FROM tour_order o
            WHERE DATE(o.created_at)=UTC_DATE()) AS today_order_count,
          (SELECT COUNT(*)
             FROM im_message m
            WHERE DATE(m.created_at)=UTC_DATE()) AS message_count
      `);
      res.write('event: stats\n');
      res.write(`data: ${JSON.stringify({
        online_count: Number(rows[0].online_count),
        today_order_count: Number(rows[0].today_order_count),
        message_count: Number(rows[0].message_count)
      })}\n\n`);
    } catch (error) {
      console.error('[stats/live] 聚合查询失败', error);
    }
  };
  void sendStats();
  const timer = setInterval(() => void sendStats(), 5000);
  req.on('close', () => clearInterval(timer));
}));
