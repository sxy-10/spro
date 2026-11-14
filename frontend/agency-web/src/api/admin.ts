/**
 * 各页面的接口封装。全部走真实后端 /v1。
 * 后端尚未开放的模块（特产/订单管理/客户/导游团队/财务）在此留有注释契约，
 * 后端补齐后只需在对应 page 里解开注释即可接线。
 */
import { request } from './client';
import type {
  AdminUserRow,
  AnalyticsSummary,
  MeProfile,
  PageResult,
  PermissionMenus,
  PlanSnapshot,
  RoleBrief,
  RouteRow,
  StockView,
  TokenPair
} from '../types';

/* ---------------- 认证 ---------------- */

export const fetchCaptcha = () =>
  request<{ captcha_id: string; captcha_image: string; dev_code?: string }>('/auth/captcha', 'GET', undefined, { skipAuth: true });

/** 统一账号登录：验证码 id 走请求头（请求体 .strict() 不收） */
export const loginByAccount = (account: string, password: string, captchaCode: string, captchaId: string) =>
  request<TokenPair>(
    '/auth/login/account',
    'POST',
    { account, password, captcha_code: captchaCode },
    { skipAuth: true, headers: { 'X-Captcha-Id': captchaId } }
  );

export const logout = () => request<null>('/auth/logout', 'POST', {});

/* ---------------- 当前用户与权限 ---------------- */

export const fetchMe = () => request<MeProfile>('/users/me');

export const updateMe = (userId: string, patch: { nickname?: string; avatar_url?: string | null; default_departure_city?: string | null }) =>
  request<MeProfile>(`/users/${userId}`, 'PUT', patch);

export const fetchPermissions = () => request<PermissionMenus>('/users/me/permissions');

/* ---------------- 工作台 ---------------- */

export const fetchAnalytics = () => request<AnalyticsSummary>('/admin/analytics');

/* ---------------- 线路（旅游产品管理） ---------------- */

export interface RouteListQuery {
  page?: number;
  size?: number;
  /** 白名单排序：created_at | base_price_rmb，前缀 - 表示倒序 */
  sort?: string;
}

export const fetchRoutes = (query: RouteListQuery = {}) => {
  const params = new URLSearchParams();
  params.set('page', String(query.page ?? 1));
  params.set('size', String(query.size ?? 100));
  params.set('sort', query.sort ?? '-created_at');
  return request<PageResult<RouteRow>>(`/admin/routes?${params.toString()}`);
};

export interface RouteCreateInput {
  title: string;
  destination: string;
  default_days: number;
  style_tag: string;
  base_price_rmb: string;
}

export const createRoute = (body: RouteCreateInput) => request<RouteRow>('/admin/routes', 'POST', body);

export interface RoutePatchInput {
  title?: string;
  destination?: string;
  default_days?: number;
  style_tag?: string | null;
  base_price_rmb?: string;
  description?: string | null;
  status?: 'DRAFT' | 'ON_SALE' | 'OFF_SALE';
}

export const patchRoute = (routeId: string, body: RoutePatchInput) =>
  request<RouteRow>(`/admin/routes/${routeId}`, 'PATCH', body);

/** 余位为公开接口，但要求线路处于 ON_SALE */
export const fetchStock = (routeId: string, travelDate: string) =>
  request<StockView>(`/routes/${routeId}/stock?travel_date=${travelDate}`);

/* ---------------- AI 智能规划（复用 C 端生成链路） ---------------- */

export interface PlanGenerateInput {
  destination: string;
  start_date: string;
  end_date: string;
  budget?: string;
  tags?: string[];
  prompt?: string;
}

export const generatePlan = (body: PlanGenerateInput) => request<PlanSnapshot>('/plans', 'POST', body);

export const optimizePlan = (planId: string, body: { title?: string; instruction?: string }) =>
  request<PlanSnapshot>(`/plans/${planId}`, 'PATCH', body);

/* ---------------- 旅行社设置 ---------------- */

export interface AdminUserListQuery {
  page?: number;
  size?: number;
  status?: 'ENABLED' | 'DISABLED';
}

export const fetchAdminUsers = (query: AdminUserListQuery = {}) => {
  const params = new URLSearchParams();
  params.set('page', String(query.page ?? 1));
  params.set('size', String(query.size ?? 100));
  if (query.status) params.set('status', query.status);
  return request<PageResult<AdminUserRow>>(`/admin/users?${params.toString()}`);
};

export const fetchRoles = () => request<PageResult<RoleBrief> | RoleBrief[]>('/roles');

export const createAdminUser = (body: { mobile: string; password: string; nickname?: string; role_ids: string[] }) =>
  request<{ user_id: string; role_ids: string[] }>('/admin/users', 'POST', body);

export const updateAdminUser = (
  userId: string,
  body: { nickname?: string; status?: 'ENABLED' | 'DISABLED'; role_ids: string[] }
) => request<{ user_id: string; role_ids: string[]; status: string | null }>(`/admin/users/${userId}`, 'PUT', body);

export const disableAdminUser = (userId: string) =>
  request<{ user_id: string; status: string }>(`/admin/users/${userId}`, 'DELETE', {});

/* ---------------- 以下模块后端接口尚未开放（页面显示空态） ----------------
 * 订单管理：GET /v1/admin/orders?status=&page=&size=（方案文档 §5.2 已定契约）
 *          POST /v1/admin/orders/{id}/confirm
 * 特产管理：GET/POST/PATCH /v1/admin/specialties
 * 客户管理：GET/POST/PATCH /v1/admin/customers
 * 导游与团队：GET/POST /v1/admin/guides、/v1/admin/teams
 * 财务管理：GET /v1/admin/finance/summary、/v1/admin/finance/flows
 * 后端补齐后在对应 Page 解开占位并调用 request() 即可，网络层无需改动。
 * ------------------------------------------------------------------ */
