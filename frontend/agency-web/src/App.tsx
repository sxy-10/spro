/**
 * 应用入口：登录态 + hash 路由 + 权限上下文。
 *
 * 路由（hash）：
 *   #/login     登录页
 *   #/dashboard 工作台（默认）
 *   #/planner   AI 智能规划
 *   #/products  旅游产品管理（线路/特产）
 *   #/orders    订单管理
 *   #/customers 客户管理
 *   #/guides    导游与团队管理
 *   #/finance   财务管理
 *   #/settings  旅行社设置
 *
 * 权限：数据源为 GET /users/me/permissions（Casbin 结果，真相源在 Node）。
 * 按钮级控制只做「体验层隐藏」——后端 requireAction 永远是真正的门禁。
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { API_BASE_URL, renewToken } from './api/client';
import { clearSession, getSessionSnapshot, setExpiredNotice, subscribeSession } from './api/session';
import { fetchMe, fetchPermissions } from './api/admin';
import { ToastHost } from './components/ui';
import { Layout, NAV_ITEMS } from './components/Layout';
import { LoginScreen } from './pages/Login';
import { DashboardScreen } from './pages/Dashboard';
import { PlannerScreen } from './pages/AiPlanner';
import { ProductsScreen } from './pages/Products';
import { CustomersScreen, FinanceScreen, GuidesScreen, OrdersScreen } from './pages/ComingSoon';
import { SettingsScreen } from './pages/Settings';
import type { MeProfile, PermissionMenus } from './types';

/* ---------------- hash 路由 ---------------- */
const VALID_KEYS = new Set(NAV_ITEMS.map((item) => item.key));

const readHash = (): string => {
  const key = window.location.hash.replace(/^#\//, '');
  return VALID_KEYS.has(key) ? key : 'dashboard';
};

function useHashRoute(): [string, (key: string) => void] {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((key: string) => {
    window.location.hash = `#/${key}`;
    setRoute(VALID_KEYS.has(key) ? key : 'dashboard');
  }, []);
  return [route, navigate];
}

/* ---------------- 会话订阅 ---------------- */
const useAuthSnapshot = () =>
  useSyncExternalStore(subscribeSession, getSessionSnapshot, () => getSessionSnapshot());

/* ---------------- 应用 ---------------- */
export function App() {
  const auth = useAuthSnapshot();
  const [route, navigate] = useHashRoute();
  const [me, setMe] = useState<MeProfile | null>(null);
  const [permissions, setPermissions] = useState<PermissionMenus | null>(null);
  const [booting, setBooting] = useState(auth.loggedIn);

  /** 登录成功或恢复会话后：拉取资料 + 权限 */
  const bootstrap = useCallback(async () => {
    setBooting(true);
    try {
      const [meData, permData] = await Promise.all([fetchMe(), fetchPermissions()]);
      setMe(meData);
      setPermissions(permData);
    } catch {
      clearSession({ expired: true });
      setMe(null);
      setPermissions(null);
    } finally {
      setBooting(false);
    }
  }, []);

  // 有 refresh_token（页面刷新恢复会话）→ 先静默续期再 bootstrap
  useEffect(() => {
    if (!auth.loggedIn) return;
    let alive = true;
    void (async () => {
      if (!getAccessTokenSafe()) {
        const ok = await renewToken();
        if (!alive) return;
        if (!ok) {
          clearSession({ expired: true });
          setBooting(false);
          return;
        }
      }
      if (alive) void bootstrap();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loggedIn]);

  // 退出登录事件（Layout 派发）
  useEffect(() => {
    const onLogout = () => {
      setMe(null);
      setPermissions(null);
      clearSession();
      setExpiredNotice(undefined);
    };
    window.addEventListener('agency:logout', onLogout);
    return () => window.removeEventListener('agency:logout', onLogout);
  }, []);

  const can = useMemo(() => {
    const codes = new Set((permissions?.buttons ?? []).map((button) => button.code));
    return (code: string) => codes.has(code);
  }, [permissions]);

  /* ---- 登录前 ---- */
  if (!auth.loggedIn || booting) {
    if (auth.loggedIn && booting) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--ink-500)' }}>
          正在进入旅行社管理端…
        </div>
      );
    }
    return (
      <>
        <ToastHost />
        {auth.expiredNotice && (
          <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 300 }}>
            <div className="toast error">{auth.expiredNotice}</div>
          </div>
        )}
        <LoginScreen
          onSuccess={() => {
            setExpiredNotice(undefined);
            void bootstrap();
            navigate('dashboard');
          }}
        />
      </>
    );
  }

  /* ---- 登录后 ---- */
  return (
    <>
      <ToastHost />
      <Layout me={me} current={route} onNavigate={navigate}>
        {route === 'dashboard' && <DashboardScreen onNavigate={navigate} />}
        {route === 'planner' && <PlannerScreen canCreateRoute={can('route:line:add')} />}
        {route === 'products' && (
          <ProductsScreen canQuery={can('route:line:query')} canAdd={can('route:line:add')} canUpdate={can('route:line:update')} />
        )}
        {route === 'orders' && <OrdersScreen />}
        {route === 'customers' && <CustomersScreen />}
        {route === 'guides' && <GuidesScreen />}
        {route === 'finance' && <FinanceScreen />}
        {route === 'settings' && <SettingsScreen />}
      </Layout>
      {import.meta.env.DEV && <span style={{ display: 'none' }} data-api-base={API_BASE_URL} />}
    </>
  );
}

/** 仅为语义清晰的小工具：access token 是否已在内存 */
function getAccessTokenSafe(): boolean {
  return getSessionSnapshot().hasAccessToken;
}
