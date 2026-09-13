import { Router, Request, Response } from 'express';
import { AdminProductTemplate, AdminAnalyticsSummary } from '../models/types.js';

export const adminRouter = Router();

// 模拟旅行社线路库
let mockProducts: AdminProductTemplate[] = [
  {
    productId: 'prod_001',
    title: '云南大理丽江5日沉浸风情游',
    destination: '云南',
    defaultDays: 5,
    styleTag: '休闲慢节奏',
    basePriceRmb: 2899,
    isActive: true
  },
  {
    productId: 'prod_002',
    title: '川西川藏南线7日越野风光自驾',
    destination: '四川/西藏',
    defaultDays: 7,
    styleTag: '摄影与自驾',
    basePriceRmb: 4680,
    isActive: true
  }
];

/**
 * GET /api/admin/products
 * 获取后台线路库
 */
adminRouter.get('/products', (_req: Request, res: Response) => {
  res.json({ success: true, data: mockProducts });
});

/**
 * POST /api/admin/products
 * 上架新线路
 */
adminRouter.post('/products', (req: Request, res: Response): void => {
  const { title, destination, defaultDays, styleTag, basePriceRmb } = req.body;
  const newProduct: AdminProductTemplate = {
    productId: `prod_${Date.now()}`,
    title,
    destination,
    defaultDays: Number(defaultDays) || 3,
    styleTag: styleTag || '经典游',
    basePriceRmb: Number(basePriceRmb) || 1999,
    isActive: true
  };
  mockProducts.push(newProduct);
  res.json({ success: true, message: '线路产品上架成功', data: newProduct });
});

/**
 * GET /api/admin/analytics
 * 获取智能体咨询与转化统计
 */
adminRouter.get('/analytics', (_req: Request, res: Response) => {
  const analytics: AdminAnalyticsSummary = {
    totalConsultations: 1248,
    plansGeneratedCount: 980,
    conversionRatePercent: 38.6,
    popularDestinations: [
      { city: '云南 (大理/丽江)', count: 420 },
      { city: '四川 (成都/九寨沟)', count: 310 },
      { city: '新疆 (伊犁/喀纳斯)', count: 215 },
      { city: '贵州 (荔波/黄果树)', count: 180 }
    ]
  };
  res.json({ success: true, data: analytics });
});
