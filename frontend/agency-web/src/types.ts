/**
 * 旅行社管理端 · 领域类型
 * 字段与后端 serialize() 输出对齐：snake_case、ID/金额字符串、*_布尔、时间 UTC ISO8601。
 */

/** 统一响应外壳 {code,message,data,trace_id}，由 client.ts 剥壳 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  trace_id?: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  has_more: boolean;
}

/** 登录/换票返回 */
export interface TokenPair {
  token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  login_type?: string;
}

export interface RoleBrief {
  role_id: string;
  name: string;
  code: string;
}

export interface MeProfile {
  user_id: string;
  nickname: string | null;
  phone: string;
  avatar_url: string | null;
  role: string;
  agency_id: string | null;
  status: string;
  create_time: string;
  roles: RoleBrief[];
}

/** GET /users/me/permissions */
export interface PermissionMenus {
  menus: MenuNode[];
  buttons: { permission_id: string; name: string; code: string }[];
}
export interface MenuNode {
  permission_id: string;
  name: string;
  code: string;
  path?: string | null;
  icon?: string | null;
  resource_type: string;
  children?: MenuNode[];
}

/** GET /admin/routes 行记录（routeFields） */
export interface RouteRow {
  id: string;
  route_id: string;
  product_no: string;
  title: string;
  destination: string;
  default_days: number;
  style_tag: string | null;
  base_price_rmb: string;
  cover_image_url: string | null;
  status: 'DRAFT' | 'ON_SALE' | 'OFF_SALE';
  is_active: boolean;
  created_at: string;
  description?: string | null;
}

/** GET /routes/{id}/stock?travel_date= */
export interface StockView {
  total_seats: number;
  available_seats: number;
  is_sellable: boolean;
}

/** GET /admin/analytics */
export interface AnalyticsSummary {
  total_consultations: number;
  plans_generated_count: number;
  conversion_rate_percent: number;
  popular_destinations: { city: string; count: number }[];
}

/** POST /admin/users */
export interface AdminUserRow {
  user_id: string;
  username: string | null;
  phone: string;
  nickname: string | null;
  avatar_url: string | null;
  role: string;
  agency_id: string | null;
  status: 'ACTIVE' | 'DISABLED';
  created_at: string;
  roles: RoleBrief[];
}

/** POST /plans 生成的行程快照（serialize 后 snake_case） */
export interface PlanSnapshot {
  plan_id: string;
  plan_title: string;
  summary_description?: string;
  estimated_total_budget_rmb?: string;
  user_preference?: {
    departure_city?: string;
    destination_cities?: string[];
    days_count?: number;
    nights_count?: number;
    travel_style?: string;
    budget_total_rmb?: string;
  };
  days: PlanDay[];
  plan_id_alias?: string;
  start_date?: string;
  end_date?: string;
  is_estimated: boolean;
  version?: number;
  status?: string;
}
export interface PlanDay {
  day_index: number;
  date_string?: string;
  city_name?: string;
  theme_title?: string;
  transfers?: PlanItem[];
  morning_activities?: PlanItem[];
  afternoon_activities?: PlanItem[];
  evening_activities?: PlanItem[];
}
export interface PlanItem {
  transport_mode?: string;
  origin?: string;
  destination?: string;
  estimated_duration_minutes?: number;
  estimated_cost_rmb?: string;
  transfer_tips?: string;
  attraction_name?: string;
  recommended_reason?: string;
  booking_notice?: string;
  suggested_duration_hours?: number;
  activity_name?: string;
  description?: string;
}
