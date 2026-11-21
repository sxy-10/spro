export type ActiveTabKey = 'plan' | 'itinerary' | 'agent' | 'consult' | 'explore' | 'profile' | 'admin';

export interface DayActivityItem {
  timeString?: string;
  category: 'transport' | 'meal' | 'attraction' | 'hotel' | 'notice';
  title: string;
  subTitle?: string;
  badgeText?: string;
  description?: string;
  metricsText?: string;
  highlightReason?: string;
}

export interface DayScheduleItem {
  dayIndex: number;
  dayLabel: string;
  cityTheme: string;
  weatherText: string;
  temperatureText: string;
  weatherIcon: string;
  items: DayActivityItem[];
}

export interface DetailedItinerary {
  planId: string;
  title: string;
  subTagText: string;
  routeText: string;
  durationSummary: string;
  budgetSummaryRmb: number;
  judgeOptimalityScore: string;
  judgeCertification: {
    statusTitle: string;
    detailMessage: string;
    verifiedBadgeText: string;
  };
  days: DayScheduleItem[];
}

export interface ChatMessageItem {
  id: string;
  sender: 'user' | 'agent';
  content: string;
  semanticTags?: string[];
  toolTags?: string[];
  showItineraryLink?: boolean;
  createdAt: string;
}

export interface ExploreMapPin {
  id: string;
  title: string;
  cityName: string;
  topPercent: number;
  leftPercent: number;
  category?: 'nature' | 'culture' | 'food' | 'city';
  description?: string;
  tags?: string[];
  region?: string;
}

export interface ExploreCollectionItem {
  id: string;
  title: string;
  detailMeta: string;
  description?: string;
  tags?: string[];
  routePrompt?: string;
}

export interface AdminPersonaRule {
  id: string;
  title: string;
  description: string;
  statusText: string;
}

export interface AdminProductRoute {
  id: string;
  title: string;
  description: string;
  statusText: string;
}

export interface AdminMetricsData {
  todayPlanCount: number;
  conversionRatePercent: number;
  conversionRateDiffPercent: number;
  personas: AdminPersonaRule[];
  routes: AdminProductRoute[];
}

export interface ProfileFavoriteItem {
  id: string;
  title: string;
  category: '路线' | '景点' | '美食';
  description: string;
  badgeText: string;
  planPrompt: string;
}

export interface ProfileSubscriptionItem {
  id: string;
  title: string;
  description: string;
  frequency: string;
  enabled: boolean;
  checkPrompt: string;
}

export interface ProfileFootprintItem {
  id: string;
  cityName: string;
  provinceName: string;
  yearString: string;
  countryCode: string;
  description: string;
}

export interface ProfileCollectionPassItem {
  id: string;
  title: string;
  passType: string;
  issueDate: string;
  serialNumber: string;
  statusText: string;
  highlight: string;
}
