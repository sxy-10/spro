import { Router, Request, Response } from 'express';
import { TravelPlannerAgent } from '../agent/planner.js';
import { saveItineraryRecord } from '../db/repository.js';

export const chatRouter = Router();
const planner = new TravelPlannerAgent();

/**
 * POST /api/chat/plan
 * 一句话自然语言规划行程并持久化到 MySQL
 */
chatRouter.post('/plan', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ success: false, message: '请提供有效的出行规划需求描述' });
      return;
    }

    const preference = await planner.extractPreferenceFromText(prompt);
    const plan = await planner.generatePlan(preference);

    // 接入 MySQL 数据持久化
    let dbRecordInfo: { itineraryNo: string; itineraryId: number } | null = null;
    try {
      dbRecordInfo = await saveItineraryRecord({
        itinerary: plan,
        preference,
        userPrompt: prompt,
        userId: 2
      });
      // 将生成的真实业务编号赋给行程方案
      plan.itineraryId = dbRecordInfo.itineraryNo;
    } catch (dbError: any) {
      console.error('⚠️ [Database] 行程保存入库失败，返回内存计算方案:', dbError.message);
    }

    res.json({
      success: true,
      message: '已成功由智能体自动生成个性化出行方案并完成数据持久化',
      data: {
        preference,
        itinerary: plan,
        dbRecord: dbRecordInfo
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || '生成行程失败' });
  }
});
