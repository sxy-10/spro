import React from 'react';
import { ActiveTabKey } from '../types';
import type { TabDescriptor } from '../lib/menuTabs';
import { Icon } from './Icon';

interface TabBarProps {
  currentTab: ActiveTabKey;
  onTabChange: (selectedTab: ActiveTabKey) => void;
  /**
   * 组员5：可见 Tab 由后端 menus 折算（deriveVisibleTabs）后传入，
   * 组件内部不再硬编码五项目录，也不读取任何角色名。
   */
  tabs: readonly TabDescriptor[];
}

export const TabBar: React.FC<TabBarProps> = ({ currentTab, onTabChange, tabs }) => {
  return (
    <nav className="tabbar-container" aria-label="应用底部导航栏" data-tab-count={tabs.length}>
      {tabs.map((item) => {
        const isActive = currentTab === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={`tabbar-item-btn ${isActive ? 'tabbar-item-active' : ''}`}
            onClick={() => onTabChange(item.key)}
          >
            <div className="tabbar-icon-box">
              <Icon name={item.icon} size={22} active={isActive} />
            </div>
            <span className="tabbar-label-text">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
