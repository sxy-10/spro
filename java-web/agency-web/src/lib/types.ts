/** Node 返回的字段一律 snake_case；这里只声明 6 个页面真正用到的结构。 */

export interface PageResult<T> {
  list: T[]
  total: number
  has_more: boolean
}

export interface ButtonPermission {
  permission_id: string
  name: string
  code: string
  resource_type: 'BUTTON'
}

export interface MenuNode {
  permission_id: string
  parent_id: string | null
  name: string
  code: string
  path?: string | null
  icon?: string | null
  sort: number
  children: MenuNode[]
}

export interface Me {
  user_id: string
  username: string
  roles: string[]
  menus: MenuNode[]
  buttons: ButtonPermission[]
}

export interface DashboardKpi {
  onsale_count: number
  draft_count: number
  today_orders: number
  pending_confirms: number
  today_amount: string
  conversion_rate: number
}

export interface DashboardTrendPoint {
  day: string
  visits: number
  plans: number
  orders: number
}

export interface DashboardData {
  kpi: DashboardKpi
  trend: DashboardTrendPoint[]
  top_products: RouteRow[]
  todos: {
    pending_orders: OrderRow[]
    low_stock: Array<{ route_id: string; title: string; travel_date: string; total_seats: number; available_seats: number }>
  }
  recent_orders: OrderRow[]
}

export interface RouteRow {
  id: string
  route_id: string
  product_no: string
  title: string
  destination: string
  default_days: number
  style_tag: string | null
  base_price_rmb: string
  status: 'DRAFT' | 'ON_SALE' | 'OFF_SALE'
  visitor_count?: number
  plans_generated_count?: number
  order_count?: number
  conversion_rate?: number
  created_at: string
}

export interface OrderRow {
  order_id: string
  order_no: string
  route_title: string
  route_id: string
  travel_date: string
  people_count: number
  amount: string
  status: 'PENDING' | 'PAID' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'REFUNDED'
  contact_name?: string | null
  contact_phone?: string | null
  created_at: string
}

export interface OrderDetail extends OrderRow {
  timeline: Array<{ step: string; time: string | null; done: boolean }>
}

export interface StockView {
  route_id: string
  title: string
  dates: Array<{
    travel_date: string
    total_seats: number
    locked_seats: number
    sold_seats: number
    available_seats: number
  }>
}

/** 全机构库存聚合行（/api/agency/stock）：跨线路、按出行日期升序。 */
export interface StockAllRow {
  route_id: string
  product_no: string
  route_title: string
  travel_date: string
  total_seats: number
  locked_seats: number
  sold_seats: number
  available_seats: number
}

export interface StockAllView {
  dates: StockAllRow[]
  total: number
}

export interface CustomerRow {
  user_id: string
  nickname: string | null
  masked_phone: string | null
  departure_city: string | null
  register_time: string
  total_orders: number
  total_spend: string
  last_order_at: string | null
  preference_tags: string[]
}

export interface CustomerDetail {
  user_id: string
  nickname: string | null
  phone: string | null
  departure_city: string | null
  register_time: string
  orders: Array<{
    order_no: string
    route_title: string
    people_count: number
    amount: string
    status: string
    created_at: string
  }>
  preference_tags: string[]
  preference_destinations: string[]
  follow_up_note: string
}

/* ==================== 平台端：旅行社管理 ==================== */

export interface AgencyRow {
  agency_id: string
  agency_name: string
  license_no: string
  contact_name: string | null
  contact_phone: string | null
  status: 'ACTIVE' | 'DISABLED'
  created_at: string
  onsale_products: number
  order_count: number
}

export interface AgencyMember {
  username: string
  nickname: string | null
  status: string
  last_login_at: string | null
}

export interface AgencyDetail {
  agency_id: string
  agency_name: string
  license_no: string
  contact_name: string | null
  contact_phone: string | null
  status: 'ACTIVE' | 'DISABLED'
  intro: string | null
  created_at: string
  members: AgencyMember[]
  stats: {
    onsale_products: number
    order_count: number
    total_amount: string
  }
}

/* ==================== 平台端：账号管理 ==================== */

export interface UserRow {
  user_id: string
  nickname: string | null
  username: string
  masked_phone: string | null
  user_type: 'TOURIST' | 'ADMIN'
  agency_id: string | null
  agency_name: string | null
  role_names: string | null
  status: 'ACTIVE' | 'DISABLED'
  last_login_at: string | null
  created_at: string
}

export interface RoleRow {
  role_id: string
  name: string
  code: string
  description: string | null
  status: 'ENABLED' | 'DISABLED'
  user_count: number
  permission_count: number
}

/* ==================== 平台端：总览大盘 ==================== */
/* 注意：mysql2 驱动把 COUNT/DECIMAL 原样吐出（经 Node serialize 后是字符串），
   数值字段统一声明为 string，渲染时用 Number() 转换。 */

export interface PlatformKpi {
  tourist_count: string
  agency_count: string
  route_onsale: string
  souvenir_onsale: string
  today_orders: string
  today_amount: string
  pending_audits: string
  pending_confirms: string
  pending_settlements: string
  refund_amount: string
}

export interface PlatformTrendPoint {
  day: string
  orders: string
  amount: string
  visits: string
}

export interface PlatformTopProduct {
  route_id: string
  product_no: string
  title: string
  agency_name: string
  visitor_count: number
  order_count: number
  /** DB 存的是小数比例（0.3333 = 33.3%），展示时 ×100 */
  conversion_rate: string
}

export interface DestinationHeat {
  destination: string
  visits: string
}

export interface PlatformOverview {
  kpi: PlatformKpi
  trend: PlatformTrendPoint[]
  top_products: PlatformTopProduct[]
  destination_heat: DestinationHeat[]
}

/* ==================== 平台端：订单监督 ==================== */

export interface PlatformOrderRow {
  order_id: string
  order_no: string
  agency_name: string
  route_title: string
  people_count: number
  amount: string
  status: 'PENDING' | 'PAID' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'REFUNDED'
  contact_name: string | null
  contact_phone: string | null
  travel_date: string
  created_at: string
  paid_at: string | null
}

/* ==================== 平台端：财务结算 ==================== */

export interface FinanceSummary {
  total_gmv: string
  pending_settle: string
  pending_agencies: string
  settled_amount: string
  refund_amount: string
  refund_count: string
}

export interface SettlementRow {
  settlement_id: string
  settlement_no: string
  agency_name: string
  period_label: string
  order_count: string
  gross_amount: string
  commission_rate: string
  commission_amount: string
  payable_amount: string
  status: 'PENDING' | 'SETTLED' | 'REJECTED'
  reject_reason: string | null
  created_at: string
  settled_at: string | null
}

export interface RefundRow {
  order_no: string
  customer: string | null
  masked_phone: string | null
  agency_name: string
  amount: string
  refund_reason: string | null
  refunded_at: string | null
  status: string
}

/* ==================== 平台端：数据分析 ==================== */

export interface AnalyticsData {
  days: number
  /** 漏斗四层：访问 → 生成行程 → 下单 → 有效成交（CONFIRMED+COMPLETED） */
  funnel: { visits: string; plans: string; orders: string; deals: string }
  trend: PlatformTrendPoint[]
  destination_heat: Array<{ destination: string; visits: string; orders: string }>
  product_rank: PlatformTopProduct[]
  tag_distribution: Array<{ tag_value: string; cnt: string }>
  city_distribution: Array<{ city: string; cnt: string }>
  /** 有效成交口径与财务结算页 GMV 一致：PAID+CONFIRMED+COMPLETED */
  agency_performance: Array<{
    agency_id: string
    agency_name: string
    onsale_products: string
    order_count: string
    total_amount: string
  }>
}

/* ==================== 平台端：内容审核 ==================== */

export type AuditType = 'route' | 'souvenir'

export interface AuditRow {
  product_id: string
  product_no: string
  title: string
  /** 线路=目的地；特产=品类（Node 复用同名列） */
  destination: string
  agency_name: string
  price: string
  audit_status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'
  audit_remark: string | null
  product_status: string
  submitted_at: string
}

/* ==================== 平台端：AI 智能服务 ==================== */

export interface AiToolDistribution {
  tool_name: string
  calls: string
  success_calls: string
  failed_calls: string
}

export interface AiServiceData {
  kpi: {
    today_sessions: string
    active_sessions: string
    today_messages: string
    today_tool_calls: string
    avg_latency_ms: string
    unclosed_sessions: string
  }
  tool_distribution: AiToolDistribution[]
  hot_questions: Array<{ content: string; cnt: string }>
  abnormal_sessions: Array<{
    session_id: string
    title: string | null
    user_id: string
    status: string
    last_active_at: string
  }>
  config: {
    persona: string | null
    model_params: string | null
    tools_json: string | null
    updated_at: string
  } | null
  llm: {
    provider: string
    base_url: string
    model: string
    key_configured: boolean
    enabled: boolean
  }
}

/* ==================== 平台端：系统元数据 ==================== */

export interface SystemMeta {
  audit_logs: Array<{
    operator_name: string
    action: string
    object_type: string
    object_no: string
    detail: string
    trace_id: string | null
    created_at: string
  }>
  dicts: Array<{
    dict_type: string
    dict_key: string
    dict_value: string
    sort: number
  }>
}
