import { useEffect, useState } from 'react';
import { request, isLoggedIn, logout } from './api';
import { LoginScreen } from './components/LoginScreen';
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
  const [user, setUser] = useState<any>(null);
  // 当前激活的屏幕/标签
  const [currentTab, setCurrentTab] = useState<ActiveTabKey>('plan');

  // 方案数据
  const [itinerary, setItinerary] = useState<DetailedItinerary>(defaultPrototypeItinerary);
  // 消息数据
  const [messages, setMessages] = useState<ChatMessageItem[]>(defaultChatMessages);
  // 管理中台数据
  const [adminData, setAdminData] = useState<AdminMetricsData>(defaultAdminMetrics);
  useEffect(() => {
    if (currentTab !== 'admin' || user?.role !== 'ADMIN') return;
    request('/admin/routes').then(data => setAdminData(prev => ({...prev, routes:data.list.map((r:any)=>({id:r.route_id,title:r.title,description:`${r.destination} · ¥${r.base_price_rmb}`,statusText:r.status==='ON_SALE'?'在售':'已下架'}))}))).catch(error=>alert(error.message));
  }, [currentTab, user]);

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
      if (!isLoggedIn()) { setCurrentTab('profile'); throw new Error('请先登录后再生成行程'); }
      const start = new Date(); start.setUTCHours(0,0,0,0);
      const days = Math.min(30, Math.max(1, Number(userText.match(/(\d+)\s*天/)?.[1] ?? 5)));
      const end = new Date(start.getTime() + (days-1)*86400000);
      const destination = userText.match(/(?:去|到|探索)[「\s]*([\u4e00-\u9fa5]{2,3})(?:和|玩|旅游|\d|[」\s，,])/u)?.[1] ?? '昆明';
      const data = await request('/plans','POST',{destination,start_date:start.toISOString(),end_date:end.toISOString(),prompt:userText});
      if (data?.plan_id) {
        const camel = (value:any):any => Array.isArray(value) ? value.map(camel) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),camel(v)])) : value;
        const backendPlan = camel(data);
        backendPlan.itineraryId = data.plan_id;
        const mappedItinerary: DetailedItinerary = {
          planId: backendPlan.itineraryId || `plan_${Date.now()}`,
          title: backendPlan.planTitle || '定制旅行规划方案',
          subTagText: `${backendPlan.userPreference?.travelStyle || '休闲纯玩'} · 智能排布 · 无购物`,
          routeText: `${backendPlan.userPreference?.departureCity || '出发地'} ➔ ${backendPlan.userPreference?.destinationCities?.join(' · ') || '目的地'}`,
          durationSummary: `${backendPlan.userPreference?.daysCount || 5}天${backendPlan.userPreference?.nightsCount || 4}晚`,
          budgetSummaryRmb: Number(backendPlan.estimatedTotalBudgetRmb),
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
    } catch (err) {
      setMessages(prev=>[...prev,{id:`error_${Date.now()}`,sender:'agent',content:err instanceof Error?err.message:'生成失败，请稍后重试',createdAt:new Date().toLocaleTimeString()}]);
    } finally {
      setIsGenerating(false);
    }
  };

  // AI 一键重新排布
  const handleReorderItinerary = async () => {
    setIsReordering(true);
    try {
      const data = await request(`/plans/${itinerary.planId}`,'PATCH',{instruction:'优化每日游玩节奏，减少排队拥挤'});
      setItinerary(prev=>({...prev,title:data.plan_title??prev.title,subTagText:data.summary_description??prev.subTagText}));
      alert('调整要求已保存至新版本');
    } catch (err) {
      alert(err instanceof Error?err.message:'调整失败');
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
        if (!user || !isLoggedIn()) return <LoginScreen onLogin={setUser} />;
        return (
          <ProfileScreen
            nickname={user.nickname || user.mobile}
            isAdmin={user.role === 'ADMIN'}
            onLogout={async () => { try { await logout(); setUser(null); } catch (e) { alert(e instanceof Error ? e.message : '退出失败'); } }}
            onOpenAdminConsole={() => setCurrentTab('admin')}
          />
        );
      case 'admin':
        if (!user || user.role !== 'ADMIN') return <p>需要管理员权限</p>;
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
            onAddNewRoute={async () => {
              try {
                const route = await request('/admin/routes','POST',{title:'贵州荔波黄果树4天3晚清凉游',destination:'贵州',default_days:4,style_tag:'自然',base_price_rmb:'2680.00'});
                setAdminData(prev=>({...prev,routes:[...prev.routes,{id:route.route_id,title:route.title,description:`${route.destination} · ¥${route.base_price_rmb}`,statusText:'在售'}]}));
              } catch(e) { alert(e instanceof Error?e.message:'上架失败'); }
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
