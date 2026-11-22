/**
 * 第 5 棒 · 组员5（agency-web · 应用外壳：登录门禁 + hash 路由 + 权限守卫）
 *
 * 对应分工文档 5.5「菜单接线」的页面侧：
 *   - 未登录 → LoginScreen（shared-auth loginByAccount，persist:'full' 刷新不掉线）；
 *   - 已登录 → Layout 侧栏菜单（按 buttons[].code 过滤）+ 当前页；
 *   - 手敲 hash 越权访问无权限页 → ForbiddenPanel（菜单隐藏只是体验层，这里才是闸门）。
 *
 * 路由用 location.hash（#/livedesk / #/bigscreen）：不引路由库，
 * 大屏全屏投屏时 URL 可直接分享，刷新后 persist:'full' 会话自动恢复。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { getSession, logout, subscribeSession, type SessionSnapshot } from '@auth';
import { Layout, MENU_ITEMS, visibleMenuItems, type PageKey } from './components/Layout';
import { LoginScreen } from './components/LoginScreen';
import { LiveDesk } from './pages/LiveDesk';
import { BigScreen } from './pages/BigScreen';

const parseHash = (): PageKey => {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return hash === 'bigscreen' ? 'bigscreen' : 'livedesk';
};

/** 无权访问面板（与 prototype showForbidden 同语义的 React 版） */
const ForbiddenPanel: React.FC<{ code: string; onBack: (page: PageKey) => void; allowed: PageKey[] }> = ({
  code,
  onBack,
  allowed
}) => (
  <div className="forbidden-panel">
    <div className="forbidden-card">
      <div className="forbidden-icon">🔒</div>
      <h2>无权访问该页面</h2>
      <p>
        当前账号缺少权限码 <code>{code}</code>。
        权限由后端 Casbin 判定（GET /users/me/permissions），改权限后刷新页面即生效。
      </p>
      {allowed.length > 0 && (
        <div className="forbidden-actions">
          {allowed.map((page) => {
            const item = MENU_ITEMS.find((m) => m.key === page);
            return (
              <button key={page} type="button" onClick={() => onBack(page)}>
                前往「{item?.label ?? page}」
              </button>
            );
          })}
        </div>
      )}
    </div>
  </div>
);

export const App: React.FC = () => {
  // 订阅 shared-auth 会话仓库（登录 / 登出 / 被踢都触发重渲染）
  const [session, setSession] = useState<SessionSnapshot>(() => getSession());
  useEffect(() => subscribeSession(() => setSession(getSession())), []);

  const [page, setPage] = useState<PageKey>(() => parseHash());
  useEffect(() => {
    const onHashChange = (): void => setPage(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: PageKey) => {
    window.location.hash = `#/${next}`;
    setPage(next);
  }, []);

  const handleLogout = useCallback(() => {
    void logout();
  }, []);

  if (!session.accessToken) {
    return <LoginScreen />;
  }

  const allowed = visibleMenuItems(session.permissions).map((item) => item.key);
  const current = MENU_ITEMS.find((item) => item.key === page);

  const content =
    current && allowed.includes(page) ? (
      page === 'livedesk' ? (
        <LiveDesk />
      ) : (
        <BigScreen />
      )
    ) : (
      <ForbiddenPanel code={current?.code ?? '—'} onBack={navigate} allowed={allowed} />
    );

  return (
    <Layout session={session} activePage={page} onNavigate={navigate} onLogout={handleLogout}>
      {content}
    </Layout>
  );
};

export default App;
