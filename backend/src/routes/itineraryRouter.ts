import { Router, Request, Response } from 'express';
import { TravelPlannerAgent } from '../agent/planner.js';
import { TravelPlanItinerary } from '../models/types.js';
import {
  saveItineraryOptimization,
  saveExportRecord,
  getItineraryByNo
} from '../db/repository.js';

export const itineraryRouter = Router();
const planner = new TravelPlannerAgent();

/**
 * GET /api/itinerary/:id
 * 根据行程编号或主键查询数据库中的完整行程详情
 */
itineraryRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const plan = await getItineraryByNo(id);
    if (!plan) {
      res.status(404).json({ success: false, message: '未找到指定行程单' });
      return;
    }
    res.json({ success: true, data: plan });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || '查询行程失败' });
  }
});

/**
 * POST /api/itinerary/optimize
 * 多轮调整与智能重排（持久化新版本快照至 itinerary_version）
 */
itineraryRouter.post('/optimize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { itinerary, instruction } = req.body;
    if (!itinerary || !instruction) {
      res.status(400).json({ success: false, message: '必须提供原行程及调整要求' });
      return;
    }

    const updatedPlan = await planner.optimizeItinerary(itinerary, instruction);

    // 持久化新版本快照
    let newVersion = 2;
    try {
      newVersion = await saveItineraryOptimization(itinerary.itineraryId, updatedPlan, instruction);
    } catch (dbErr: any) {
      console.warn('⚠️ [Database] 优化版本入库警告:', dbErr.message);
    }

    res.json({
      success: true,
      message: '已重新优化并排布行程，并留痕快照版本',
      data: updatedPlan,
      version: newVersion
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || '重排行程失败' });
  }
});

/**
 * POST /api/itinerary/export
 * 一键导出为微信长文排版或打印版文本，并写入 export_record 表
 */
itineraryRouter.post('/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const { itinerary } = req.body as { itinerary: TravelPlanItinerary };
    if (!itinerary) {
      res.status(400).json({ success: false, message: '缺少行程数据' });
      return;
    }

    let markdownText = `# 🧳 【${itinerary.planTitle}】\n\n`;
    markdownText += `> ${itinerary.summaryDescription}\n\n`;
    markdownText += `💰 **预算总估**: ¥${itinerary.estimatedTotalBudgetRmb} | 交通¥${itinerary.budgetBreakdown?.transportationRmb || 0} | 住宿¥${itinerary.budgetBreakdown?.accommodationRmb || 0} | 餐饮¥${itinerary.budgetBreakdown?.mealsRmb || 0}\n\n`;
    markdownText += `🌤️ **天气与着装**: ${itinerary.essentialKitAndNotices?.weatherOverview || '晴好'}。${itinerary.essentialKitAndNotices?.clothingSuggestions || '穿舒适鞋'}\n\n`;
    markdownText += `--- \n\n`;

    (itinerary.days || []).forEach((day) => {
      markdownText += `### 📅 ${day.dateString || `第${day.dayIndex}天`} (${day.cityName})\n`;
      markdownText += `* **上午**: ${(day.morningActivities || []).map((a) => `${a.attractionName}（建议${a.suggestedDurationHours}小时）`).join('、')}\n`;
      markdownText += `* **午餐**: ${day.meals?.find((m) => m.mealType === 'lunch')?.restaurantName || '特色餐厅'} (人均¥${day.meals?.find((m) => m.mealType === 'lunch')?.averageCostRmb || 60})\n`;
      markdownText += `* **下午**: ${(day.afternoonActivities || []).map((a) => a.attractionName).join('、')}\n`;
      markdownText += `* **晚餐**: ${day.meals?.find((m) => m.mealType === 'dinner')?.restaurantName || '特色夜宵'}\n`;
      markdownText += `* **晚上**: ${(day.eveningActivities || []).map((a) => a.attractionName).join('、')}\n`;
      if (day.accommodation) {
        markdownText += `* **住宿推荐**: 🏨 ${day.accommodation.hotelName} (${day.accommodation.locationSummary}，约¥${day.accommodation.estimatedPricePerNightRmb}/晚)\n`;
      }
      markdownText += `* **贴士**: ${(day.dailyTips || []).join('；')}\n\n`;
    });

    markdownText += `### ⚠️ 旅行避坑与安全指南\n`;
    (itinerary.essentialKitAndNotices?.avoidTrapTips || []).forEach((tip, idx) => {
      markdownText += `${idx + 1}. ${tip}\n`;
    });
    markdownText += `\n🚑 紧急联络：报警 ${itinerary.essentialKitAndNotices?.emergencyContacts?.policeNumber || '110'} | 旅游维权 ${itinerary.essentialKitAndNotices?.emergencyContacts?.touristAssistanceHotline || '12345'}\n`;

    // 写入 export_record 表并标记状态
    try {
      await saveExportRecord(itinerary.itineraryId, 'WECHAT_LONG_TEXT', markdownText);
    } catch (dbErr: any) {
      console.warn('⚠️ [Database] 导出记录持久化警告:', dbErr.message);
    }

    res.json({
      success: true,
      data: {
        formattedContent: markdownText
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || '导出行程失败' });
  }
});

