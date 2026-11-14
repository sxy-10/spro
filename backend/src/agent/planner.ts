import {
  UserTravelPreference,
  TravelPlanItinerary,
  DaySchedule,
  AttractionItem,
  MealRecommendation,
  HotelRecommendation,
  TransportationSegment
} from '../models/types.js';
import { AgentToolSet } from './tools.js';
import { chatJson, llmEnabled, llmModel } from './llm.js';
import { pool } from '../db/connection.js';

const PLANNER_SYSTEM = `你是「travel-agent」，一名资深的中国境内旅行定制师，擅长把用户的一句话需求变成可直接执行、不走回头路的行程。

输出规则（必须严格遵守）：
1. 只输出一个 JSON 对象，禁止 markdown 代码围栏、禁止任何解释性文字。
2. 字段名与层级必须与给定结构完全一致，不得增删改名字段。
3. 所有金额为人民币元，必须是数字类型（不要写"380元"或"约380"）。
4. 景点、餐厅、酒店填写真实存在或高度可信的名称，禁止"XX标志性景区"这类占位名。
5. 行程要地理动线合理（同一天景点尽量同区域），餐饮安排在景点附近。
6. morning/afternoon/eveningActivities 只放景点、街区、体验类项目；航班、高铁、打车等交通信息只能写在 transfers 中。
7. 严格遵守用户的天数、人数、预算、忌口、纯玩无购物等约束。
8. dailyTips、recommendedReason、bookingNotice 等信息要用具体可执行的建议，避免空话模板句。`;

const PLAN_SCHEMA_HINT = `{
  "planTitle": "标题，如「成都出发·大理丽江5天4晚慢游」",
  "summaryDescription": "两三句话概述亮点与节奏",
  "estimatedTotalBudgetRmb": 数字,
  "budgetBreakdown": { "transportationRmb": 数字, "accommodationRmb": 数字, "admissionTicketsRmb": 数字, "mealsRmb": 数字, "reserveFundRmb": 数字 },
  "days": [{
    "dayIndex": 1,
    "cityName": "城市",
    "themeTitle": "D1：一句话主题",
    "morningActivities": [{ "attractionName": "", "timeSlot": "morning", "suggestedDurationHours": 3, "ticketPriceRmb": 0, "openingHours": "", "bookingNotice": "", "recommendedReason": "" }],
    "afternoonActivities": [{ "attractionName": "", "timeSlot": "afternoon", "suggestedDurationHours": 2.5, "ticketPriceRmb": 0, "openingHours": "", "bookingNotice": "", "recommendedReason": "" }],
    "eveningActivities": [{ "attractionName": "", "timeSlot": "evening", "suggestedDurationHours": 2, "ticketPriceRmb": 0, "openingHours": "", "bookingNotice": "", "recommendedReason": "" }],
    "meals": [{ "mealType": "lunch", "restaurantName": "", "specialtyDishes": [""], "averageCostRmb": 60, "locationSummary": "", "reason": "" }],
    "accommodation": { "hotelName": "", "locationSummary": "", "starLevelOrType": "", "estimatedPricePerNightRmb": 300, "keyFeatures": [""], "bookingReason": "" },
    "transfers": [{ "segmentType": "intercity", "transportMode": "high_speed_rail", "origin": "", "destination": "", "estimatedDurationMinutes": 120, "estimatedCostRmb": 200, "transferTips": "" }],
    "dailyTips": [""]
  }],
  "essentialKitAndNotices": {
    "weatherOverview": "", "clothingSuggestions": "", "essentialDocuments": [""], "avoidTrapTips": [""],
    "emergencyContacts": { "policeNumber": "110", "nearestMajorHospital": "", "touristAssistanceHotline": "12345" }
  }
}`;

const MODE_VALUES = ['flight', 'high_speed_rail', 'metro', 'charter_bus', 'taxi', 'self_driving'];

/* ---------------------------------------------------------------------------
 * 平台侧 AI 服务配置（ai_service_config）读取，60 秒缓存
 * 让「AI 智能服务管理」页配置的人设与模型参数真实作用于生成过程
 * -------------------------------------------------------------------------*/
interface ServiceConfig { persona: string; temperature: number; maxTokens: number; tools: Record<string, boolean> }

let cfgCache: { at: number; value: ServiceConfig } = {
  at: 0,
  value: { persona: '', temperature: 0.8, maxTokens: 6000, tools: {} },
};

function parseModelParams(text: string): { temperature?: number; maxTokens?: number } {
  const out: { temperature?: number; maxTokens?: number } = {};
  const t = text.match(/温度\s*[:：]?\s*([01](?:\.\d+)?)/);
  if (t) out.temperature = Math.min(1.5, Math.max(0, Number(t[1])));
  const m = text.match(/(?:最大长度|max[_\s]?tokens?|长度)\s*[:：]?\s*(\d{3,6})/i);
  if (m) out.maxTokens = Math.min(8000, Math.max(256, Number(m[1])));
  return out;
}

async function loadServiceConfig(): Promise<ServiceConfig> {
  if (Date.now() - cfgCache.at < 60_000) return cfgCache.value;
  const fallback = cfgCache.value;
  try {
    const [rows] = await pool.query('SELECT persona, model_params, tools_json FROM ai_service_config WHERE id=1');
    const row = (rows as Array<{ persona?: string; model_params?: string; tools_json?: unknown }>)[0] || {};
    const params = parseModelParams(String(row.model_params || ''));
    let tools: Record<string, boolean> = {};
    try {
      const raw = typeof row.tools_json === 'string' ? JSON.parse(row.tools_json) : row.tools_json;
      if (raw && typeof raw === 'object') tools = raw as Record<string, boolean>;
    } catch { /* 忽略脏配置 */ }
    cfgCache = {
      at: Date.now(),
      value: {
        persona: String(row.persona || '').trim(),
        temperature: params.temperature ?? 0.8,
        maxTokens: params.maxTokens ?? 6000,
        tools,
      },
    };
  } catch {
    cfgCache = { at: Date.now(), value: fallback };
  }
  return cfgCache.value;
}

/* ---------------------------------------------------------------------------
 * 归一化工具：LLM 输出不可全信，逐字段收口，保证前端渲染永不崩
 * -------------------------------------------------------------------------*/
function asStr(v: unknown, def: string, max = 160): string {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, max);
  if (typeof v === 'number') return String(v);
  return def;
}

function asNum(v: unknown, def: number, min = 0, max = 1_000_000): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

function asStrArr(v: unknown, def: string[], max = 6, maxLen = 60): string[] {
  const list = Array.isArray(v)
    ? v.map((x) => asStr(x, '', maxLen)).filter(Boolean)
    : typeof v === 'string' && v.trim() ? [v.trim().slice(0, maxLen)] : [];
  return (list.length ? list : def).slice(0, max);
}

function asAttractions(v: unknown, slot: 'morning' | 'afternoon' | 'evening', city: string): AttractionItem[] {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  const items = arr.slice(0, 3).map((raw) => {
    const o = (raw || {}) as Record<string, unknown>;
    return {
      attractionName: asStr(o.attractionName ?? o.name, `${city}城区游览`, 60),
      timeSlot: slot,
      suggestedDurationHours: asNum(o.suggestedDurationHours, slot === 'morning' ? 3 : 2.5, 0.5, 10),
      ticketPriceRmb: asNum(o.ticketPriceRmb, 0, 0, 5000),
      openingHours: asStr(o.openingHours, '08:30 - 17:30', 60),
      bookingNotice: asStr(o.bookingNotice, '建议提前一天在线预约，避开团队高峰。', 200),
      recommendedReason: asStr(o.recommendedReason, '当季体验最佳，动线顺路不折返。', 200),
    };
  });
  if (items.length) return items;
  return [{
    attractionName: `${city}城区游览`,
    timeSlot: slot,
    suggestedDurationHours: slot === 'morning' ? 3 : 2.5,
    ticketPriceRmb: 0,
    openingHours: '08:30 - 17:30',
    bookingNotice: '建议提前一天在线预约。',
    recommendedReason: '按当日动线就近安排，减少往返。',
  }];
}

function asMeals(v: unknown, city: string): MealRecommendation[] {
  const arr = Array.isArray(v) ? v : [];
  const meals = arr.slice(0, 3).map((raw, i) => {
    const o = (raw || {}) as Record<string, unknown>;
    const type = asStr(o.mealType, i === 0 ? 'lunch' : 'dinner', 12).toLowerCase();
    return {
      mealType: (['breakfast', 'lunch', 'dinner'].includes(type) ? type : i === 0 ? 'lunch' : 'dinner') as MealRecommendation['mealType'],
      restaurantName: asStr(o.restaurantName, `${city}本地口碑餐厅`, 60),
      specialtyDishes: asStrArr(o.specialtyDishes, ['本地招牌菜'], 4, 30),
      averageCostRmb: asNum(o.averageCostRmb, 60, 10, 2000),
      locationSummary: asStr(o.locationSummary, '距当日景点步行 10 分钟内', 120),
      reason: asStr(o.reason, '本地人常去，口味稳定，出餐快。', 160),
    };
  });
  if (meals.some((m) => m.mealType === 'lunch') && meals.some((m) => m.mealType === 'dinner')) return meals;
  return [
    ...meals,
    {
      mealType: 'lunch' as const,
      restaurantName: `${city}本地口碑餐厅`,
      specialtyDishes: ['本地招牌菜'],
      averageCostRmb: 60,
      locationSummary: '景点周边步行可达',
      reason: '顺路用餐，节省时间。',
    },
    {
      mealType: 'dinner' as const,
      restaurantName: `${city}特色菜馆`,
      specialtyDishes: ['当季时蔬', '本地汤品'],
      averageCostRmb: 80,
      locationSummary: '酒店附近商圈',
      reason: '晚餐后步行回酒店，方便休息。',
    },
  ].slice(0, 3);
}

function asHotel(v: unknown, city: string): HotelRecommendation {
  const o = (v || {}) as Record<string, unknown>;
  return {
    hotelName: asStr(o.hotelName, `${city}核心商圈酒店`, 60),
    locationSummary: asStr(o.locationSummary, `${city}中心商圈，地铁可达`, 120),
    starLevelOrType: asStr(o.starLevelOrType, '四星级 / 精品酒店', 40),
    estimatedPricePerNightRmb: asNum(o.estimatedPricePerNightRmb, 320, 60, 20000),
    keyFeatures: asStrArr(o.keyFeatures, ['含早餐', '近地铁'], 5, 30),
    bookingReason: asStr(o.bookingReason, '位置便于次日行程出发，含早餐省时。', 160),
  };
}

function asTransfers(
  v: unknown,
  pref: UserTravelPreference,
  dayIndex: number,
  city: string,
): TransportationSegment[] {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  const list = arr.slice(0, 3).map((raw) => {
    const o = (raw || {}) as Record<string, unknown>;
    const segType = asStr(o.segmentType, dayIndex === 1 ? 'intercity' : 'local', 12);
    const mode = asStr(o.transportMode, dayIndex === 1 ? 'high_speed_rail' : 'taxi', 20);
    return {
      segmentType: (segType === 'intercity' ? 'intercity' : 'local') as TransportationSegment['segmentType'],
      transportMode: (MODE_VALUES.includes(mode) ? mode : 'taxi') as TransportationSegment['transportMode'],
      origin: asStr(o.origin, dayIndex === 1 ? pref.departureCity : `${city}酒店`, 60),
      destination: asStr(o.destination, `${city}首个景点`, 60),
      estimatedDurationMinutes: asNum(o.estimatedDurationMinutes, dayIndex === 1 ? 150 : 25, 5, 3000),
      estimatedCostRmb: asNum(o.estimatedCostRmb, dayIndex === 1 ? 260 : 30, 0, 20000),
      transferTips: asStr(o.transferTips, '使用正规网约车或地铁，按计价器结算。', 160),
    };
  });
  if (list.length) return list;
  return [{
    segmentType: dayIndex === 1 ? 'intercity' : 'local',
    transportMode: dayIndex === 1 ? 'high_speed_rail' : 'taxi',
    origin: dayIndex === 1 ? pref.departureCity : `${city}酒店`,
    destination: `${city}首个景点`,
    estimatedDurationMinutes: dayIndex === 1 ? 150 : 25,
    estimatedCostRmb: dayIndex === 1 ? 260 : 30,
    transferTips: '使用正规网约车或地铁，按计价器结算。',
  }];
}

function normalizePlan(raw: unknown, pref: UserTravelPreference): TravelPlanItinerary | null {
  const o = (raw || {}) as Record<string, unknown>;
  const rawDays = Array.isArray(o.days) ? o.days : [];
  if (!rawDays.length) return null;

  const cities = pref.destinationCities.length ? pref.destinationCities : ['目的地'];
  const days: DaySchedule[] = rawDays.slice(0, 15).map((rawDay, i) => {
    const d = (rawDay || {}) as Record<string, unknown>;
    const city = asStr(d.cityName, cities[i % cities.length], 40);
    return {
      dayIndex: i + 1,
      dateString: asStr(d.dateString, `第 ${i + 1} 天`, 20),
      cityName: city,
      themeTitle: asStr(d.themeTitle, `D${i + 1}：${city}深度体验`, 80),
      morningActivities: asAttractions(d.morningActivities, 'morning', city),
      afternoonActivities: asAttractions(d.afternoonActivities, 'afternoon', city),
      eveningActivities: asAttractions(d.eveningActivities, 'evening', city),
      meals: asMeals(d.meals, city),
      accommodation: asHotel(d.accommodation, city),
      transfers: asTransfers(d.transfers, pref, i + 1, city),
      dailyTips: asStrArr(d.dailyTips, ['错峰出发，避开 12:00-14:00 高温时段。'], 4, 120),
    };
  });

  // 天数与用户要求对齐：不足补、超出截断
  const want = Math.max(1, Math.min(15, pref.daysCount || days.length));
  while (days.length < want) {
    const last = days[days.length - 1];
    const city = cities[(days.length) % cities.length];
    days.push({
      ...JSON.parse(JSON.stringify(last)),
      dayIndex: days.length + 1,
      dateString: `第 ${days.length + 1} 天`,
      cityName: city,
      themeTitle: `D${days.length + 1}：${city}自由活动与返程准备`,
    });
  }
  if (days.length > want) days.length = want;

  const total = asNum(pref.budgetTotalRmb, 5000, 300, 500000);
  const bb = (o.budgetBreakdown || {}) as Record<string, unknown>;
  let breakdown = {
    transportationRmb: asNum(bb.transportationRmb, Math.round(total * 0.3), 0, total),
    accommodationRmb: asNum(bb.accommodationRmb, Math.round(total * 0.35), 0, total),
    admissionTicketsRmb: asNum(bb.admissionTicketsRmb, Math.round(total * 0.15), 0, total),
    mealsRmb: asNum(bb.mealsRmb, Math.round(total * 0.15), 0, total),
    reserveFundRmb: asNum(bb.reserveFundRmb, Math.round(total * 0.05), 0, total),
  };
  const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (sum <= 0 || Math.abs(sum - total) / total > 0.35) {
    breakdown = {
      transportationRmb: Math.round(total * 0.3),
      accommodationRmb: Math.round(total * 0.35),
      admissionTicketsRmb: Math.round(total * 0.15),
      mealsRmb: Math.round(total * 0.15),
      reserveFundRmb: Math.round(total * 0.05),
    };
  }

  const kit = (o.essentialKitAndNotices || {}) as Record<string, unknown>;
  const ec = (kit.emergencyContacts || {}) as Record<string, unknown>;

  return {
    itineraryId: `plan_${Date.now()}`,
    createdAt: new Date().toISOString(),
    planTitle: asStr(o.planTitle, `${pref.departureCity}出发·${cities.join('/')}${want}天行程`, 100),
    summaryDescription: asStr(o.summaryDescription, `为 ${pref.travelerCount} 人定制，预算约 ${total} 元。`, 500),
    userPreference: pref,
    estimatedTotalBudgetRmb: total,
    budgetBreakdown: breakdown,
    days,
    essentialKitAndNotices: {
      weatherOverview: asStr(kit.weatherOverview, '出行前请查看当地 7 日预报，山区昼夜温差较大。', 200),
      clothingSuggestions: asStr(kit.clothingSuggestions, '以舒适速干衣物为主，备一件薄外套与防滑鞋。', 200),
      essentialDocuments: asStrArr(kit.essentialDocuments, ['身份证原件', '优惠证件（学生证/老年证）'], 5, 40),
      avoidTrapTips: asStrArr(kit.avoidTrapTips, [
        '拒绝车站机场主动揽客的低价黑车与无证导游。',
        '景区周边"开光饰品/名贵药材"多为溢价商品，理性消费。',
      ], 5, 120),
      emergencyContacts: {
        policeNumber: asStr(ec.policeNumber, '110', 20),
        nearestMajorHospital: asStr(ec.nearestMajorHospital, `${days[0].cityName}第一人民医院（急诊 24 小时）`, 80),
        touristAssistanceHotline: asStr(ec.touristAssistanceHotline, '12345', 40),
      },
    },
  };
}

/* ---------------------------------------------------------------------------
 * 主智能体
 * -------------------------------------------------------------------------*/
export class TravelPlannerAgent {
  private tools: AgentToolSet;

  constructor() {
    this.tools = new AgentToolSet();
  }

  /** 是否已接入真实大模型（未配置密钥时为 false，走本地规则兜底） */
  get aiReady(): boolean {
    return llmEnabled();
  }

  /**
   * 从自然语言提取旅游意图：优先大模型结构化抽取，失败回退正则规则
   */
  async extractPreferenceFromText(userInput: string): Promise<UserTravelPreference> {
    const fallback = this.extractByRules(userInput);
    if (!llmEnabled()) return fallback;

    const result = await chatJson<Partial<UserTravelPreference>>(
      [
        { role: 'system', content: '你是旅行需求解析器。只输出 JSON 对象，字段：departureCity(出发城市，未提及则"成都")、destinationCities(目的地城市数组)、daysCount(整数天)、nightsCount(整数晚，通常天数-1)、travelerCount(人数)、budgetTotalRmb(总预算整数元，未提及则按天数×800估算)、travelStyle(一句话风格，如"休闲不赶路")、dietaryRestrictions(忌口数组)、avoidShopping(布尔)、additionalRequirements(补充要求原文摘要)。不要输出任何其他文字。' },
        { role: 'user', content: userInput.slice(0, 500) },
      ],
      { temperature: 0.2, maxTokens: 500, timeoutMs: 20000 },
    );

    if (!result) return fallback;
    const d = result.data || {};
    const days = Math.round(asNum(d.daysCount, fallback.daysCount, 1, 15));
    const cities = Array.isArray(d.destinationCities)
      ? d.destinationCities.map((c) => asStr(c, '', 20)).filter(Boolean).slice(0, 5)
      : [];
    return {
      departureCity: asStr(d.departureCity, fallback.departureCity, 20),
      destinationCities: cities.length ? cities : fallback.destinationCities,
      daysCount: days,
      nightsCount: Math.round(asNum(d.nightsCount, Math.max(1, days - 1), 0, 14)),
      travelerCount: Math.round(asNum(d.travelerCount, fallback.travelerCount, 1, 30)),
      budgetTotalRmb: Math.round(asNum(d.budgetTotalRmb, fallback.budgetTotalRmb, 300, 500000)),
      travelStyle: asStr(d.travelStyle, fallback.travelStyle, 40),
      dietaryRestrictions: asStrArr(d.dietaryRestrictions, fallback.dietaryRestrictions || [], 5, 20)
        .map((x) => (x === '辣' || x === '忌辣' || x === '不能吃辣' ? '不吃辣' : x)),
      avoidShopping: typeof d.avoidShopping === 'boolean' ? d.avoidShopping : fallback.avoidShopping,
      additionalRequirements: asStr(d.additionalRequirements, userInput.slice(0, 200), 300),
    };
  }

  /** 无 LLM 时的规则抽取（原有逻辑，保留作为兜底） */
  private extractByRules(userInput: string): UserTravelPreference {
    const preference: UserTravelPreference = {
      departureCity: '成都',
      destinationCities: ['昆明', '大理', '丽江'],
      daysCount: 5,
      nightsCount: 4,
      travelerCount: 2,
      budgetTotalRmb: 8000,
      travelStyle: '休闲不累',
      dietaryRestrictions: [],
      avoidShopping: true,
      additionalRequirements: userInput
    };

    const daysMatch = userInput.match(/(\d+)\s*天/);
    if (daysMatch) {
      preference.daysCount = Math.min(15, parseInt(daysMatch[1], 10));
      preference.nightsCount = Math.max(1, preference.daysCount - 1);
    }
    const budgetMatch = userInput.match(/预算\s*(\d+)/i) || userInput.match(/(\d+)\s*(?:元|块|预算)/);
    if (budgetMatch) preference.budgetTotalRmb = parseInt(budgetMatch[1], 10);
    const peopleMatch = userInput.match(/(\d+)\s*(?:个)?人/);
    if (peopleMatch) preference.travelerCount = parseInt(peopleMatch[1], 10);
    if (userInput.includes('不吃辣')) preference.dietaryRestrictions?.push('不吃辣');
    if (userInput.includes('亲子')) preference.travelStyle = '亲子友好·节奏舒缓';
    return preference;
  }

  /**
   * 全自动生成出行方案：DeepSeek 生成 → 严格归一化 → 失败回退本地模板
   */
  async generatePlan(preference: UserTravelPreference): Promise<TravelPlanItinerary> {
    if (llmEnabled()) {
      const cfg = await loadServiceConfig();
      const weather = await this.tools.queryWeather(preference.destinationCities[0] || '目的地');
      const context = [
        `用户偏好：${JSON.stringify({
          departureCity: preference.departureCity,
          destinationCities: preference.destinationCities,
          daysCount: preference.daysCount,
          nightsCount: preference.nightsCount,
          travelerCount: preference.travelerCount,
          budgetTotalRmb: preference.budgetTotalRmb,
          travelStyle: preference.travelStyle,
          dietaryRestrictions: preference.dietaryRestrictions,
          avoidShopping: preference.avoidShopping,
          additionalRequirements: preference.additionalRequirements,
        })}`,
        `已知天气参考：${weather.weatherCondition}，${weather.temperatureRange}`,
        `硬性要求：days 数组必须恰好 ${preference.daysCount} 个元素；总预算控制在 ${preference.budgetTotalRmb} 元内；人数 ${preference.travelerCount} 人。`,
      ].join('\n');

      const result = await chatJson<TravelPlanItinerary>(
        [
          { role: 'system', content: cfg.persona ? `${PLANNER_SYSTEM}\n\n平台当前人设：${cfg.persona}` : PLANNER_SYSTEM },
          { role: 'user', content: `请按以下 JSON 结构输出完整行程：\n${PLAN_SCHEMA_HINT}\n\n${context}` },
        ],
        { temperature: cfg.temperature, maxTokens: Math.max(6000, cfg.maxTokens), timeoutMs: 90000 },
      );

      if (result) {
        const plan = normalizePlan(result.data, preference);
        if (plan) {
          plan.aiMeta = {
            provider: 'deepseek',
            model: result.meta.model,
            latency_ms: result.meta.latencyMs,
            tokens: result.meta.usage?.total_tokens,
          };
          return plan;
        }
        console.warn('[planner] LLM 输出结构不可用，回退模板引擎');
      }
    }
    return this.generatePlanByTemplate(preference);
  }

  /** 模板引擎（原实现，作为无密钥/调用失败时的兜底） */
  private async generatePlanByTemplate(preference: UserTravelPreference): Promise<TravelPlanItinerary> {
    const primaryCity = preference.destinationCities[0] || '云南目的地';
    const weatherData = await this.tools.queryWeather(primaryCity);
    const transportInfo = await this.tools.compareTransportation(preference.departureCity, primaryCity);
    const hotelInfo = await this.tools.recommendHotels(primaryCity, preference.budgetTotalRmb / preference.daysCount, '舒适近景点');
    const foodInfo = await this.tools.findLocalFoods(primaryCity, preference.dietaryRestrictions);

    const days: DaySchedule[] = [];
    for (let i = 1; i <= preference.daysCount; i++) {
      const targetCity = preference.destinationCities[(i - 1) % preference.destinationCities.length] || primaryCity;

      const morningActivity: AttractionItem = {
        attractionName: `${targetCity}标志性风景区`,
        timeSlot: 'morning',
        suggestedDurationHours: 3,
        ticketPriceRmb: 75,
        openingHours: '08:30 - 17:30',
        bookingNotice: '建议提前通过官方预约渠道锁定上午场次，避免排队。',
        recommendedReason: '光线柔和，空气清新，适合摄影与悠闲漫步。'
      };
      const afternoonActivity: AttractionItem = {
        attractionName: `${targetCity}历史古街区与艺术馆`,
        timeSlot: 'afternoon',
        suggestedDurationHours: 2.5,
        ticketPriceRmb: 0,
        openingHours: '全天开放',
        bookingNotice: '免费开放，穿戴舒适步履鞋即可。',
        recommendedReason: '紧邻上午路线，顺路参观无折返，体验本地市井生活。'
      };
      const eveningActivity: AttractionItem = {
        attractionName: `${targetCity}夜市与观景露台`,
        timeSlot: 'evening',
        suggestedDurationHours: 2,
        ticketPriceRmb: 0,
        openingHours: '18:00 - 23:00',
        bookingNotice: '人流较旺，注意随身贵重物品。',
        recommendedReason: '夜景绚丽，可俯瞰城市灯火，感受烟火气。'
      };
      const lunchMeal: MealRecommendation = {
        mealType: 'lunch',
        restaurantName: foodInfo[0]?.restaurantName || `${targetCity}特色口碑餐厅`,
        specialtyDishes: [foodInfo[0]?.dishName || '特色风味主菜', '当季时蔬清炒'],
        averageCostRmb: foodInfo[0]?.averageCostRmb || 68,
        locationSummary: '距上午景点步行约400米',
        reason: '顺路就餐，环境清雅，符合游客饮食偏好。'
      };
      const dinnerMeal: MealRecommendation = {
        mealType: 'dinner',
        restaurantName: `${targetCity}老饕私房菜`,
        specialtyDishes: ['精选本地特色汤品', '炭烤鲜味'],
        averageCostRmb: 85,
        locationSummary: '夜市商圈核心步行街',
        reason: '当地居民高频复购小馆，性价比高。'
      };
      const hotel: HotelRecommendation = {
        hotelName: hotelInfo[0]?.recommendedHotel || `${targetCity}精品度假客栈`,
        locationSummary: hotelInfo[0]?.areaName || `${targetCity}中心商圈`,
        starLevelOrType: hotelInfo[0]?.starRating || '高品质美宿',
        estimatedPricePerNightRmb: hotelInfo[0]?.averagePriceRmb || 360,
        keyFeatures: hotelInfo[0]?.perks || ['近地铁', '含早餐'],
        bookingReason: '地理位置优越，距离当日行程终点仅10分钟车程，便于休息。'
      };
      const transfers: TransportationSegment[] = [{
        segmentType: i === 1 ? 'intercity' : 'local',
        transportMode: i === 1 ? 'high_speed_rail' : 'taxi',
        origin: i === 1 ? preference.departureCity : `${targetCity}酒店`,
        destination: `${targetCity}首个景点`,
        estimatedDurationMinutes: i === 1 ? 180 : 25,
        estimatedCostRmb: i === 1 ? 380 : 35,
        transferTips: i === 1 ? transportInfo.recommendationNotes : '打车或地铁直达，不绕路。'
      }];

      days.push({
        dayIndex: i,
        dateString: `第 ${i} 天`,
        cityName: targetCity,
        themeTitle: `D${i}：${targetCity}沉浸深度探索之旅`,
        morningActivities: [morningActivity],
        afternoonActivities: [afternoonActivity],
        eveningActivities: [eveningActivity],
        meals: [lunchMeal, dinnerMeal],
        accommodation: hotel,
        transfers,
        dailyTips: [
          '避开12:00-14:00烈日暴晒时段。',
          '如遇周末节假日，建议比预计时间早30分钟出发。'
        ]
      });
    }

    const total = preference.budgetTotalRmb;
    return {
      itineraryId: `plan_${Date.now()}`,
      createdAt: new Date().toISOString(),
      planTitle: `${preference.departureCity}出发 → ${preference.destinationCities.join('/')} ${preference.daysCount}天${preference.nightsCount}晚${preference.travelStyle}之旅`,
      summaryDescription: `专为${preference.travelerCount}人量身定制，总预算约${preference.budgetTotalRmb}元。全程按"不走回头路"智能动线排布，兼顾自然风光与深度人文。`,
      userPreference: preference,
      estimatedTotalBudgetRmb: total,
      budgetBreakdown: {
        transportationRmb: Math.round(total * 0.3),
        accommodationRmb: Math.round(total * 0.35),
        admissionTicketsRmb: Math.round(total * 0.15),
        mealsRmb: Math.round(total * 0.15),
        reserveFundRmb: Math.round(total * 0.05)
      },
      days,
      essentialKitAndNotices: {
        weatherOverview: `${weatherData.weatherCondition}，气温${weatherData.temperatureRange}`,
        clothingSuggestions: weatherData.clothingAdvice,
        essentialDocuments: ['身份证原件', '学生证/优惠有效证件', '健康码/行程凭据'],
        avoidTrapTips: [
          '车站机场出站口请拒绝主动揽客的低价黑车与无证导游。',
          '景区内标称"开光银饰/名贵药材"多为溢价品，按需理性选购。',
          '打车务必使用正规网约车或要求司机打表。'
        ],
        emergencyContacts: {
          policeNumber: '110',
          nearestMajorHospital: `${primaryCity}第一人民医院 (急诊24小时)`,
          touristAssistanceHotline: '12345 (政务与旅游维权热线)'
        }
      },
      aiMeta: { provider: 'template', model: 'template-v1' }
    };
  }

  /**
   * 行程微调：LLM 按指令重排，失败则回退为在方案内追加调整说明
   */
  async optimizeItinerary(originalPlan: TravelPlanItinerary, adjustmentInstruction: string): Promise<TravelPlanItinerary> {
    if (llmEnabled()) {
      const cfg = await loadServiceConfig();
      const compact = {
        planTitle: originalPlan.planTitle,
        estimatedTotalBudgetRmb: originalPlan.estimatedTotalBudgetRmb,
        days: originalPlan.days.map((d) => ({
          dayIndex: d.dayIndex,
          cityName: d.cityName,
          themeTitle: d.themeTitle,
          morning: d.morningActivities.map((a) => a.attractionName),
          afternoon: d.afternoonActivities.map((a) => a.attractionName),
          evening: d.eveningActivities.map((a) => a.attractionName),
          hotel: d.accommodation.hotelName,
        })),
      };
      const result = await chatJson<TravelPlanItinerary>(
        [
          { role: 'system', content: cfg.persona ? `${PLANNER_SYSTEM}\n\n平台当前人设：${cfg.persona}` : PLANNER_SYSTEM },
          {
            role: 'user',
            content: `这是当前行程（精简版）：\n${JSON.stringify(compact)}\n\n用户调整要求：${adjustmentInstruction}\n\n` +
              `请输出调整后的完整行程 JSON，结构与下面一致：\n${PLAN_SCHEMA_HINT}\n\n` +
              `要求：days 数量保持 ${originalPlan.days.length} 天；保持用户原偏好（人数 ${originalPlan.userPreference.travelerCount} 人、预算 ${originalPlan.estimatedTotalBudgetRmb} 元）。`,
          },
        ],
        { temperature: cfg.temperature, maxTokens: Math.max(6000, cfg.maxTokens), timeoutMs: 90000 },
      );
      if (result) {
        const plan = normalizePlan(result.data, originalPlan.userPreference);
        if (plan) {
          plan.itineraryId = originalPlan.itineraryId;
          plan.aiMeta = {
            provider: 'deepseek',
            model: result.meta.model,
            latency_ms: result.meta.latencyMs,
            tokens: result.meta.usage?.total_tokens,
          };
          return plan;
        }
      }
      console.warn('[planner] 调整失败，使用本地兜底逻辑');
    }

    const updatedPlan: TravelPlanItinerary = JSON.parse(JSON.stringify(originalPlan));
    updatedPlan.planTitle = `${originalPlan.planTitle} (已按"${adjustmentInstruction}"优化调整)`;
    if (updatedPlan.days.length > 0) {
      updatedPlan.days[0].dailyTips.unshift(`已智能调整：${adjustmentInstruction}`);
    }
    updatedPlan.aiMeta = { provider: 'template', model: 'template-v1' };
    return updatedPlan;
  }
}
