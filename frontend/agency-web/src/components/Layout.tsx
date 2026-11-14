/**
 * 主框架：左侧导航（8 个页面）+ 顶栏（面包屑 + 用户信息/退出）。
 * 菜单结构固定为任务清单的 8 个页面；旅游产品管理含线路/特产两个子页签。
 */
import { useState, type ReactNode } from 'react';
import { logout } from '../api/admin';
import { toast } from './ui';
import type { MeProfile } from '../types';

export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
}

const I = (d: string) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '工作台', icon: I('M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z') },
  { key: 'planner', label: 'AI智能规划', icon: I('M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z') },
  { key: 'products', label: '旅游产品管理', icon: I('M4 7h16M4 7l2-3h12l2 3M4 7v12a1 1 0 001 1h14a1 1 0 001-1V7M9 12h6') },
  { key: 'orders', label: '订单管理', icon: I('M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6') },
  { key: 'customers', label: '客户管理', icon: I('M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75') },
  { key: 'guides', label: '导游与团队管理', icon: I('M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75') },
  { key: 'finance', label: '财务管理', icon: I('M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6') },
  { key: 'settings', label: '旅行社设置', icon: I('M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09A1.65 1.65 0 003.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008 3.6h.09A1.65 1.65 0 0010 2.09V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z') }
];

export function Layout(props: { me: MeProfile | null; current: string; onNavigate: (key: string) => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const currentLabel = NAV_ITEMS.find((item) => item.key === props.current)?.label ?? '';
  const nickname = props.me?.nickname?.trim() || '管理员';
  const roleName = props.me?.roles?.[0]?.name ?? '旅行社管理员';

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* 后端撤销失败也不阻断退出：本地清会话即可 */
    }
    toast.info('已退出登录');
    window.location.hash = '#/login';
    // 让 App 的会话订阅触发回登录页
    window.dispatchEvent(new CustomEvent('agency:logout'));
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">旅</div>
          {!collapsed && (
            <div className="sidebar-brand-text">
              <b>智能旅游规划平台</b>
              <span>旅行社管理系统</span>
            </div>
          )}
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${props.current === item.key ? 'active' : ''}`}
              onClick={() => props.onNavigate(item.key)}
              title={item.label}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="sidebar-collapse" onClick={() => setCollapsed((value) => !value)}>
            « {!collapsed && <span>收起菜单</span>}
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            工作台 <span>/</span> <b>{currentLabel}</b>
          </div>
          <div className="topbar-right">
            <div className="user-chip">
              <div className="avatar">{nickname.slice(0, 1)}</div>
              <div className="user-meta">
                <b>{nickname}</b>
                <span>{roleName}</span>
              </div>
            </div>
            <button className="btn ghost sm" onClick={handleLogout}>退出</button>
          </div>
        </header>
        <main className="content">{props.children}</main>
      </div>
    </div>
  );
}
