import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { chatRouter } from './routes/chatRouter.js';
import { itineraryRouter } from './routes/itineraryRouter.js';
import { adminRouter } from './routes/adminRouter.js';
import { checkDatabaseConnection } from './db/connection.js';

dotenv.config();

const app = express();
const portNumber = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 注册核心路由
app.use('/api/chat', chatRouter);
app.use('/api/itinerary', itineraryRouter);
app.use('/api/admin', adminRouter);

app.get('/health', async (_req, res) => {
  const isDbConnected = await checkDatabaseConnection();
  res.json({
    status: isDbConnected ? 'healthy' : 'degraded',
    service: 'Travel Planner Agent API',
    database: isDbConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

app.listen(portNumber, async () => {
  console.log(` [Travel Agent Backend] 服务已启动，正在监听 http://localhost:${portNumber}`);
  await checkDatabaseConnection();
});
