import { Router, Request, Response } from 'express';
import { TravelPlannerAgent } from '../agent/planner.js';

export const chatRouter = Router();
const planner = new TravelPlannerAgent();

/**
 * POST /api/chat/plan
 * 一句话自然语言规划行程
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

    res.json({
      success: true,
      message: '已成功由智能体自动生成个性化出行方案',
      data: {
        preference,
        itinerary: plan
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || '生成行程失败' });
  }
});
