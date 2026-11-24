import React, { useState } from 'react';
import { Icon } from './Icon';

/** 精选案例展示项元数据 */
export interface ShowcaseRouteItem {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  destination: string;
  days: number;
  spotsCount: number;
  judgeHighlight: string;
}

/** 默认精选案例清单（含爆款：科隆1日游不走回头路） */
export const DEFAULT_SHOWCASE_ROUTES: readonly ShowcaseRouteItem[] = [
  {
    id: 'cologne_1day',
    title: '科隆1日游不走回头路',
    subtitle: '1天0晚 · 9个地点 · 0折返硬伤',
    badge: '科隆 · 一日游',
    destination: '科隆',
    days: 1,
    spotsCount: 9,
    judgeHighlight: '单向动线闭环 · 全天0回头路'
  }
] as const;

export interface PlanScreenProps {
  /** 顶部快捷新建：点击右上角「+ 新建」直接唤起智能体开启新行程定制 */
  onQuickNewPlanClick?: () => void;
  /** 标语文案与灵感卡片：展示如「科隆1日游不走回头路」等精选案例，点击卡片直接切入方案生成流程 */
  onSelectShowcaseRoute?: (route: ShowcaseRouteItem) => void;
  /** 双核心行动入口之一：「输入目的地，创建行程」一键跳转到【智能体】对话页，引导用户输入行程诉求 */
  onInputDestinationClick?: () => void;
  /** 双核心行动入口之二：「导入行程，检查硬伤 (行程判官)」调起判官算法，自动发送行程诊断指令 */
  onAuditItineraryClick?: () => void;
  /** 兼容历史属性别名 */
  onCreatePlanClick?: () => void;
}

export const PlanScreen: React.FC<PlanScreenProps> = ({
  onQuickNewPlanClick,
  onSelectShowcaseRoute,
  onInputDestinationClick,
  onAuditItineraryClick,
  onCreatePlanClick
}) => {
  const [activeShowcaseIndex] = useState<number>(0);
  const currentShowcase = DEFAULT_SHOWCASE_ROUTES[activeShowcaseIndex] ?? DEFAULT_SHOWCASE_ROUTES[0];

  /** 处理右上角「+ 新建」点击 */
  const handleQuickNewPlan = () => {
    if (onQuickNewPlanClick) {
      onQuickNewPlanClick();
    } else if (onCreatePlanClick) {
      onCreatePlanClick();
    }
  };

  /** 处理点击精选案例灵感卡片，直接切入方案生成流程 */
  const handleCardClick = () => {
    if (onSelectShowcaseRoute) {
      onSelectShowcaseRoute(currentShowcase);
    } else if (onCreatePlanClick) {
      onCreatePlanClick();
    }
  };

  /** 处理点击「输入目的地，创建行程」 */
  const handleInputDestination = () => {
    if (onInputDestinationClick) {
      onInputDestinationClick();
    } else if (onCreatePlanClick) {
      onCreatePlanClick();
    }
  };

  return (
    <div className="screen-plan-container">
      {/* 顶部快捷新建：位于右上角的「+ 新建」胶囊按钮 */}
      <div className="plan-top-action-bar">
        <button
          type="button"
          className="btn-new-capsule"
          onClick={handleQuickNewPlan}
          aria-label="新建出行行程定制"
        >
          <Icon name="plus" size={15} className="plus-symbol" />
          <span>新建</span>
        </button>
      </div>

      {/* 大标语文案：从远方到楼下，都按你的品味挑过了 */}
      <div className="plan-hero-title-box">
        <h1 className="plan-main-title">
          从远方到楼下，都按你的品味挑过了
        </h1>
      </div>

      {/* 灵感卡片：展示如「科隆1日游不走回头路」等精选案例，点击卡片直接切入方案生成流程 */}
      <div
        className="plan-showcase-card"
        onClick={handleCardClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick();
          }
        }}
        aria-label={`精选案例：${currentShowcase.title}，点击立即生成方案`}
      >
        <div className="showcase-card-header">
          <div className="showcase-title-row">
            <h2 className="showcase-title">{currentShowcase.title}</h2>
            <span className="showcase-judge-score-badge">0回头路</span>
          </div>
          <div className="showcase-subtitle">{currentShowcase.subtitle}</div>
        </div>

        <div className="showcase-card-cover">
          <div className="cover-nature-overlay">
            <span className="cover-badge-text">{currentShowcase.badge}</span>
          </div>
        </div>

        <div className="showcase-card-footer">
          <div className="showcase-footer-left">
            <Icon name="shield" size={14} className="shield-icon-mini" />
            <span className="judge-text-mini">{currentShowcase.judgeHighlight}</span>
          </div>
          <span className="showcase-cutin-prompt">立即生成方案 <Icon name="arrow-right" size={13} /></span>
        </div>
      </div>

      {/* 双核心行动入口（底部引导文案与行动按钮） */}
      <div className="plan-bottom-action-area">
        <div className="plan-guide-texts">
          <p className="guide-line">还没计划？带你省心做</p>
          <p className="guide-line">已有行程？帮你把关</p>
        </div>

        <div className="plan-button-group">
          {/* 核心入口 1：「输入目的地，创建行程」一键跳转到【智能体】对话页 */}
          <button
            type="button"
            className="btn-green-solid"
            onClick={handleInputDestination}
          >
            输入目的地，创建行程
          </button>

          {/* 核心入口 2：「导入行程，检查硬伤 (行程判官)」调起判官算法，自动发送行程诊断指令 */}
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
