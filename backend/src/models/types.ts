/**
 * 旅游规划智能体系统 - 数据模型与类型定义
 */

export type TravelStyle = 'leisure' | 'family' | 'couple' | 'hiking' | 'photography' | 'foodie';

export interface UserTravelPreference {
  departureCity: string;
  destinationCities: string[];
  daysCount: number;
  nightsCount: number;
  travelerCount: number;
  budgetTotalRmb: number;
  travelStyle: TravelStyle | string;
  dietaryRestrictions?: string[]; // 忌口：如不吃辣、清真、素食
  avoidShopping?: boolean;        // 是否纯玩无购物
  additionalRequirements?: string; // 补充需求（如近景区、亲子友好等）
}

export interface AttractionItem {
  attractionName: string;
  timeSlot: 'morning' | 'afternoon' | 'evening';
  suggestedDurationHours: number;
  ticketPriceRmb: number;
  openingHours: string;
  bookingNotice: string;
  recommendedReason: string;
}

export interface MealRecommendation {
  mealType: 'breakfast' | 'lunch' | 'dinner';
  restaurantName: string;
  specialtyDishes: string[];
  averageCostRmb: number;
  locationSummary: string;
  reason: string;
}

export interface HotelRecommendation {
  hotelName: string;
  locationSummary: string;
  starLevelOrType: string;
  estimatedPricePerNightRmb: number;
  keyFeatures: string[];
  bookingReason: string;
}

export interface TransportationSegment {
  segmentType: 'intercity' | 'local'; // 往返大交通或当地市内交通
  transportMode: 'flight' | 'high_speed_rail' | 'metro' | 'charter_bus' | 'taxi' | 'self_driving';
  origin: string;
  destination: string;
  estimatedDurationMinutes: number;
  estimatedCostRmb: number;
  transferTips: string;
}

export interface DaySchedule {
  dayIndex: number;
  dateString?: string;
  cityName: string;
  themeTitle: string;
  morningActivities: AttractionItem[];
  afternoonActivities: AttractionItem[];
  eveningActivities: AttractionItem[];
  meals: MealRecommendation[];
  accommodation: HotelRecommendation;
  transfers: TransportationSegment[];
  dailyTips: string[];
}

export interface TravelPlanItinerary {
  itineraryId: string;
  createdAt: string;
  planTitle: string;
  summaryDescription: string;
  userPreference: UserTravelPreference;
  estimatedTotalBudgetRmb: number;
  budgetBreakdown: {
    transportationRmb: number;
    accommodationRmb: number;
    admissionTicketsRmb: number;
    mealsRmb: number;
    reserveFundRmb: number;
  };
  days: DaySchedule[];
  essentialKitAndNotices: {
    weatherOverview: string;
    clothingSuggestions: string;
    essentialDocuments: string[];
    avoidTrapTips: string[]; // 防坑提示
    emergencyContacts: {
      policeNumber: string;
      nearestMajorHospital: string;
      touristAssistanceHotline: string;
    };
  };
}

export interface AgentChatMessage {
  messageId: string;
  sender: 'user' | 'assistant' | 'system';
  textContent: string;
  associatedItinerary?: TravelPlanItinerary;
  timestamp: string;
}

export interface AdminProductTemplate {
  productId: string;
  title: string;
  destination: string;
  defaultDays: number;
  styleTag: string;
  basePriceRmb: number;
  isActive: boolean;
}

export interface AdminAnalyticsSummary {
  totalConsultations: number;
  plansGeneratedCount: number;
  conversionRatePercent: number;
  popularDestinations: { city: string; count: number }[];
}
