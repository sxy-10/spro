import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { chatRouter } from './routes/chatRouter.js';
import { itineraryRouter } from './routes/itineraryRouter.js';
import { adminRouter } from './routes/adminRouter.js';

dotenv.config();

const app = express();
const portNumber = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 注册核心路由
app.use('/api/chat', chatRouter);
app.use('/api/itinerary', itineraryRouter);
app.use('/api/admin', adminRouter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'Travel Planner Agent API',
    timestamp: new Date().toISOString()
  });
});

app.listen(portNumber, () => {
  console.log(`🚀 [Travel Agent Backend] 服务已启动，正在监听 http://localhost:${portNumber}`);
});
