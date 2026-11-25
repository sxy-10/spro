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
