import React from 'react';

interface ProfileScreenProps {
  onOpenAdminConsole: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onOpenAdminConsole }) => {
  return (
    <div className="screen-profile-container">
      {/* 顶部标题栏 */}
      <div className="profile-top-header">
        <h2 className="profile-header-title">我的</h2>
        <button type="button" className="nav-icon-button" aria-label="设置菜单">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
      </div>

      {/* 用户基本信息名片 */}
      <div className="profile-user-card">
        <div className="user-avatar-circle">
          <span>C</span>
        </div>
        <div className="user-text-info">
          <div className="user-nickname">C</div>
          <div className="user-membership-badge">智能体验深度定制会员</div>
        </div>
      </div>

      {/* 收藏与订阅双统计卡片 */}
      <div className="profile-stats-grid">
        <div className="stat-pill-card">
          <div className="stat-title-label">我的收藏</div>
          <div className="stat-count-sub">收藏夹 · 8</div>
        </div>
        <div className="stat-pill-card">
          <div className="stat-title-label">我的订阅</div>
          <div className="stat-count-sub">话题夹 · 2</div>
        </div>
      </div>

      {/* 我的足迹卡片 */}
      <div className="profile-footprint-card">
        <div className="card-inner-header">
          <div className="footprint-main-title">我的足迹</div>
          <div className="footprint-subtitle">去过 1 个国家，6 个城市</div>
        </div>

        <div className="footprint-tags-row">
          <span className="country-flag-icon">🇨🇳</span>
          <div className="provinces-chips">
            <span className="province-chip">四川</span>
            <span className="chip-dot">·</span>
            <span className="province-chip">云南</span>
            <span className="chip-dot">·</span>
            <span className="province-chip">西藏</span>
            <span className="chip-dot">·</span>
            <span className="province-chip">贵州</span>
          </div>
        </div>
      </div>

      {/* 我的采集卡片 */}
      <div className="profile-collection-card">
        <div className="collection-card-title">我的采集 · 3</div>
        <div className="collection-card-desc">
          冬日门票、手绘贴纸与行程凭据已妥善归档
        </div>
      </div>

      {/* 管理中台快捷入口 */}
      <div className="profile-admin-entrance-card" onClick={onOpenAdminConsole}>
        <div className="admin-entrance-left">
          <div className="entrance-title">旅行社智能体管理中台</div>
          <div className="entrance-desc">查看全网行程并发、转化漏斗与人设引擎</div>
        </div>
        <div className="entrance-arrow">➔</div>
      </div>
    </div>
  );
};
