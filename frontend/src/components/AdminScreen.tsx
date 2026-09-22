import React from 'react';
import { AdminMetricsData } from '../types';

interface AdminScreenProps {
  adminData: AdminMetricsData;
  onBackToApp?: () => void;
  onAddNewPersona?: () => void;
  onAddNewRoute?: () => void;
}

export const AdminScreen: React.FC<AdminScreenProps> = ({
  adminData,
  onBackToApp,
  onAddNewPersona,
  onAddNewRoute
}) => {
  return (
    <div className="screen-admin-container">
      {/* 顶部标题与运行状态指示 */}
      <div className="admin-top-header">
        <div className="admin-header-title-box">
          {onBackToApp && (
            <button type="button" className="btn-back-inline" onClick={onBackToApp} aria-label="返回">
              ←
            </button>
          )}
          <h2 className="admin-header-title">旅行社智能体管理中台</h2>
        </div>
        <div className="admin-running-badge">
          <span className="pulsing-green-dot"></span>
          <span>运行正常</span>
        </div>
      </div>

      {/* 核心双数据指标看板 */}
      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="kpi-icon-bell">🔔</div>
          <div className="kpi-main-number">{adminData.todayPlanCount.toLocaleString()}</div>
          <div className="kpi-sub-label">今日AI生成行程单数</div>
        </div>

        <div className="admin-kpi-card">
          <div className="kpi-empty-header-space"></div>
          <div className="kpi-main-number">{adminData.conversionRatePercent}%</div>
          <div className="kpi-sub-label">成单转化率 (+{adminData.conversionRateDiffPercent}%)</div>
        </div>
      </div>

      {/* 模块 1：智能体人设与风控引擎 */}
      <div className="admin-section-block">
        <div className="section-title-row">
          <h3 className="section-title">智能体人设与风控引擎</h3>
          <button type="button" className="btn-section-action" onClick={onAddNewPersona}>
            + 新增
          </button>
        </div>

        <div className="admin-item-cards-list">
          {adminData.personas.map((persona) => (
            <div key={persona.id} className="admin-entity-card">
              <div className="entity-card-content">
                <div className="entity-card-title">{persona.title}</div>
                <div className="entity-card-desc">{persona.description}</div>
              </div>
              <button type="button" className="btn-status-pill-solid">
                {persona.statusText}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 模块 2：线路库与产品快速上架 */}
      <div className="admin-section-block">
        <div className="section-title-row">
          <h3 className="section-title">线路库与产品快速上架</h3>
          <button type="button" className="btn-section-action" onClick={onAddNewRoute}>
            + 上架新路线
          </button>
        </div>

        <div className="admin-item-cards-list">
          {adminData.routes.map((route) => (
            <div key={route.id} className="admin-entity-card">
              <div className="entity-card-content">
                <div className="entity-card-title">{route.title}</div>
                <div className="entity-card-desc">{route.description}</div>
              </div>
              <button type="button" className="btn-status-pill-outline">
                {route.statusText}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
