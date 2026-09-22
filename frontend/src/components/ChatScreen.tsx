import React, { useState } from 'react';
import { ChatMessageItem } from '../types';

interface ChatScreenProps {
  messages: ChatMessageItem[];
  onSendMessage: (userText: string) => void;
  onOpenItineraryClick: () => void;
  onExperienceJudgeClick: () => void;
  isLoading?: boolean;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  messages,
  onSendMessage,
  onOpenItineraryClick,
  onExperienceJudgeClick,
  isLoading = false
}) => {
  const [inputText, setInputText] = useState('');

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
      {/* 顶部导航 */}
      <div className="chat-top-navbar">
        <button type="button" className="nav-icon-button" aria-label="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <div className="nav-chat-title">新对话</div>
        <div className="nav-right-actions">
          <button type="button" className="nav-icon-button" aria-label="通知">
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
      <div className="chat-scroll-area">
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
                <span>智能体正在调用 12306、天气与判官引擎计算排期...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部输入交互栏 */}
      <div className="chat-input-sticky-bottom">
        <form className="input-control-row" onSubmit={handleSubmit}>
          <button type="button" className="btn-input-addon" aria-label="更多工具">
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
    </div>
  );
};
