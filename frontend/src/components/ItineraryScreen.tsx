import React, { useState } from 'react';
import { DetailedItinerary } from '../types';

interface ItineraryScreenProps {
  itinerary: DetailedItinerary;
  onBackClick: () => void;
  onExportClick: () => void;
  onReorderClick: () => void;
  isReordering?: boolean;
}

export const ItineraryScreen: React.FC<ItineraryScreenProps> = ({
  itinerary,
  onBackClick,
  onExportClick,
  onReorderClick,
  isReordering = false
}) => {
  // 默认选中 D2（正如原型图所呈现的高亮状态）
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(2);

  const activeDaySchedule = itinerary.days.find(
    (day) => day.dayIndex === selectedDayIndex
  ) || itinerary.days[0];

  return (
    <div className="screen-itinerary-container">
      {/* 顶部导航栏 */}
      <div className="itinerary-top-navbar">
        <button type="button" className="btn-nav-back" onClick={onBackClick}>
          <span className="back-arrow-symbol">←</span>
          <span>返回</span>
        </button>
        <div className="itinerary-screen-title">{itinerary.title}</div>
        <div className="itinerary-nav-actions">
          <button type="button" className="btn-nav-action-text" onClick={onExportClick}>
            导出
          </button>
          <button type="button" className="btn-nav-action-text">
            编辑
          </button>
        </div>
      </div>

      {/* 核心可滚动区 */}
      <div className="itinerary-scroll-area">
        {/* 墨绿色方案概览卡片 */}
        <div className="itinerary-hero-card">
          <div className="hero-subtag-text">{itinerary.subTagText}</div>
          <div className="hero-route-title">{itinerary.routeText}</div>

          <div className="hero-metrics-columns">
            <div className="metric-col-item">
              <div className="metric-value-text">{itinerary.durationSummary}</div>
              <div className="metric-label-text">时间周期</div>
            </div>
            <div className="metric-col-item">
              <div className="metric-value-text">¥{itinerary.budgetSummaryRmb.toLocaleString()}</div>
              <div className="metric-label-text">总预算 (未超支)</div>
            </div>
            <div className="metric-col-item">
              <div className="metric-value-text">{itinerary.judgeOptimalityScore}</div>
              <div className="metric-label-text">判官合理度 100%</div>
            </div>
          </div>
        </div>

        {/* 行程判官认证条 */}
        <div className="judge-verified-card">
          <div className="judge-verified-left">
            <div className="judge-verified-title">
              <span className="shield-icon">🛡️</span>
              <span>{itinerary.judgeCertification.statusTitle}</span>
            </div>
            <div className="judge-verified-desc">
              {itinerary.judgeCertification.detailMessage}
            </div>
          </div>
          <div className="judge-stamp-badge">
            <div className="stamp-inner-text">已认证</div>
            <div className="stamp-sub-text">判官</div>
          </div>
        </div>

        {/* 天数导航胶囊 Tab 条 */}
        <div className="day-tabs-slider">
          {itinerary.days.map((day) => {
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
          {activeDaySchedule.items.map((item, idx) => (
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
          ))}
        </div>
      </div>

      {/* 底部悬浮操作按钮条 */}
      <div className="itinerary-bottom-floating-bar">
        <button
          type="button"
          className="btn-ai-reorder"
          onClick={onReorderClick}
          disabled={isReordering}
        >
          <span className="ai-wand-icon">✨</span>
          <span>{isReordering ? '正在重排排布...' : 'AI 一键重新排布'}</span>
        </button>
        <button
          type="button"
          className="btn-export-secondary"
          onClick={onExportClick}
        >
          导出方案
        </button>
      </div>
    </div>
  );
};
