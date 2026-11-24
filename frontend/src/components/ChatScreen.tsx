import React, { useEffect, useRef, useState } from 'react';
import { ChatMessageItem } from '../types';
import { request } from '../api';
import { ConsultChatScreen } from './ConsultChatScreen';
import { Icon } from './Icon';

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
  /** 当前 AI 方案的摘要（标题/天数/预算），切到人工时一键发给顾问 */
  planSummary?: string;
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
  initialMode = 'ai',
  planSummary
}) => {
  const [inputText, setInputText] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'ai' | 'consult'>(initialMode);

  // DeepSeek 状态（服务端统一托管）
  const [deepseekStatus, setDeepseekStatus] = useState<{ configured: boolean; model: string; base_url?: string } | null>(null);

  // 获取大模型连接状态
  useEffect(() => {
    let active = true;
    request<{ configured: boolean; model: string; base_url: string }>('/ai/status')
      .then((data) => {
        if (active) setDeepseekStatus(data);
      })
      .catch(() => {
        if (active) setDeepseekStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // 消息更新或生成中时自动滚动到底部
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleQuickPrompt = (promptText: string) => {
    setInputText(promptText);
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
          <Icon name="shield" size={16} className="mode-btn-icon" />
          <span>AI 行程判官</span>
        </button>
        <button
          type="button"
          className={`agent-mode-btn ${mode === 'consult' ? 'active' : ''}`}
          onClick={() => setMode('consult')}
        >
          <Icon name="headset" size={16} className="mode-btn-icon" />
          <span>人工专属顾问</span>
          <span className="live-online-dot" title="WebSocket 实时在线" />
        </button>
      </div>

      {mode === 'consult' ? (
        <ConsultChatScreen
          user={user}
          onOpenLogin={onOpenLogin}
          onBackToAi={() => setMode('ai')}
          planSummary={planSummary}
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
              <Icon name="close" size={20} />
            </button>

            <div className="nav-chat-title">新对话</div>

            <div className="nav-right-actions">
              <div
                className="btn-deepseek-badge"
                title={deepseekStatus?.configured ? `DeepSeek 已就绪 (${deepseekStatus.model})` : 'AI 智能体服务'}
              >
                <span style={{ color: deepseekStatus?.configured ? '#216e39' : '#88998c' }}>●</span>
                <span>{deepseekStatus?.configured ? 'DeepSeek 在线' : '本地规则引擎'}</span>
              </div>
              <button type="button" className="nav-icon-button" aria-label="更多">
                <Icon name="more" size={18} />
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
                  <Icon name="arrow-right" size={14} className="corner-arrow-icon" />
                </button>
                <button
                  type="button"
                  className="quick-suggestion-item"
                  onClick={() => handleQuickPrompt('帮我解析行程/地点：昆明翠湖-大理洱海-丽江雪山路线合理度')}
                >
                  <span>帮我解析行程/地点</span>
                  <Icon name="arrow-right" size={14} className="corner-arrow-icon" />
                </button>
                <button
                  type="button"
                  className="quick-suggestion-item highlight-consult"
                  onClick={() => setMode('consult')}
                >
                  <span><Icon name="headset" size={15} /> 连线人工顾问（定制与秒杀答疑）</span>
                  <Icon name="arrow-right" size={14} className="corner-arrow-icon" />
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
          <div className="chat-input-sticky-bottom">
            <form className="input-control-row" onSubmit={handleSubmit}>
              <button type="button" className="btn-input-addon" aria-label="添加附件">
                <Icon name="plus" size={18} />
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
                  <Icon name="mic" size={18} />
                </button>
              </div>
              {inputText.trim() && (
                <button type="submit" className="btn-chat-send" disabled={isLoading}>
                  <Icon name="send" size={15} /> 发送
                </button>
              )}
            </form>
            <div className="chat-disclaimer-text">
              内容由 AI 生成，实时工具网络驱动
            </div>
          </div>
        </>
      )}
    </div>
  );
};
