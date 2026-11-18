import { Router } from 'express';
import { authenticateJwt } from '../auth/passport.js';
import { requireAction } from '../auth/rbac.js';
import { run } from './core.js';

export const statsRouter = Router();
statsRouter.use(authenticateJwt);

statsRouter.get('/stats/live', requireAction('analytics:live', 'query'), run(async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendPlaceholder = () => {
    res.write('event: stats\n');
    res.write(`data: ${JSON.stringify({ online_count: 0, today_order_count: 0, message_count: 0 })}\n\n`);
  };
  sendPlaceholder();
  const timer = setInterval(sendPlaceholder, 5000);
  req.on('close', () => clearInterval(timer));
}));
