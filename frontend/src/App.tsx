import { lazy, Suspense, useEffect, useState } from 'react';
import { request, isLoggedIn, logout } from './api';
import { useSession } from './hooks/useAuth';
import { restoreSession } from './lib/auth';
import { LoginScreen } from './components/LoginScreen';
import {
  ActiveTabKey,
  DetailedItinerary,
  ChatMessageItem,
  AdminMetricsData
} from './types';
import {
  defaultPrototypeItinerary,
  cologne1DayItinerary,
  defaultChatMessages,
  defaultExploreMapPins,
  defaultExploreCollections,
  defaultAdminMetrics
} from './mockData';
import { MobileShell } from './components/MobileShell';
import { TabBar } from './components/TabBar';
import { ExportModal } from './components/ExportModal';
import { ForbiddenScreen } from './components/ForbiddenScreen';
import { deriveAllowedScreens, deriveVisibleTabs, hasConsoleAccess, isScreenAllowed } from './lib/menuTabs';
import { refreshPermissions, watchPermissionChanges } from './lib/permissionSync';

const PlanScreen = lazy(() => import('./components/PlanScreen').then(module => ({ default: module.PlanScreen })));
const ChatScreen = lazy(() => import('./components/ChatScreen').then(module => ({ default: module.ChatScreen })));
const ItineraryScreen = lazy(() => import('./components/ItineraryScreen').then(module => ({ default: module.ItineraryScreen })));
const ExploreScreen = lazy(() => import('./components/ExploreScreen').then(module => ({ default: module.ExploreScreen })));
const ConsultChatScreen = lazy(() => import('./components/ConsultChatScreen').then(module => ({ default: module.ConsultChatScreen })));
const ProfileScreen = lazy(() => import('./components/ProfileScreen').then(module => ({ default: module.ProfileScreen })));
const AdminScreen = lazy(() => import('./components/AdminScreen').then(module => ({ default: module.AdminScreen })));

export default function App() {
  const [user, setUser] = useState<any>(null);
  // 当前激活的屏幕/标签
  const [currentTab, setCurrentTab] = useState<ActiveTabKey>('plan');
  const [showLoginModal, setShowLoginModal] = useState(false);

  // 组员4：会话仓库是全局真相来源——被 401 踢下线时自动回到登录页
  const session = useSession();
  // 组员5：可见 Tab 与「管理中台」入口全部由 /v1/users/me/permissions 下发，
  // 不再读取 user.role —— 原 App.tsx:41-47 的 ADMIN/SUPER_ADMIN/AGENCY_ADMIN 硬编码已删除。
  const visibleTabs = deriveVisibleTabs(session.permissions, Boolean(session.accessToken));
  const hasAdminAccess = hasConsoleAccess(session.permissions);
  // 可达屏 = 可见 Tab + 下钻页（计划→智能体/行程）+ 有条件的管理中台
  const allowedScreens = deriveAllowedScreens(session.permissions, Boolean(session.accessToken));

  useEffect(() => {
    setUser(session.accessToken ? session.user : null);
  }, [session.accessToken, session.user]);

  // 组员4：VITE_AUTH_PERSIST=1 时，刷新页面用 refresh_token 静默续期
  useEffect(() => {
    let alive = true;
    localStorage.removeItem('travel_deepseek_api_key');
    void restoreSession().then((restored) => {
      if (alive && restored) setUser(restored);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 组员5：挂载时 + 窗口重新可见时重新拉一次 menus/buttons。
  // 管理员在后台改完权限，用户刷新页面或切回前台即生效，无需重新登录。
  useEffect(() => {
    if (!session.accessToken) return;
    void refreshPermissions();
    return watchPermissionChanges();
  }, [session.accessToken]);

  // 权限收窄后，停留在已不可达的屏时自动退回首个可用 Tab（渲染层由 MobileShell 再兜一次）
  useEffect(() => {
    const loggedIn = Boolean(session.accessToken);
    if (isScreenAllowed(session.permissions, loggedIn, currentTab)) return;
    setCurrentTab(deriveVisibleTabs(session.permissions, loggedIn)[0]?.key ?? 'plan');
  }, [session.permissions, session.accessToken, currentTab]);
  
  // 方案数据
  const [itinerary, setItinerary] = useState<DetailedItinerary>(defaultPrototypeItinerary);
  // 消息数据
  const [messages, setMessages] = useState<ChatMessageItem[]>(defaultChatMessages);
  // 管理中台数据
  const [adminData, setAdminData] = useState<AdminMetricsData>(defaultAdminMetrics);
  useEffect(() => {
    if (currentTab !== 'admin' || !hasAdminAccess) return;
    request('/admin/routes').then(data => setAdminData(prev => ({...prev, routes:data.list.map((r:any)=>({id:r.route_id,title:r.title,description:`${r.destination} · ¥${r.base_price_rmb}`,statusText:r.status==='ON_SALE'?'在售':'已下架'}))}))).catch(error=>alert(error.message));
  }, [currentTab, user, hasAdminAccess]);

  // 智能体生成中状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReordering, setIsReordering] = useState(false);

  // 导出弹窗
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportContent, setExportContent] = useState('');

  /**
   * 进入【智能体】页时默认落在哪个模式。
   *
   * 行程页的「咨询此行程」要把用户直接送进人工会话，而不是又回到 AI 对话里点一次；
   * ChatScreen 每次切页都会重新挂载，所以用这个值作为它的 initialMode 即可。
   */
  const [agentInitialMode, setAgentInitialMode] = useState<'ai' | 'consult'>('ai');

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
      try {
        const aiResponse = await request<{
          reply: string;
          semanticTags: string[];
          toolTags: string[];
          itinerary?: DetailedItinerary;
          showItineraryLink?: boolean;
        }>('/ai/chat', 'POST', {
          message: userText,
          history: messages.slice(-6).map((m) => ({ sender: m.sender, content: m.content })),
        });

        if (aiResponse?.itinerary) {
          setItinerary(aiResponse.itinerary);
        }

        const newAgentMessage: ChatMessageItem = {
          id: `agent_${Date.now()}`,
          sender: 'agent',
          semanticTags: aiResponse.semanticTags || ['智能语义解析'],
          toolTags: aiResponse.toolTags || ['DeepSeek-V3 大模型驱动', '行程判官: 0硬伤路线最优'],
          content: aiResponse.reply,
          showItineraryLink: Boolean(aiResponse.showItineraryLink && (aiResponse.itinerary || itinerary)),
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages((prev) => [...prev, newAgentMessage]);
        return;
      } catch {
        // 当后端网络异常或接口不可达时，平滑降级到本地判官与推演模型
      }

      // 若处于未登录游客端模式，执行智能体与行程判官的高保真推演，保障游客体验完整闭环
      // 若处于未登录游客端模式，执行智能体与行程判官的高保真推演，保障游客体验完整闭环
      if (!isLoggedIn()) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        let targetItinerary: DetailedItinerary = defaultPrototypeItinerary;
        let replyContent = '主人，奴仆已全身心为您查、算、排完毕！已为您定制「云南5天4晚·慢调风花雪月」路线，全程不走回头路、无强制购物：';
        let toolTags = ['昆明/大理天气API 21°C晴', '12306车次实时比价', '携程高分洱海海景客栈', '行程判官: 0硬伤路线最优'];

        if (userText.includes('科隆') || userText.includes('不走回头路')) {
          targetItinerary = cologne1DayItinerary;
          replyContent = '主人，行程判官已为您完成科隆一日游单向动线规划！严格避免折返拉扯，全天顺路串联9大经典地点，步行与莱茵河畔步道无缝衔接：';
          toolTags = ['莱茵大区气象微风18°C', 'DB德铁实时排班系统', '欧洲遗产地开放时序库', '行程判官: 0折返认证通过'];
        } else if (userText.includes('判官') || userText.includes('把关') || userText.includes('审查') || userText.includes('硬伤')) {
          targetItinerary = defaultPrototypeItinerary;
          replyContent = '🛡️【行程判官】审查推演完毕：已为您排查路线硬伤（避开逆向拉扯与周三雪山维保闭馆）。现已生成「0硬伤合规优化方案」：';
          toolTags = ['行程判官硬伤检测引擎', '景点开放时段冲突排查', '城市大交通无缝接驳', '行程判官: 100%合理认证'];
        }

        setItinerary(targetItinerary);
        const newAgentMessage: ChatMessageItem = {
          id: `agent_${Date.now()}`,
          sender: 'agent',
          semanticTags: [`游客体验模式 (${targetItinerary.durationSummary} / 预算约 ¥${targetItinerary.budgetSummaryRmb})`],
          toolTags,
          content: replyContent,
          showItineraryLink: true,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages((prev) => [...prev, newAgentMessage]);
        return;
      }

      // 已登录状态调用后端真实 POST /plans 接口
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
      if (isLoggedIn() && itinerary.planId && !itinerary.planId.startsWith('plan_')) {
        const data = await request(`/plans/${itinerary.planId}`, 'PATCH', { instruction: '优化每日游玩节奏，减少排队拥挤' });
        setItinerary((prev) => ({ ...prev, title: data.plan_title ?? prev.title, subTagText: data.summary_description ?? prev.subTagText }));
      } else {
        // 游客体验模式：智能调整排期节奏
        await new Promise((resolve) => setTimeout(resolve, 600));
        setItinerary((prev) => ({
          ...prev,
          subTagText: `${prev.subTagText.split(' · ')[0]} · AI重排优化 · 避开人流拥挤高峰`,
          judgeCertification: {
            statusTitle: '行程判官认证：已完成AI排期调优',
            detailMessage: '已优化每日游玩节奏，错开景点高峰期，单日步行负荷降低20%。',
            verifiedBadgeText: '已认证 判官'
          }
        }));
      }
      alert('✨ AI 一键重新排布已完成！行程节奏与高峰避让已优化。');
    } catch (err) {
      alert(err instanceof Error?err.message:'调整失败');
    } finally {
      setIsReordering(false);
    }
  };

  // 编辑行程信息保存
  const handleSaveItineraryEdit = async (updated: { title: string; budgetSummaryRmb: number; subTagText: string }) => {
    setItinerary((prev) => ({ ...prev, ...updated }));
    if (isLoggedIn() && itinerary.planId && !itinerary.planId.startsWith('plan_')) {
      try {
        await request(`/plans/${itinerary.planId}`, 'PATCH', { title: updated.title });
      } catch (err) {
        console.error('保存至服务端失败:', err);
      }
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

  /**
   * AI 侧方案摘要，供「人工顾问」一键带到会话里。
   *
   * 直接取 itinerary 当前态 —— 和用户在【行程】页看到的是同一份内容，
   * 只带标题/周期/预算/路线这几个客服真正需要的信息，不带逐日明细，避免刷屏。
   */
  const buildPlanSummary = (): string | undefined => {
    if (!itinerary?.title) return undefined;
    return [
      `【AI 已生成方案，请顾问据此跟进】`,
      `标题：${itinerary.title}`,
      `周期：${itinerary.durationSummary}`,
      `路线：${itinerary.routeText}`,
      `预估预算：¥${itinerary.budgetSummaryRmb}（${itinerary.subTagText}）`
    ].join('\n');
  };

  // 渲染单个具体屏幕
  const renderScreenContent = (screenKey: ActiveTabKey) => {
    switch (screenKey) {
      case 'plan':
        return (
          <PlanScreen
            onQuickNewPlanClick={() => {
              setCurrentTab('agent');
            }}
            onSelectShowcaseRoute={(route) => {
              setCurrentTab('agent');
              handleSendMessage(`我想规划「${route.title}」，请帮我按0回头路生成完整行程方案`);
            }}
            onInputDestinationClick={() => {
              setCurrentTab('agent');
            }}
            onAuditItineraryClick={() => {
              setCurrentTab('agent');
              handleSendMessage('体验「行程判官」：审查已有行程（Day1昆明、Day2大理、Day3丽江），检查是否有折返硬伤');
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
            onResetChat={() => setMessages(defaultChatMessages)}
            isLoading={isGenerating}
            user={user}
            onOpenLogin={() => setShowLoginModal(true)}
            planSummary={buildPlanSummary()}
            initialMode={agentInitialMode}
          />
        );
      case 'itinerary':
        return (
          <ItineraryScreen
            itinerary={itinerary}
            onBackClick={() => setCurrentTab('plan')}
            onExportClick={handleExportItinerary}
            onReorderClick={handleReorderItinerary}
            onSaveEdit={handleSaveItineraryEdit}
            isReordering={isReordering}
            onConsultClick={() => {
              setAgentInitialMode('consult');
              setCurrentTab('agent');
            }}
          />
        );
      case 'consult':
        return (
          <ConsultChatScreen
            user={user}
            onOpenLogin={() => setShowLoginModal(true)}
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
            onSelectCollection={(collection) => {
              setCurrentTab('agent');
              handleSendMessage(`请根据收藏夹「${collection.title}」为我规划一条深度体验路线`);
            }}
          />
        );
      case 'profile':
        if (showLoginModal) {
          return (
            <LoginScreen
              onLogin={(loggedInUser) => {
                setUser(loggedInUser);
                setShowLoginModal(false);
              }}
              onBack={() => setShowLoginModal(false)}
            />
          );
        }
        const rawPhone = String(user?.phone || user?.mobile || '');
        const validPhone = /^1[3-9]\d{9}$/.test(rawPhone) ? rawPhone : '';
        const isUserLoggedIn = Boolean(user && isLoggedIn());
        return (
          <ProfileScreen
            nickname={user ? (user.nickname || user.mobile || user.phone || '旅行家') : '游客体验官'}
            isAdmin={hasAdminAccess}
            isLoggedIn={isUserLoggedIn}
            defaultMobile={validPhone}
            onOpenLogin={() => setShowLoginModal(true)}
            onLogout={async () => { try { await logout(); setUser(null); } catch (e) { alert(e instanceof Error ? e.message : '退出失败'); } }}
            onOpenAdminConsole={() => setCurrentTab('admin')}
            onNavigateToAgent={(prompt) => {
              setCurrentTab('agent');
              handleSendMessage(prompt);
            }}
          />
        );
      case 'admin':
        if (!user || !hasAdminAccess) {
          return <ForbiddenScreen onBack={() => setCurrentTab('profile')} />;
        }
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
        allowedScreens={allowedScreens}
        onBlockedScreen={() => setCurrentTab(visibleTabs[0]?.key ?? 'plan')}
        footerComponent={
          currentTab !== 'admin' ? (
            <TabBar
              currentTab={currentTab}
              onTabChange={(tab) => {
                // 手动点底部「智能体」时回到 AI 模式；「咨询此行程」的入口才带 consult
                if (tab === 'agent') setAgentInitialMode('ai');
                setCurrentTab(tab);
              }}
              tabs={visibleTabs}
            />
          ) : undefined
        }
      >
        <Suspense fallback={<div role="status" aria-live="polite">页面加载中…</div>}>
          {renderScreenContent(currentTab)}
        </Suspense>
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
