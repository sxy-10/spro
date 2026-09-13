import React, { useState } from 'react';

interface ItineraryData {
  planTitle: string;
  summaryDescription: string;
  estimatedTotalBudgetRmb: number;
  budgetBreakdown: {
    transportationRmb: number;
    accommodationRmb: number;
    admissionTicketsRmb: number;
    mealsRmb: number;
  };
  days: Array<{
    dayIndex: number;
    dateString: string;
    cityName: string;
    morningActivities: Array<{ attractionName: string; suggestedDurationHours: number; bookingNotice: string }>;
    afternoonActivities: Array<{ attractionName: string; recommendedReason: string }>;
    eveningActivities: Array<{ attractionName: string }>;
    accommodation: { hotelName: string; locationSummary: string; estimatedPricePerNightRmb: number };
    dailyTips: string[];
  }>;
  essentialKitAndNotices: {
    weatherOverview: string;
    clothingSuggestions: string;
    avoidTrapTips: string[];
    emergencyContacts: { policeNumber: string; nearestMajorHospital: string; touristAssistanceHotline: string };
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'planner' | 'admin'>('planner');
  const [inputPrompt, setInputPrompt] = useState('成都出发，去云南 5 天 4 晚，两个人，预算 8000，休闲不累。');
  const [loading, setLoading] = useState(false);
  const [itinerary, setItinerary] = useState<ItineraryData | null>(null);
  const [adjustInput, setAdjustInput] = useState('');
  const [exportText, setExportText] = useState<string | null>(null);

  // 发起自然语言行程规划
  const handleGeneratePlan = async () => {
    if (!inputPrompt.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/chat/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: inputPrompt })
      });
      const result = await res.json();
      if (result.success) {
        setItinerary(result.data.itinerary);
      } else {
        alert(result.message || '生成方案失败');
      }
    } catch (err: any) {
      alert('请求后端失败，请确认后端服务已启动 (端口3001)');
    } finally {
      setLoading(false);
    }
  };

  // 多轮对话调整
  const handleOptimizePlan = async () => {
    if (!adjustInput.trim() || !itinerary) return;
    setLoading(true);
    try {
      const res = await fetch('/api/itinerary/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itinerary, instruction: adjustInput })
      });
      const result = await res.json();
      if (result.success) {
        setItinerary(result.data);
        setAdjustInput('');
      }
    } catch (err) {
      alert('优化重排请求失败');
    } finally {
      setLoading(false);
    }
  };

  // 导出行程长文
  const handleExport = async () => {
    if (!itinerary) return;
    try {
      const res = await fetch('/api/itinerary/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itinerary })
      });
      const result = await res.json();
      if (result.success) {
        setExportText(result.data.formattedContent);
      }
    } catch (err) {
      alert('导出失败');
    }
  };

  return (
    <div className="app-container">
      {/* 头部导航 */}
      <header className="header">
        <div>
          <h1>✈️ 旅游规划智能体系统 (AI Travel Agent)</h1>
          <p style={{ color: '#64748b', fontSize: '14px' }}>
            告诉它“去哪、几天、几人、预算”，AI 智能体自动查、自动算、自动排、自动生成可落地出行方案
          </p>
        </div>
        <div className="tab-buttons">
          <button
            className={activeTab === 'planner' ? 'active' : ''}
            onClick={() => setActiveTab('planner')}
          >
            智能规划对话端
          </button>
          <button
            className={activeTab === 'admin' ? 'active' : ''}
            onClick={() => setActiveTab('admin')}
          >
            企业/旅行社管理端
          </button>
        </div>
      </header>

      {activeTab === 'planner' ? (
        <div className="planner-grid">
          {/* 左侧对话与调整面板 */}
          <div className="card chat-panel">
            <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>🗣️ 自然语言规划需求</h2>
            <textarea
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              placeholder="例如：成都出发，去云南5天4晚，两个人，预算8000，休闲不累..."
            />
            <button className="btn-primary" onClick={handleGeneratePlan} disabled={loading}>
              {loading ? 'AI 智能体正在规划排期...' : '✨ 一键生成出行方案'}
            </button>

            <div className="tag-cloud">
              <span className="tag-chip" onClick={() => setInputPrompt('成都出发，去云南5天4晚，2人，预算8000，休闲游，不吃辣')}>
                💡 云南休闲5日游
              </span>
              <span className="tag-chip" onClick={() => setInputPrompt('北京出发，去川西甘孜7天自驾，摄影路线，住特色民宿')}>
                🏔️ 川西摄影自驾7日
              </span>
              <span className="tag-chip" onClick={() => setInputPrompt('上海出发，带老人孩子去贵州4天，避暑清凉，节奏慢')}>
                👨‍👩‍👧 贵州亲子避暑4日
              </span>
            </div>

            {itinerary && (
              <div style={{ marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
                <h3 style={{ fontSize: '15px', marginBottom: '8px' }}>🔄 多轮对话调整</h3>
                <input
                  type="text"
                  value={adjustInput}
                  onChange={(e) => setAdjustInput(e.target.value)}
                  placeholder="例如：不要购物 / 加一天丽江 / 住靠近景区..."
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '8px' }}
                />
                <button
                  className="btn-primary"
                  style={{ background: '#0284c7' }}
                  onClick={handleOptimizePlan}
                  disabled={loading}
                >
                  ⚡ AI 智能重新排布
                </button>
              </div>
            )}
          </div>

          {/* 右侧生成的行程展示 */}
          <div className="card">
            {itinerary ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
                  <div>
                    <h2 style={{ fontSize: '20px', color: '#0f172a' }}>{itinerary.planTitle}</h2>
                    <p style={{ color: '#475569', fontSize: '14px', marginTop: '4px' }}>{itinerary.summaryDescription}</p>
                  </div>
                  <button
                    style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                    onClick={handleExport}
                  >
                    📋 导出长文 / 打印
                  </button>
                </div>

                {/* 预算分配概览 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', margin: '16px 0', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                  <div><strong>总预算:</strong> ¥{itinerary.estimatedTotalBudgetRmb}</div>
                  <div><strong>交通:</strong> ¥{itinerary.budgetBreakdown.transportationRmb}</div>
                  <div><strong>住宿:</strong> ¥{itinerary.budgetBreakdown.accommodationRmb}</div>
                  <div><strong>餐饮:</strong> ¥{itinerary.budgetBreakdown.mealsRmb}</div>
                </div>

                {/* 按天时间轴 */}
                <div className="day-timeline">
                  {itinerary.days.map((day) => (
                    <div key={day.dayIndex} className="day-card">
                      <div className="day-header">{day.dateString} - {day.cityName}</div>
                      <div className="schedule-slot">
                        <span className="badge">上午</span>
                        {day.morningActivities.map(a => a.attractionName).join('、')}
                      </div>
                      <div className="schedule-slot">
                        <span className="badge">下午</span>
                        {day.afternoonActivities.map(a => a.attractionName).join('、')}
                      </div>
                      <div className="schedule-slot">
                        <span className="badge">晚上</span>
                        {day.eveningActivities.map(a => a.attractionName).join('、')}
                      </div>
                      <div className="schedule-slot" style={{ color: '#475569' }}>
                        🏨 <strong>住宿:</strong> {day.accommodation.hotelName} ({day.accommodation.locationSummary})
                      </div>
                    </div>
                  ))}
                </div>

                {/* 避坑与锦囊 */}
                <div style={{ marginTop: '20px', padding: '16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
                  <h4 style={{ color: '#b45309', marginBottom: '8px' }}>💡 旅行锦囊与避坑提示</h4>
                  <p style={{ fontSize: '13px', color: '#92400e', marginBottom: '6px' }}>
                    🌤️ <strong>天气着装：</strong>{itinerary.essentialKitAndNotices.weatherOverview}。{itinerary.essentialKitAndNotices.clothingSuggestions}
                  </p>
                  <ul style={{ fontSize: '13px', color: '#92400e', paddingLeft: '18px' }}>
                    {itinerary.essentialKitAndNotices.avoidTrapTips.map((tip, idx) => (
                      <li key={idx}>{tip}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>🧭</div>
                <p>输入您的出行想法，点击左侧“一键生成”，AI 智能体将为您自动计算最顺路的行程方案！</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 企业/旅行社管理后台 */
        <div className="card">
          <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>📊 旅行社 / 运营后台概览</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
            <div style={{ padding: '16px', background: '#f1f5f9', borderRadius: '8px' }}>
              <div style={{ color: '#64748b', fontSize: '13px' }}>累计咨询人次</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>1,248</div>
            </div>
            <div style={{ padding: '16px', background: '#f1f5f9', borderRadius: '8px' }}>
              <div style={{ color: '#64748b', fontSize: '13px' }}>智能方案生成量</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>980 份</div>
            </div>
            <div style={{ padding: '16px', background: '#f1f5f9', borderRadius: '8px' }}>
              <div style={{ color: '#64748b', fontSize: '13px' }}>方案预订转化率</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#16a34a' }}>38.6%</div>
            </div>
          </div>
          <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>📦 精选线路上架库</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
                <th style={{ padding: '8px' }}>线路标题</th>
                <th style={{ padding: '8px' }}>目的地</th>
                <th style={{ padding: '8px' }}>天数</th>
                <th style={{ padding: '8px' }}>风格标签</th>
                <th style={{ padding: '8px' }}>起拍价</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 8px' }}>云南大理丽江5日沉浸风情游</td>
                <td style={{ padding: '10px 8px' }}>云南</td>
                <td style={{ padding: '10px 8px' }}>5天</td>
                <td style={{ padding: '10px 8px' }}>休闲慢节奏</td>
                <td style={{ padding: '10px 8px', color: '#e11d48' }}>¥2,899起</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 8px' }}>川西川藏南线7日越野风光自驾</td>
                <td style={{ padding: '10px 8px' }}>四川/西藏</td>
                <td style={{ padding: '10px 8px' }}>7天</td>
                <td style={{ padding: '10px 8px' }}>摄影与自驾</td>
                <td style={{ padding: '10px 8px', color: '#e11d48' }}>¥4,680起</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 导出弹窗 */}
      {exportText && (
        <div className="export-modal-overlay" onClick={() => setExportText(null)}>
          <div className="export-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '12px' }}>📄 行程单文本预览 (微信长文/打印排版)</h3>
            <div className="pre-wrap">{exportText}</div>
            <button
              className="btn-primary"
              onClick={() => {
                navigator.clipboard.writeText(exportText);
                alert('已成功复制完整行程单内容！');
              }}
            >
              📋 复制文本到剪贴板
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
