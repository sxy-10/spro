import React from 'react';
import { ActiveTabKey } from '../types';

interface TabBarProps {
  currentTab: ActiveTabKey;
  onTabChange: (selectedTab: ActiveTabKey) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ currentTab, onTabChange }) => {
  const tabItemList: Array<{ key: ActiveTabKey; label: string; iconType: string }> = [
    { key: 'plan', label: '计划', iconType: 'home' },
    { key: 'itinerary', label: '行程', iconType: 'calendar' },
    { key: 'agent', label: '智能体', iconType: 'sparkles' },
    { key: 'explore', label: '探索', iconType: 'compass' },
    { key: 'profile', label: '我的', iconType: 'user' }
  ];

  return (
    <nav className="tabbar-container" aria-label="应用底部导航栏">
      {tabItemList.map((item) => {
        const isActive = currentTab === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={`tabbar-item-btn ${isActive ? 'tabbar-item-active' : ''}`}
            onClick={() => onTabChange(item.key)}
          >
            <div className="tabbar-icon-box">
              {item.iconType === 'home' && (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              )}
              {item.iconType === 'calendar' && (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              )}
              {item.iconType === 'sparkles' && (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l2.4 6.8L21 10.5l-5.6 4.3 1.9 7.2L12 17.8l-5.3 4.2 1.9-7.2L3 10.5l6.6-1.7L12 2z"></path>
                </svg>
              )}
              {item.iconType === 'compass' && (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                </svg>
              )}
              {item.iconType === 'user' && (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              )}
            </div>
            <span className="tabbar-label-text">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
