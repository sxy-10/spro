/**
 * 第 5 棒 · 组员5（agency-web · 布局与菜单接线）
 *
 * 对应分工文档 5.5：菜单接线 ——
 *   「在线客服」→ 权限码 im:conv:manage（imRouter 的 requireAction('im:conv','manage')）
 *   「实时大屏」→ 权限码 analytics:live:query（statsRouter 的 requireAction('analytics:live','query')）
 *
 * 权限真相源在后端 Casbin（GET /users/me/permissions 下发 buttons[]），
 * 前端只做精确码比对（shared-auth hasPermissionCode），不做 role 硬编码 ——
 * 与 C 端 menuTabs.ts 的「权限只决定取哪几项」完全同口径。
 * 菜单隐藏只是体验层；页面内再拦一道（App.tsx），防止手敲 hash 越权。
 */

import React from 'react';
import { hasPermissionCode, type SessionSnapshot } from '@auth';

export type PageKey = 'livedesk' | 'bigscreen';

export interface MenuItem {
  key: PageKey;
  label: string;
  code: string;
  desc: string;
  icon: string;
}

/** 菜单唯一真相源：label + 权限码 + 页面描述，App.tsx 与 Layout.tsx 共用 */
export const MENU_ITEMS: MenuItem[] = [
  {
    key: 'livedesk',
    label: '在线客服',
    code: 'im:conv:manage',
    desc: '游客咨询会话处理',
    icon: '💬'
  },
  {
    key: 'bigscreen',
    label: '实时大屏',
    code: 'analytics:live:query',
    desc: '运营指标实时监控',
    icon: '📊'
  }
];

/** 当前登录人可见的菜单（buttons[].code 精确匹配） */
export const visibleMenuItems = (permissions: SessionSnapshot['permissions']): MenuItem[] =>
  MENU_ITEMS.filter((item) => hasPermissionCode(permissions, item.code));

interface LayoutProps {
  session: SessionSnapshot;
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
  onLogout: () => void;
  children?: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ session, activePage, onNavigate, onLogout, children }) => {
  const items = visibleMenuItems(session.permissions);
  const user = session.user;
  const displayName = user?.phone || user?.mobile || session.userId || '未命名账号';
  const roleNames: string[] = Array.isArray(user?.roles_detail)
    ? user.roles_detail.map((r: any) => r?.name ?? r?.code).filter(Boolean)
    : (user?.roles ?? []);

  return (
    <div className="layout">
      <aside className="layout-sidebar">
        <div className="layout-brand">
          <div className="brand-mark">🧭</div>
          <div>
            <div className="brand-title">旅行社交付系统</div>
            <div className="brand-sub">B 端工作台 · 第 5 棒</div>
          </div>
        </div>

        <nav className="layout-nav">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-item ${activePage === item.key ? 'active' : ''}`}
              onClick={() => onNavigate(item.key)}
              title={`权限码 ${item.code}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-text">
                <span className="nav-label">{item.label}</span>
                <span className="nav-desc">{item.desc}</span>
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <div className="nav-empty">当前账号没有任何菜单权限，请联系管理员分配。</div>
          )}
        </nav>

        <div className="layout-footer">
          <div className="layout-user">
            <div className="user-avatar">{displayName.slice(-2)}</div>
            <div className="user-meta">
              <div className="user-name">{displayName}</div>
              <div className="user-roles">{roleNames.length ? roleNames.join(' / ') : '—'}</div>
            </div>
          </div>
          <button type="button" className="layout-logout" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </aside>

      <main className="layout-main">{children}</main>
    </div>
  );
};

export default Layout;
