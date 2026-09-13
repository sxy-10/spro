/**
 * 智能体工具集成层（景点、交通、酒店、天气、美食）
 * 支持离线Mock模式与外部API插槽扩展
 */

export interface WeatherToolResult {
  city: string;
  weatherCondition: string;
  temperatureRange: string;
  clothingAdvice: string;
}

export interface AttractionToolResult {
  attractionName: string;
  city: string;
  ticketPriceRmb: number;
  suggestedHours: number;
  openingHours: string;
  bookingNotice: string;
  highlightDescription: string;
}

export interface TransportToolResult {
  origin: string;
  destination: string;
  optimalOption: string;
  priceRangeRmb: string;
  durationString: string;
  recommendationNotes: string;
}

export interface HotelToolResult {
  city: string;
  areaName: string;
  recommendedHotel: string;
  averagePriceRmb: number;
  starRating: string;
  perks: string[];
}

export interface FoodToolResult {
  city: string;
  dishName: string;
  restaurantName: string;
  averageCostRmb: number;
  flavorTags: string[];
}

export class AgentToolSet {
  // 1. 天气工具
  async queryWeather(cityName: string): Promise<WeatherToolResult> {
    // 默认或Mock响应，预留接入气象API接口
    return {
      city: cityName,
      weatherCondition: '晴转多云',
      temperatureRange: '16℃ ~ 24℃',
      clothingAdvice: '早晚温差较大，建议携带防风外套，白天穿舒适透气棉麻衣物与轻便运动鞋。'
    };
  }

  // 2. 景点工具
  async searchAttractions(cityName: string, keywords: string[]): Promise<AttractionToolResult[]> {
    return [
      {
        attractionName: `${cityName}核心文化地标`,
        city: cityName,
        ticketPriceRmb: 60,
        suggestedHours: 3,
        openingHours: '08:30 - 17:30 (16:30停止检票)',
        bookingNotice: '需提前在官方公众号进行实名制分时段预约。',
        highlightDescription: '人文历史底蕴深厚，拍照打卡绝佳点位。'
      },
      {
        attractionName: `${cityName}自然风光胜地`,
        city: cityName,
        ticketPriceRmb: 85,
        suggestedHours: 3.5,
        openingHours: '08:00 - 18:00',
        bookingNotice: '旺季建议提前1天预订索道与环保车票。',
        highlightDescription: '山水相依，视野开阔，适合放松漫游。'
      }
    ];
  }

  // 3. 交通比价工具
  async compareTransportation(origin: string, destination: string): Promise<TransportToolResult> {
    return {
      origin,
      destination,
      optimalOption: '高铁二等座 / 经济舱特惠航班',
      priceRangeRmb: '350 - 680 元/人',
      durationString: '约 3 - 4.5 小时',
      recommendationNotes: '时间优先选早班高铁，准点率高且市区车站交通便利。'
    };
  }

  // 4. 住宿推荐工具
  async recommendHotels(cityName: string, targetBudget: number, preferences: string): Promise<HotelToolResult[]> {
    return [
      {
        city: cityName,
        areaName: `${cityName}景区/核心商圈周边`,
        recommendedHotel: `${cityName}精品景观美宿`,
        averagePriceRmb: Math.round(targetBudget * 0.35),
        starRating: '4.8分 (高口碑舒适型)',
        perks: ['临近地铁', '免费双人早餐', '行李寄存', '落地窗观景']
      }
    ];
  }

  // 5. 美食探索工具
  async findLocalFoods(cityName: string, dietaryRestrictions: string[] = []): Promise<FoodToolResult[]> {
    const isNonSpicy = dietaryRestrictions.includes('不吃辣');
    return [
      {
        city: cityName,
        dishName: isNonSpicy ? `${cityName}特色养生煲 / 清汤名品` : `${cityName}地道传统招牌风味`,
        restaurantName: `百年老字号 ${cityName}风味食府`,
        averageCostRmb: 78,
        flavorTags: isNonSpicy ? ['鲜香', '原汁原味', '温润'] : ['麻辣醇香', '地道风味']
      }
    ];
  }
}
