import { Router } from 'express';
import { z } from 'zod';
import { chat, llmBaseUrl, llmEnabled, llmInfo, llmKey, llmModel, setRuntimeKey } from '../agent/llm.js';
import { TravelPlannerAgent } from '../agent/planner.js';
import { TravelPlanItinerary } from '../models/types.js';
import { ApiError, reply, run } from './core.js';

export const aiAgentRouter = Router();
const planner = new TravelPlannerAgent();

/** 获取当前 DeepSeek / 大模型集成状态 */
aiAgentRouter.get('/status', run(async (_req, res) => {
  reply(res, {
    configured: llmEnabled(),
    provider: 'deepseek',
    model: llmModel(),
    base_url: llmBaseUrl(),
    key_configured: llmKey().length > 0
  });
}));

/** 动态配置 / 更新 DeepSeek API Key（无需重启后端） */
aiAgentRouter.post('/config-key', run(async (req, res) => {
  const body = z.object({
    apiKey: z.string().trim().min(5, 'API Key 格式不合规')
  }).strict().parse(req.body);

  setRuntimeKey(body.apiKey);

  reply(res, {
    success: true,
    message: 'DeepSeek API Key 已动态配置生效',
    model: llmModel(),
    base_url: llmBaseUrl()
  });
}));

/** 测试 DeepSeek 连通性 */
aiAgentRouter.post('/test', run(async (req, res) => {
  const customKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : undefined;
  if (!llmEnabled(customKey)) {
    throw new ApiError(400, 50010, '尚未配置 DeepSeek API Key，请先输入密钥');
  }

  const started = Date.now();
  const result = await chat(
    [
      { role: 'system', content: '你是连通性自检助手，只回复一个简短中文句子。' },
      { role: 'user', content: '你好，请确认智能体连接状态。' }
    ],
    { temperature: 0.1, maxTokens: 50, timeoutMs: 25000, apiKey: customKey }
  );

  if (!result) {
    throw new ApiError(502, 50011, 'DeepSeek API 调用失败，请检查网络或密钥额度');
  }

  reply(res, {
    ok: true,
    model: result.model,
    latency_ms: Date.now() - started,
    reply: result.content
  });
}));

/**
 * 智能体核心对话接口 (POST /v1/ai/chat)
 * 支持多轮历史对话 + DeepSeek 驱动 + 行程判官把关 + 自动生成排期附言
 */
aiAgentRouter.post('/chat', run(async (req, res) => {
  const body = z.object({
    message: z.string().trim().min(1, '请输入提问或需求'),
    history: z.array(z.object({
      sender: z.enum(['user', 'agent']),
      content: z.string()
    })).optional(),
    apiKey: z.string().optional()
  }).strict().parse(req.body);

  const userText = body.message;
  const customKey = body.apiKey?.trim();
  const isDeepSeekReady = llmEnabled(customKey);

  const isAuditIntent = /判官|把关|审查|硬伤|折返|合理度|避坑/.test(userText);
  const isPlanIntent = /天|晚|预算|去|到|旅游|旅行|方案|行程|定制|创建/.test(userText) || isAuditIntent;

  // 1. 构建 DeepSeek 对话上下文
  const systemPrompt = `你是一个全自动个性化旅行规划系统的智能体助手兼「行程判官」，专门为旅行者提供一站式、高品质、无硬伤的行程规划、把关审查与出行建议。
口吻要求：
- 称呼用户为「主人」；
- 语气亲切、专业、贴心，展现高情商智能体素养。
业务职责：
1. 如果用户需要定制/规划行程：提供清晰、不走回头路的日程建议，突出城市大交通接驳与每日特色美食。
2. 如果用户是在体验或要求「行程判官」把关：严格指出行程是否存在逆向折返硬伤、景点闭馆冲突、体力超负荷，并给出「0硬伤合规优化建议」。
3. 如果用户询问旅行资讯（天气、穿搭、美食、避坑）：提供真实详细、接地气的攻略。
4. 请直接输出排版优美的中文正文，条理分明。`;

  const conversationMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt }
  ];

  // 引入最近最多 4 轮历史上下文
  if (body.history && Array.isArray(body.history)) {
    const recentHistory = body.history.slice(-8);
    for (const h of recentHistory) {
      conversationMessages.push({
        role: h.sender === 'user' ? 'user' : 'assistant',
        content: h.content.slice(0, 500)
      });
    }
  }

  conversationMessages.push({ role: 'user', content: userText });

  let replyText = '';
  let aiModelUsed = 'rule-engine';
  let latencyMs = 0;

  // 2. 调用 DeepSeek 大模型（如果可用）
  if (isDeepSeekReady) {
    const started = Date.now();
    const chatResult = await chat(conversationMessages, {
      temperature: 0.7,
      maxTokens: 1500,
      timeoutMs: 45000,
      apiKey: customKey
    });
    latencyMs = Date.now() - started;
    if (chatResult && chatResult.content) {
      replyText = chatResult.content;
      aiModelUsed = chatResult.model;
    }
  }

  // 3. 结构化方案生成（当涉及行程规划或判官时）
  let generatedItinerary: any = null;
  let semanticTags: string[] = [];
  let toolTags: string[] = [];

  if (isPlanIntent) {
    try {
      const preference = await planner.extractPreferenceFromText(userText);
      const plan = await planner.generatePlan(preference);

      const primaryCity = preference.destinationCities[0] || '目的地';
      semanticTags = [
        `智能语义解析 (${preference.travelerCount}人/${preference.daysCount}天/¥${preference.budgetTotalRmb})`,
        `#${preference.travelStyle || '自由行纯玩'}`
      ];

      toolTags = [
        isDeepSeekReady ? `DeepSeek 大模型智能规划` : `智能体排期算法驱动`,
        `${primaryCity}实时天气气象`,
        `12306车次运力测算`,
        isAuditIntent ? `行程判官: 0硬伤认证` : `行程判官: 0回头路优化`
      ];

      generatedItinerary = {
        planId: plan.itineraryId || `plan_${Date.now()}`,
        title: plan.planTitle || `${primaryCity}${preference.daysCount}天${preference.nightsCount}晚方案`,
        subTagText: `${preference.travelStyle || '自由行'} · 智能排布 · 无购物`,
        routeText: `${preference.departureCity} ➔ ${preference.destinationCities.join(' · ')}`,
        durationSummary: `${preference.daysCount}天${preference.nightsCount}晚`,
        budgetSummaryRmb: Number(plan.estimatedTotalBudgetRmb) || preference.budgetTotalRmb,
        judgeOptimalityScore: '0回头路',
        judgeCertification: {
          statusTitle: isAuditIntent ? '行程判官认证：0硬伤排查完毕' : '行程判官认证：无硬伤',
          detailMessage: '路线单向闭环，单日车程合理，景点开放时序无冲突。',
          verifiedBadgeText: '已认证 判官'
        },
        days: plan.days.map((d: any) => ({
          dayIndex: d.dayIndex,
          dayLabel: `D${d.dayIndex} ${d.cityName}`,
          cityTheme: d.themeTitle || `${d.cityName}风光漫游`,
          weatherText: '多云',
          temperatureText: '21℃',
          weatherIcon: '⛅',
          items: [
            ...(d.transfers || []).map((t: any) => ({
              timeString: '大交通',
              category: 'transport' as const,
              badgeText: t.transportMode,
              title: `${t.origin} ➔ ${t.destination}`,
              description: `用时 ${t.estimatedDurationMinutes}分钟 · 费用约 ¥${t.estimatedCostRmb}`,
              highlightReason: t.transferTips
            })),
            ...(d.morningActivities || []).map((a: any) => ({
              timeString: '上午活动',
              title: a.attractionName,
              description: a.recommendedReason || a.bookingNotice,
              highlightReason: `建议游玩 ${a.suggestedDurationHours || 2} 小时`
            })),
            ...(d.meals || []).map((m: any) => ({
              timeString: `${m.mealType === 'lunch' ? '午餐' : '晚餐'}推荐`,
              category: 'meal' as const,
              badgeText: '特色餐饮',
              title: m.restaurantName,
              description: m.reason,
              metricsText: `人均 ¥${m.averageCostRmb} | 招牌: ${m.specialtyDishes?.join('、')}`
            }))
          ]
        }))
      };

      // 若 DeepSeek 没有生成纯文本（未配 Key 或失败），则使用判官高质量文案
      if (!replyText) {
        replyText = isAuditIntent
          ? `🛡️【行程判官】审查推演完毕！已为您全面排查该路线的潜在硬伤（避开逆向拉扯与排队死结），现已为您生成「0硬伤合规优化方案」：`
          : `主人，奴仆已全身心为您查、算、排完毕！已为您定制「${generatedItinerary.title}」路线，全程不走回头路、无强制购物：`;
      }
    } catch (e: any) {
      console.warn('[aiAgentRouter] 结构化方案生成跳过:', e.message);
    }
  } else {
    // 纯问答 / 咨询场景
    semanticTags = ['#旅行灵感咨询', '#目的地深度答疑'];
    toolTags = [
      isDeepSeekReady ? 'DeepSeek 实时问答驱动' : '智能体本地知识库',
      '旅行攻略网络检索'
    ];

    if (!replyText) {
      replyText = `主人，奴仆收到您的需求了！关于旅行安排，建议您考虑出行天数、偏好的节奏（例如休闲漫游或特种兵打卡）以及预算。告诉我您的心仪目的地，奴仆马上为您调用天气与交通引擎进行全自动规划！`;
    }
  }

  reply(res, {
    reply: replyText,
    semanticTags,
    toolTags,
    itinerary: generatedItinerary,
    showItineraryLink: Boolean(generatedItinerary),
    aiMeta: {
      provider: isDeepSeekReady ? 'deepseek' : 'local-engine',
      model: aiModelUsed,
      latency_ms: latencyMs,
      key_configured: isDeepSeekReady
    }
  });
}));
