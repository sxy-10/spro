import 'dotenv/config';
import { llmInfo, chat } from '../src/agent/llm.js';
import { TravelPlannerAgent } from '../src/agent/planner.js';

(async () => {
  console.log('[1] llm:', llmInfo());
  const ping = await chat(
    [{ role: 'system', content: '只回复两个字符：OK' }, { role: 'user', content: 'ping' }],
    { maxTokens: 20, timeoutMs: 25000, thinking: false },
  );
  console.log('[2] ping:', ping ? { model: ping.model, ms: ping.latencyMs, text: ping.content.slice(0, 40) } : 'FAILED');
  if (!ping) process.exit(1);

  const agent = new TravelPlannerAgent();
  const pref = await agent.extractPreferenceFromText('我和老婆两个人，5月中旬想去大理丽江玩6天，预算1万2，不吃辣，不想购物');
  console.log('[3] pref:', JSON.stringify(pref));

  const t0 = Date.now();
  const plan = await agent.generatePlan(pref);
  console.log('[4] 生成耗时(ms):', Date.now() - t0, 'meta:', JSON.stringify(plan.aiMeta));
  console.log('[5] 标题:', plan.planTitle);
  console.log('[6] 天数:', plan.days.length, '首日:', plan.days[0].themeTitle);
  console.log('[7] 首日景点:', plan.days[0].morningActivities.map((a) => a.attractionName).join(' / '));
  console.log('[8] 首日午晚餐:', plan.days[0].meals.map((m) => `${m.mealType}:${m.restaurantName}(${m.averageCostRmb}元)`).join(' | '));
  console.log('[9] 首日酒店:', plan.days[0].accommodation.hotelName, plan.days[0].accommodation.estimatedPricePerNightRmb + '元');
  console.log('[10] 预算分布:', JSON.stringify(plan.budgetBreakdown));
  process.exit(0);
})();
