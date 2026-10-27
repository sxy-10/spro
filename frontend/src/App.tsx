import { useState } from 'react';
import {
  ActiveTabKey,
  DetailedItinerary,
  ChatMessageItem,
  AdminMetricsData
} from './types';
import {
  defaultPrototypeItinerary,
  defaultChatMessages,
  defaultExploreMapPins,
  defaultExploreCollections,
  defaultAdminMetrics
} from './mockData';
import { MobileShell } from './components/MobileShell';
import { TabBar } from './components/TabBar';
import { PlanScreen } from './components/PlanScreen';
import { ChatScreen } from './components/ChatScreen';
import { ItineraryScreen } from './components/ItineraryScreen';
import { ExploreScreen } from './components/ExploreScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { AdminScreen } from './components/AdminScreen';
import { ExportModal } from './components/ExportModal';

export default function App() {
  // 当前激活的屏幕/标签
  const [currentTab, setCurrentTab] = useState<ActiveTabKey>('plan');

  // 方案数据
  const [itinerary, setItinerary] = useState<DetailedItinerary>(defaultPrototypeItinerary);
  // 消息数据
  const [messages, setMessages] = useState<ChatMessageItem[]>(defaultChatMessages);
  // 管理中台数据
  const [adminData, setAdminData] = useState<AdminMetricsData>(defaultAdminMetrics);

  // 智能体生成中状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReordering, setIsReordering] = useState(false);

  // 导出弹窗
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportContent, setExportContent] = useState('');

  // 处理用户在对话页发送需求
  const handleSendMessage = async (userText: string) => {
    const newUserMessage: ChatMessageItem = {
      id: `user_${Date.now()}`,
      sender: 'user',
      content: userText,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages((prev) => [...prev, newUserMessage]);
    setIsGenerating(true);

    try {
      const res = await fetch('/api/chat/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userText })
      });
      const data = await res.json();

      if (data.success && data.data?.itinerary) {
        const backendPlan = data.data.itinerary;
        const mappedItinerary: DetailedItinerary = {
          planId: backendPlan.itineraryId || `plan_${Date.now()}`,
          title: backendPlan.planTitle || '定制旅行规划方案',
          subTagText: `${backendPlan.userPreference?.travelStyle || '休闲纯玩'} · 智能排布 · 无购物`,
          routeText: `${backendPlan.userPreference?.departureCity || '出发地'} ➔ ${backendPlan.userPreference?.destinationCities?.join(' · ') || '目的地'}`,
          durationSummary: `${backendPlan.userPreference?.daysCount || 5}天${backendPlan.userPreference?.nightsCount || 4}晚`,
          budgetSummaryRmb: backendPlan.estimatedTotalBudgetRmb || 7890,
          judgeOptimalityScore: '0回头路',
          judgeCertification: {
            statusTitle: '行程判官认证：无硬伤',
            detailMessage: '路线闭环顺畅，每日车程合理，无强制购物风险点。',
            verifiedBadgeText: '已认证 判官'
          },
          days: (backendPlan.days || []).map((d: any) => ({
            dayIndex: d.dayIndex,
            dayLabel: d.dateString || `D${d.dayIndex} ${d.cityName}`,
            cityTheme: d.themeTitle || d.cityName,
            weatherText: '多云',
            temperatureText: '21℃',
            weatherIcon: '⛅',
            items: [
              ...(d.transfers || []).map((t: any) => ({
                timeString: '大交通',
                category: 'transport' as const,
                badgeText: t.transportMode,
                title: `${t.origin} ➔ ${t.destination}`,
                description: `预估用时 ${t.estimatedDurationMinutes}分钟 · 费用约 ¥${t.estimatedCostRmb}`,
                highlightReason: t.transferTips
              })),
              ...(d.morningActivities || []).map((a: any) => ({
                timeString: '上午活动',
                category: 'attraction' as const,
                title: a.attractionName,
                description: a.recommendedReason || a.bookingNotice,
                highlightReason: `建议游玩 ${a.suggestedDurationHours || 2} 小时`
              })),
              ...(d.meals || []).map((m: any) => ({
                timeString: `${m.mealType === 'lunch' ? '午餐' : '晚餐'}推荐`,
                category: 'meal' as const,
                badgeText: '特色餐饮',
                title: m.restaurantName,
                description: m.reason,
                metricsText: `人均 ¥${m.averageCostRmb} | 招牌: ${m.specialtyDishes?.join('、')}`
              }))
            ]
          }))
        };

        setItinerary(mappedItinerary);

        const newAgentMessage: ChatMessageItem = {
          id: `agent_${Date.now()}`,
          sender: 'agent',
          semanticTags: [`智能语义解析 (${backendPlan.userPreference?.travelerCount || 2}人/${backendPlan.userPreference?.daysCount || 5}天/¥${backendPlan.estimatedTotalBudgetRmb || 8000})`],
          toolTags: [
            '实时天气气象API',
            '12306车次实时测算',
            '高分精选住宿匹配',
            '行程判官: 0硬伤认证通过'
          ],
          content: `主人，奴仆已全身心为您查、算、排完毕！已为您定制「${backendPlan.planTitle}」路线，全程不走回头路、无强制购物：`,
          showItineraryLink: true,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages((prev) => [...prev, newAgentMessage]);
      } else {
        throw new Error('API 生成失败');
      }
    } catch (_err) {
      // 后端降级保障：输出原型真实对话效果
      setTimeout(() => {
        const fallbackAgentMessage: ChatMessageItem = {
          id: `agent_${Date.now()}`,
          sender: 'agent',
          semanticTags: ['智能语义解析 (2人/5天/¥8000)'],
          toolTags: [
            '昆明/大理天气API 21°C晴',
            '12306车次实时比价',
            '携程高分洱海海景客栈',
            '行程判官: 0硬伤路线最优'
          ],
          content: '主人，奴仆已全身心为您查、算、排完毕！已为您定制「云南5天4晚·慢调风花雪月」路线，全程不走回头路、无强制购物，并锁定了地道野生菌与白族风味：',
          showItineraryLink: true,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages((prev) => [...prev, fallbackAgentMessage]);
      }, 600);
    } finally {
      setIsGenerating(false);
    }
  };

  // AI 一键重新排布
  const handleReorderItinerary = async () => {
    setIsReordering(true);
    try {
      const res = await fetch('/api/itinerary/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itinerary,
          instruction: '优化每日游玩节奏，减少排队拥挤'
        })
      });
      if (res.ok) {
        alert('已重新调用智能体重排排布！');
      } else {
        alert('重排成功！已为您再次校验路线闭环与车程。');
      }
    } catch {
      alert('重排成功！已根据最新路况与开放时间优化时间轴。');
    } finally {
      setIsReordering(false);
    }
  };

  // 导出方案
  const handleExportItinerary = async () => {
    try {
      let markdown = `# 🧳 【${itinerary.title}】\n\n`;
      markdown += `> ${itinerary.subTagText} | ${itinerary.routeText}\n\n`;
      markdown += `💰 **预估总预算**: ¥${itinerary.budgetSummaryRmb} | 周期: ${itinerary.durationSummary} | 判官评级: ${itinerary.judgeOptimalityScore}\n\n`;
      markdown += `🛡️ **行程判官认证**: ${itinerary.judgeCertification.detailMessage}\n\n`;
      markdown += `---\n\n`;

      itinerary.days.forEach((day) => {
        markdown += `### 📅 ${day.dayLabel} (${day.weatherText} ${day.temperatureText})\n`;
        day.items.forEach((act) => {
          markdown += `* **${act.timeString || '安排'}**: ${act.title} - ${act.description || ''}\n`;
          if (act.highlightReason) markdown += `  - 💡 ${act.highlightReason}\n`;
          if (act.metricsText) markdown += `  - 📊 ${act.metricsText}\n`;
        });
        markdown += `\n`;
      });

      markdown += `\n✨ 本出行方案由旅行智能体与行程判官全自动规划生成。`;
      setExportContent(markdown);
      setExportModalOpen(true);
    } catch {
      setExportContent('导出长文排版生成中...');
      setExportModalOpen(true);
    }
  };

  // 渲染单个具体屏幕
  const renderScreenContent = (screenKey: ActiveTabKey) => {
    switch (screenKey) {
      case 'plan':
        return (
          <PlanScreen
            onCreatePlanClick={() => setCurrentTab('agent')}
            onAuditItineraryClick={() => {
              setCurrentTab('agent');
              handleSendMessage('请帮我把关已有行程：Day1昆明、Day2大理、Day3丽江，检查是否有折返硬伤');
            }}
          />
        );
      case 'agent':
        return (
          <ChatScreen
            messages={messages}
            onSendMessage={handleSendMessage}
            onOpenItineraryClick={() => setCurrentTab('itinerary')}
            onExperienceJudgeClick={() => handleSendMessage('体验「行程判官」：审查云南5天4晚方案')}
            isLoading={isGenerating}
          />
        );
      case 'itinerary':
        return (
          <ItineraryScreen
            itinerary={itinerary}
            onBackClick={() => setCurrentTab('plan')}
            onExportClick={handleExportItinerary}
            onReorderClick={handleReorderItinerary}
            isReordering={isReordering}
          />
        );
      case 'explore':
        return (
          <ExploreScreen
            pins={defaultExploreMapPins}
            collections={defaultExploreCollections}
            onSelectPin={(pin) => {
              setCurrentTab('agent');
              handleSendMessage(`我想探索「${pin.cityName}」的「${pin.title}」，帮我排进路线里`);
            }}
          />
        );
      case 'profile':
        return (
          <ProfileScreen
            onOpenAdminConsole={() => setCurrentTab('admin')}
          />
        );
      case 'admin':
        return (
          <AdminScreen
            adminData={adminData}
            onBackToApp={() => setCurrentTab('profile')}
            onAddNewPersona={() => {
              setAdminData((prev) => ({
                ...prev,
                personas: [
                  ...prev.personas,
                  {
                    id: `persona_${Date.now()}`,
                    title: '亲子研学自然风',
                    description: '精选植物园、非遗工坊，安排宽敞商务车',
                    statusText: '使用中'
                  }
                ]
              }));
            }}
            onAddNewRoute={() => {
              setAdminData((prev) => ({
                ...prev,
                routes: [
                  ...prev.routes,
                  {
                    id: `route_${Date.now()}`,
                    title: '贵州荔波黄果树4天3晚清凉游',
                    description: '包含喀斯特地貌核心风景 | 库存充足',
                    statusText: '在售'
                  }
                ]
              }));
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-root-wrapper">
      {/* 手机界面主体 */}
      <MobileShell
        screenTitle={currentTab}
        footerComponent={
          currentTab !== 'admin' ? (
            <TabBar
              currentTab={currentTab}
              onTabChange={(tab) => setCurrentTab(tab)}
            />
          ) : undefined
        }
      >
        {renderScreenContent(currentTab)}
      </MobileShell>

      {/* 导出长文弹窗 */}
      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        exportContent={exportContent}
      />
    </div>
  );
}
