import React, { useEffect, useState } from 'react';
import { DetailedItinerary } from '../types';

interface ItineraryScreenProps {
  itinerary: DetailedItinerary;
  onBackClick: () => void;
  onExportClick: () => void;
  onReorderClick: () => void;
  onSaveEdit?: (updated: { title: string; budgetSummaryRmb: number; subTagText: string }) => void;
  isReordering?: boolean;
}

export const ItineraryScreen: React.FC<ItineraryScreenProps> = ({
  itinerary,
  onBackClick,
  onExportClick,
  onReorderClick,
  onSaveEdit,
  isReordering = false
}) => {
  // 初始优先选中 D2（原型设计默认高亮），若该方案无 D2 则自动对齐到首个可用天
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(() => {
    const days = itinerary?.days ?? [];
    if (days.some((d) => d.dayIndex === 2)) return 2;
    return days[0]?.dayIndex ?? 1;
  });

  // 监听行程切换，确保选中的天数在当前行程的合法区间内
  useEffect(() => {
    const days = itinerary?.days ?? [];
    if (days.length > 0 && !days.some((d) => d.dayIndex === selectedDayIndex)) {
      setSelectedDayIndex(days[0]?.dayIndex ?? 1);
    }
  }, [itinerary, selectedDayIndex]);

  // 编辑行程信息弹窗状态
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(itinerary?.title || '');
  const [editBudget, setEditBudget] = useState(String(itinerary?.budgetSummaryRmb || 7890));
  const [editSubTag, setEditSubTag] = useState(itinerary?.subTagText || '');

  useEffect(() => {
    setEditTitle(itinerary?.title || '');
    setEditBudget(String(itinerary?.budgetSummaryRmb || 7890));
    setEditSubTag(itinerary?.subTagText || '');
  }, [itinerary]);

  const handleOpenEdit = () => {
    setEditTitle(itinerary?.title || '');
    setEditBudget(String(itinerary?.budgetSummaryRmb || 7890));
    setEditSubTag(itinerary?.subTagText || '');
    setIsEditing(true);
  };

  const handleSaveEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSaveEdit) {
      onSaveEdit({
        title: editTitle.trim() || itinerary.title,
        budgetSummaryRmb: Number(editBudget) || itinerary.budgetSummaryRmb,
        subTagText: editSubTag.trim() || itinerary.subTagText
      });
    }
    setIsEditing(false);
  };

  const safeDays = itinerary?.days ?? [];

  const activeDaySchedule = safeDays.find(
    (day) => day.dayIndex === selectedDayIndex
  ) || safeDays[0];

  return (
    <div className="screen-itinerary-container">
      {/* 顶部导航栏 */}
      <div className="itinerary-top-navbar">
        <button type="button" className="btn-nav-back" onClick={onBackClick}>
          <span className="back-arrow-symbol">←</span>
          <span>返回</span>
        </button>
        <div className="itinerary-screen-title">{itinerary?.title || '旅行规划方案'}</div>
        <div className="itinerary-nav-actions">
          <button type="button" className="btn-nav-action-text" onClick={onExportClick}>导出</button>
          <button type="button" className="btn-nav-action-text" onClick={handleOpenEdit}>
            编辑
          </button>
        </div>
      </div>

      {/* 核心可滚动区 */}
      <div className="itinerary-scroll-area">
        {/* 墨绿色方案概览卡片 */}
        <div className="itinerary-hero-card">
          <div className="hero-subtag-text">{itinerary?.subTagText}</div>
          <div className="hero-route-title">{itinerary?.routeText}</div>

          <div className="hero-metrics-columns">
            <div className="metric-col-item">
              <div className="metric-value-text">{itinerary?.durationSummary || '5天4晚'}</div>
              <div className="metric-label-text">时间周期</div>
            </div>
            <div className="metric-col-item">
              <div className="metric-value-text">¥{(itinerary?.budgetSummaryRmb ?? 0).toLocaleString()}</div>
              <div className="metric-label-text">总预算 (未超支)</div>
            </div>
            <div className="metric-col-item">
              <div className="metric-value-text">{itinerary?.judgeOptimalityScore || '0回头路'}</div>
              <div className="metric-label-text">判官合理度 100%</div>
            </div>
          </div>
        </div>

        {/* 行程判官认证条 */}
        <div className="judge-verified-card">
          <div className="judge-verified-left">
            <div className="judge-verified-title">
              <span className="shield-icon">🛡️</span>
              <span>{itinerary?.judgeCertification?.statusTitle || '行程判官认证：无硬伤'}</span>
            </div>
            <div className="judge-verified-desc">
              {itinerary?.judgeCertification?.detailMessage || '路线闭环顺畅，无折返拉扯。'}
            </div>
          </div>
          <div className="judge-stamp-badge">
            <div className="stamp-inner-text">已认证</div>
            <div className="stamp-sub-text">判官</div>
          </div>
        </div>

        {/* 天数导航胶囊 Tab 条 */}
        <div className="day-tabs-slider">
          {safeDays.map((day) => {
            const isDayActive = day.dayIndex === selectedDayIndex;
            return (
              <button
                key={day.dayIndex}
                type="button"
                className={`day-tab-pill ${isDayActive ? 'day-tab-pill-active' : ''}`}
                onClick={() => setSelectedDayIndex(day.dayIndex)}
              >
                <span className="pill-title">{day.dayLabel}</span>
                <span className="pill-weather">
                  ({day.temperatureText} {day.weatherIcon})
                </span>
              </button>
            );
          })}
        </div>

        {/* 当日日程时间轴列表 */}
        <div className="day-schedule-timeline">
          {activeDaySchedule?.items?.map((item, idx) => (
            <div key={idx} className="timeline-schedule-card">
              <div className="card-top-header">
                <span className="schedule-time-tag">{item.timeString}</span>
                {item.badgeText && (
                  <span className="schedule-type-badge">{item.badgeText}</span>
                )}
              </div>

              <div className="schedule-main-name">{item.title}</div>

              {item.description && (
                <div className="schedule-detail-desc">{item.description}</div>
              )}

              {item.highlightReason && (
                <div className="schedule-sub-box highlight-box">
                  <span className="sub-box-text">{item.highlightReason}</span>
                </div>
              )}

              {item.metricsText && (
                <div className="schedule-sub-box metrics-box">
                  <span className="sub-box-text">{item.metricsText}</span>
                </div>
              )}
            </div>
          )) ?? (
            <div className="timeline-schedule-card">
              <div className="schedule-detail-desc">该天暂无具体排期明细。</div>
            </div>
          )}
        </div>
      </div>

      {/* 底部悬浮操作按钮条 */}
      <div className="itinerary-bottom-floating-bar">
        <button type="button" className="btn-ai-reorder" onClick={onReorderClick} disabled={isReordering}>
          <span className="ai-wand-icon">✨</span>
          <span>{isReordering ? '正在重排排布...' : 'AI 一键重新排布'}</span>
        </button>
        <button type="button" className="btn-export-secondary" onClick={onExportClick}>
          导出方案
        </button>
      </div>

      {/* 行程编辑弹窗 */}
      {isEditing && (
        <div className="itinerary-edit-modal-backdrop" onClick={() => setIsEditing(false)}>
          <div className="itinerary-edit-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-header">
              <h3 className="edit-modal-title">编辑行程方案信息</h3>
              <button type="button" className="btn-close-edit-modal" onClick={() => setIsEditing(false)}>
                ✕
              </button>
            </div>

            <form className="edit-modal-form" onSubmit={handleSaveEditSubmit}>
              <div className="edit-modal-field">
                <label className="edit-modal-label">方案标题</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="booking-input"
                  placeholder="请输入方案标题"
                  required
                />
              </div>

              <div className="edit-modal-field">
                <label className="edit-modal-label">预算金额 (RMB)</label>
                <input
                  type="number"
                  value={editBudget}
                  onChange={(e) => setEditBudget(e.target.value)}
                  className="booking-input"
                  placeholder="预估总预算"
                />
              </div>

              <div className="edit-modal-field">
                <label className="edit-modal-label">旅行标签 / 风格副标</label>
                <input
                  type="text"
                  value={editSubTag}
                  onChange={(e) => setEditSubTag(e.target.value)}
                  className="booking-input"
                  placeholder="例如：自由行 · 慢调度假 · 无购物"
                />
              </div>

              <button type="submit" className="booking-submit-button" style={{ marginTop: '8px' }}>
                保存修改
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
