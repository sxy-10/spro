import React, { useEffect, useRef, useState } from 'react';
import { ChatMessageItem } from '../types';
import { request } from '../api';
import { ConsultChatScreen } from './ConsultChatScreen';

interface ChatScreenProps {
  messages: ChatMessageItem[];
  onSendMessage: (userText: string) => void;
  onResetChat?: () => void;
  onOpenItineraryClick: () => void;
  onExperienceJudgeClick: () => void;
  isLoading?: boolean;
  user?: any;
  onOpenLogin?: () => void;
  initialMode?: 'ai' | 'consult';
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  messages,
  onSendMessage,
  onResetChat,
  onOpenItineraryClick,
  onExperienceJudgeClick,
  isLoading = false,
  user,
  onOpenLogin,
  initialMode = 'ai'
}) => {
  const [inputText, setInputText] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'ai' | 'consult'>(initialMode);

  // DeepSeek 配置与状态
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [deepseekStatus, setDeepseekStatus] = useState<{ configured: boolean; model: string; base_url?: string } | null>(null);
  const [customKeyInput, setCustomKeyInput] = useState(() => localStorage.getItem('travel_deepseek_api_key') || '');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // 获取大模型连接状态
  useEffect(() => {
    let active = true;
    request<{ configured: boolean; model: string; base_url: string }>('/ai/status')
      .then((data) => {
        if (active) setDeepseekStatus(data);
      })
      .catch(() => {
        // 静态或离线降级
        if (active) setDeepseekStatus({ configured: Boolean(localStorage.getItem('travel_deepseek_api_key')), model: 'deepseek-chat' });
      });
    return () => {
      active = false;
    };
  }, [isConfigModalOpen]);

  // 消息更新或生成中时自动滚动到底部
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // 保存 DeepSeek Key
  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customKeyInput.trim();
    localStorage.setItem('travel_deepseek_api_key', trimmed);
    try {
      await request('/ai/config-key', 'POST', { apiKey: trimmed });
    } catch {
      // ignore
    }
    setIsConfigModalOpen(false);
  };
  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleQuickPrompt = (promptText: string) => {
    setInputText(promptText);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const data = await request<{ ok: boolean; latency_ms: number; reply: string; model: string }>('/ai/test', 'POST', {
        apiKey: customKeyInput.trim() || undefined
      });
      setTestResult(`✅ 连通成功！模型：${data.model}（耗时 ${data.latency_ms}ms）\n回复：${data.reply}`);
      setDeepseekStatus((prev) => ({ configured: true, model: data.model, base_url: prev?.base_url }));
    } catch (e: any) {
      setTestResult(`❌ 连接失败：${e.message || '请检查密钥有效性或网络'}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="screen-chat-container">
      {/* 顶部智能体与人工咨询双模切换胶囊 */}
      <div className="agent-mode-switcher-bar">
        <button
          type="button"
          className={`agent-mode-btn ${mode === 'ai' ? 'active' : ''}`}
          onClick={() => setMode('ai')}
        >
          <span className="mode-btn-icon">🤖</span>
          <span>AI 行程判官</span>
        </button>
        <button
          type="button"
          className={`agent-mode-btn ${mode === 'consult' ? 'active' : ''}`}
          onClick={() => setMode('consult')}
        >
          <span className="mode-btn-icon">👩‍💼</span>
          <span>人工专属顾问</span>
          <span className="live-online-dot" title="WebSocket 实时在线" />
        </button>
      </div>

      {mode === 'consult' ? (
        <ConsultChatScreen
          user={user}
          onOpenLogin={onOpenLogin}
          onBackToAi={() => setMode('ai')}
        />
      ) : (
        <>
          {/* 顶部导航 */}
          <div className="chat-top-navbar">
            <button
              type="button"
              className="nav-icon-button"
              aria-label="重置新对话"
              title="开启新对话"
              onClick={onResetChat}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            <div className="nav-chat-title">新对话</div>

            <div className="nav-right-actions">
              <button
                type="button"
                className="btn-deepseek-badge"
                onClick={() => setIsConfigModalOpen(true)}
                title="点击配置 DeepSeek 大模型密钥"
              >
                <span style={{ color: deepseekStatus?.configured ? '#216e39' : '#88998c' }}>●</span>
                <span>{deepseekStatus?.configured ? 'DeepSeek-V3' : 'DeepSeek待配置'}</span>
              </button>

              <button type="button" className="nav-icon-button" aria-label="通知" onClick={() => setIsConfigModalOpen(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
              </button>
              <button type="button" className="nav-icon-button" aria-label="更多">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="2"></circle>
                  <circle cx="19" cy="12" r="2"></circle>
                  <circle cx="5" cy="12" r="2"></circle>
                </svg>
              </button>
            </div>
          </div>

          {/* 聊天内容可滚动流 */}
          <div className="chat-scroll-area" ref={scrollAreaRef}>
            {/* 欢迎与新手引导卡片 */}
            <div className="chat-welcome-box">
              <h2 className="welcome-main-heading">想去哪里？</h2>
              <p className="welcome-description">我可以帮你发掘附近灵感、活动、路线</p>

              {/* 行程判官体验胶囊条 */}
              <div className="judge-experience-banner">
                <div className="banner-left-info">
                  已有行程初稿？体验「行程判官」功能，帮你检查是否有硬伤
                </div>
                <button
                  type="button"
                  className="btn-experience-pill"
                  onClick={onExperienceJudgeClick}
                >
                  体验
                </button>
              </div>

              {/* 快捷推荐提示卡 */}
              <div className="quick-suggestions-list">
                <button
                  type="button"
                  className="quick-suggestion-item"
                  onClick={() => handleQuickPrompt('帮我创建出行计划：成都出发去云南5天4晚，2人，预算8000，休闲不累')}
                >
                  <span>帮我创建出行计划</span>
                  <span className="corner-arrow-icon">⮡</span>
                </button>
                <button
                  type="button"
                  className="quick-suggestion-item"
                  onClick={() => handleQuickPrompt('帮我解析行程/地点：昆明翠湖-大理洱海-丽江雪山路线合理度')}
                >
                  <span>帮我解析行程/地点</span>
                  <span className="corner-arrow-icon">⮡</span>
                </button>
                <button
                  type="button"
                  className="quick-suggestion-item highlight-consult"
                  onClick={() => setMode('consult')}
                >
                  <span>👩‍💼 连线人工顾问（定制与秒杀答疑）</span>
                  <span className="corner-arrow-icon">⮡</span>
                </button>
              </div>
            </div>

            {/* 消息对话渲染 */}
            <div className="chat-messages-thread">
              {messages.map((item) => (
                <div
                  key={item.id}
                  className={`chat-bubble-row ${item.sender === 'user' ? 'bubble-row-user' : 'bubble-row-agent'}`}
                >
                  {item.sender === 'user' ? (
                    <div className="bubble-user-content">
                      {item.content}
                      {item.createdAt && <div className="chat-bubble-timestamp">{item.createdAt}</div>}
                    </div>
                  ) : (
                    <div className="bubble-agent-card">
                      {/* 语义解析大标签 */}
                      {item.semanticTags && item.semanticTags.length > 0 && (
                        <div className="agent-semantic-badge">
                          {item.semanticTags.map((tagText, idx) => (
                            <span key={idx} className="badge-purple-text">{tagText}</span>
                          ))}
                        </div>
                      )}

                      {/* 工具与API触发标签网格 */}
                      {item.toolTags && item.toolTags.length > 0 && (
                        <div className="agent-tool-chips-grid">
                          {item.toolTags.map((toolText, idx) => (
                            <span key={idx} className="tool-chip-item">
                              {toolText}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 智能体核心回复文字 */}
                      <div className="agent-text-body">
                        {item.content}
                      </div>

                      {item.createdAt && <div className="chat-bubble-timestamp" style={{ color: '#8d9f93' }}>{item.createdAt}</div>}

                      {/* 行程附言链接 */}
                      {item.showItineraryLink && (
                        <div className="agent-itinerary-footer-link" onClick={onOpenItineraryClick}>
                          <span className="circle-plus-symbol">⊕</span>
                          <span className="link-title-text">行程附言（点击查阅完整排期方案）</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="chat-bubble-row bubble-row-agent">
                  <div className="bubble-agent-card loading-card">
                    <span className="spinner-dot"></span>
                    <span>智能体正在调用 DeepSeek 大模型、天气与判官引擎计算排期...</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 底部输入框 */}
          <div className="chat-bottom-input-bar">
            <form className="chat-input-form" onSubmit={handleSubmit}>
              <button type="button" className="btn-chat-plus" aria-label="添加附件">
                +
              </button>
              <div className="input-field-wrapper">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="发消息或按住说话"
                  className="chat-text-input"
                />
                <button type="button" className="btn-mic-icon" aria-label="语音输入">
                  🎙️
                </button>
              </div>
              {inputText.trim() && (
                <button type="submit" className="btn-chat-send" disabled={isLoading}>
                  发送
                </button>
              )}
            </form>
            <div className="chat-disclaimer-text">
              内容由 AI 生成，实时工具网络驱动
            </div>
          </div>
        </>
      )}
      {/* DeepSeek API 密钥与大模型配置弹窗 */}
      {isConfigModalOpen && (
        <div className="itinerary-edit-modal-backdrop" onClick={() => setIsConfigModalOpen(false)}>
          <div className="itinerary-edit-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>⚡</span>
                <h3 className="edit-modal-title">DeepSeek 大模型智能体设置</h3>
              </div>
              <button type="button" className="btn-close-edit-modal" onClick={() => setIsConfigModalOpen(false)}>
                ✕
              </button>
            </div>

            <form className="edit-modal-form" onSubmit={handleSaveApiKey}>
              <div className="edit-modal-field">
                <label className="edit-modal-label">DeepSeek API Key (sk-...)</label>
                <input
                  type="password"
                  value={customKeyInput}
                  onChange={(e) => setCustomKeyInput(e.target.value)}
                  className="booking-input"
                  placeholder="输入您的 DeepSeek 密钥（sk-...）"
                />
                <span style={{ fontSize: '11px', color: '#687d70' }}>
                  💡 支持直接从 <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer" style={{ color: '#25582c', fontWeight: 600 }}>DeepSeek 开放平台</a> 获取。已脱敏保护，仅保存在当前环境。
                </span>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button
                  type="button"
                  className="btn-green-outline"
                  style={{ height: '38px', borderRadius: '10px', fontSize: '13px' }}
                  onClick={handleTestConnection}
                  disabled={isTesting}
                >
                  {isTesting ? '正在测试...' : '测试连通性'}
                </button>

                <button
                  type="submit"
                  className="booking-submit-button"
                  style={{ height: '38px', flex: 1 }}
                >
                  保存生效
                </button>
              </div>

              {testResult && (
                <div style={{
                  background: testResult.startsWith('✅') ? '#edf8f0' : '#fff5f5',
                  border: `1px solid ${testResult.startsWith('✅') ? '#bce6c6' : '#fed7d7'}`,
                  color: testResult.startsWith('✅') ? '#185d2e' : '#c53030',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.45
                }}>
                  {testResult}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
