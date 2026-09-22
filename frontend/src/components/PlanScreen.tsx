import React from 'react';

interface PlanScreenProps {
  onCreatePlanClick: () => void;
  onAuditItineraryClick: () => void;
}

export const PlanScreen: React.FC<PlanScreenProps> = ({
  onCreatePlanClick,
  onAuditItineraryClick
}) => {
  return (
    <div className="screen-plan-container">
      {/* 顶部新建胶囊 */}
      <div className="plan-top-action-bar">
        <button type="button" className="btn-new-capsule" onClick={onCreatePlanClick}>
          <span className="plus-symbol">+</span>
          <span>新建</span>
        </button>
      </div>

      {/* 大标语文案 */}
      <div className="plan-hero-title-box">
        <h1 className="plan-main-title">
          从远方到楼下，都按你的品味挑过了
        </h1>
      </div>

      {/* 灵感卡片 */}
      <div className="plan-showcase-card" onClick={onCreatePlanClick}>
        <div className="showcase-card-header">
          <div className="showcase-title">科隆1日游不走回头路</div>
          <div className="showcase-subtitle">1天9晚 9个地点</div>
        </div>
        <div className="showcase-card-cover">
          <div className="cover-nature-overlay">
            <span className="cover-badge-text">科隆 · 一日游</span>
          </div>
        </div>
      </div>

      {/* 引导文案与核心按钮 */}
      <div className="plan-bottom-action-area">
        <div className="plan-guide-texts">
          <p className="guide-line">还没计划？带你省心做</p>
          <p className="guide-line">已有行程？帮你把关</p>
        </div>

        <div className="plan-button-group">
          <button
            type="button"
            className="btn-green-solid"
            onClick={onCreatePlanClick}
          >
            输入目的地，创建行程
          </button>
          <button
            type="button"
            className="btn-green-outline"
            onClick={onAuditItineraryClick}
          >
            导入行程，检查硬伤 (行程判官)
          </button>
        </div>
      </div>
    </div>
  );
};
