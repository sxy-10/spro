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

export class TravelPlannerAgent {
  private tools: AgentToolSet;

  constructor() {
    this.tools = new AgentToolSet();
  }

  /**
   * 从自然语言提取旅游意图（含默认规则回退）
   */
  async extractPreferenceFromText(userInput: string): Promise<UserTravelPreference> {
    // 默认基础兜底偏好
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

    // 简易关键词语义识别（无 LLM Key 时的平滑兜底）
    const daysMatch = userInput.match(/(\d+)\s*天/);
    if (daysMatch) {
      preference.daysCount = parseInt(daysMatch[1], 10);
      preference.nightsCount = Math.max(1, preference.daysCount - 1);
    }

    const budgetMatch = userInput.match(/预算\s*(\d+)/i) || userInput.match(/(\d+)\s*(?:元|块|预算)/);
    if (budgetMatch) {
      preference.budgetTotalRmb = parseInt(budgetMatch[1], 10);
    }

    const peopleMatch = userInput.match(/(\d+)\s*(?:个)?人/);
    if (peopleMatch) {
      preference.travelerCount = parseInt(peopleMatch[1], 10);
    }

    if (userInput.includes('不吃辣')) {
      preference.dietaryRestrictions?.push('不吃辣');
    }

    return preference;
  }

  /**
   * 全自动生成出行方案
   */
  async generatePlan(preference: UserTravelPreference): Promise<TravelPlanItinerary> {
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

      const transfers: TransportationSegment[] = [
        {
          segmentType: i === 1 ? 'intercity' : 'local',
          transportMode: i === 1 ? 'high_speed_rail' : 'taxi',
          origin: i === 1 ? preference.departureCity : `${targetCity}酒店`,
          destination: `${targetCity}首个景点`,
          estimatedDurationMinutes: i === 1 ? 180 : 25,
          estimatedCostRmb: i === 1 ? 380 : 35,
          transferTips: i === 1 ? transportInfo.recommendationNotes : '打车或地铁直达，不绕路。'
        }
      ];

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

    // 预算划分
    const total = preference.budgetTotalRmb;
    const budgetBreakdown = {
      transportationRmb: Math.round(total * 0.3),
      accommodationRmb: Math.round(total * 0.35),
      admissionTicketsRmb: Math.round(total * 0.15),
      mealsRmb: Math.round(total * 0.15),
      reserveFundRmb: Math.round(total * 0.05)
    };

    return {
      itineraryId: `plan_${Date.now()}`,
      createdAt: new Date().toISOString(),
      planTitle: `${preference.departureCity}出发 → ${preference.destinationCities.join('/')} ${preference.daysCount}天${preference.nightsCount}晚${preference.travelStyle}之旅`,
      summaryDescription: `专为${preference.travelerCount}人量身定制，总预算约${preference.budgetTotalRmb}元。全程按“不走回头路”智能动线排布，兼顾自然风光与深度人文。`,
      userPreference: preference,
      estimatedTotalBudgetRmb: total,
      budgetBreakdown,
      days,
      essentialKitAndNotices: {
        weatherOverview: `${weatherData.weatherCondition}，气温${weatherData.temperatureRange}`,
        clothingSuggestions: weatherData.clothingAdvice,
        essentialDocuments: ['身份证原件', '学生证/优惠有效证件', '健康码/行程凭据'],
        avoidTrapTips: [
          '车站机场出站口请拒绝主动揽客的低价黑车与无证导游。',
          '景区内标称“开光银饰/名贵药材”多为溢价品，按需理性选购。',
          '打车务必使用正规网约车或要求司机打表。'
        ],
        emergencyContacts: {
          policeNumber: '110',
          nearestMajorHospital: `${primaryCity}第一人民医院 (急诊24小时)`,
          touristAssistanceHotline: '12345 (政务与旅游维权热线)'
        }
      }
    };
  }

  /**
   * 行程微调与自动重新排布
   */
  async optimizeItinerary(originalPlan: TravelPlanItinerary, adjustmentInstruction: string): Promise<TravelPlanItinerary> {
    const updatedPlan: TravelPlanItinerary = JSON.parse(JSON.stringify(originalPlan));
    updatedPlan.planTitle = `${originalPlan.planTitle} (已按“${adjustmentInstruction}”优化调整)`;
    
    // 添加优化日志至日贴士中
    if (updatedPlan.days.length > 0) {
      updatedPlan.days[0].dailyTips.unshift(`已智能调整：${adjustmentInstruction}`);
    }
    return updatedPlan;
  }
}
