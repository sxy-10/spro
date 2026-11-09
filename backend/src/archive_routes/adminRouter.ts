import { Router, Request, Response } from 'express';
import {
  getProductsFromDb,
  insertProductToDb,
  getAnalyticsFromDb
} from '../db/repository.js';
import { pool } from '../db/connection.js';
import { RowDataPacket } from 'mysql2/promise';

export const adminRouter = Router();

/**
 * GET /api/admin/products
 * 从 MySQL 获取后台线路库
 */
adminRouter.get('/products', async (_req: Request, res: Response): Promise<void> => {
  try {
    const products = await getProductsFromDb();
    res.json({ success: true, data: products });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || '获取线路失败' });
  }
});

/**
 * POST /api/admin/products
 * 上架新线路（持久化写入 travel_product）
 */
adminRouter.post('/products', async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, destination, defaultDays, styleTag, basePriceRmb } = req.body;
    if (!title || !destination) {
      res.status(400).json({ success: false, message: '请提供线路标题和目的地' });
      return;
    }

    const newProduct = await insertProductToDb({
      title,
      destination,
      defaultDays: Number(defaultDays) || 3,
      styleTag: styleTag || '经典游',
      basePriceRmb: Number(basePriceRmb) || 1999
    });

    res.json({ success: true, message: '线路产品上架成功并已入库', data: newProduct });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || '线路产品上架失败' });
  }
});

/**
 * GET /api/admin/analytics
 * 获取智能体咨询与转化统计（由数据库真实聚合计算）
 */
adminRouter.get('/analytics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const analytics = await getAnalyticsFromDb();
    res.json({ success: true, data: analytics });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || '获取统计失败' });
  }
});

/**
 * GET /api/admin/tool-logs
 * 获取智能体工具调用日志（支持 AC3 可观测性证据链）
 */
adminRouter.get('/tool-logs', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, session_id, itinerary_id, tool_name, provider, request_summary,
              response_status, retry_count, is_mock, latency_ms, created_at
       FROM tool_call_log
       ORDER BY id DESC
       LIMIT 20`
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || '获取工具日志失败' });
  }
});
