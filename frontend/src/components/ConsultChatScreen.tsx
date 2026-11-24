import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ImWsClient, WsConnectionStatus } from '../../shared/ws';
import { imStore, ImStoreMessage } from '../lib/imStore';
import { getAccessToken } from '../lib/session';
import { request } from '../api';
import { Icon } from './Icon';

interface ConsultChatScreenProps {
  user?: any;
  onOpenLogin?: () => void;
  onBackToAi?: () => void;
  /** 从 AI 规划侧带过来的行程摘要；非空时在快捷话术栏最前面多一个「发送方案给顾问」胶囊 */
  planSummary?: string;
}

export const ConsultChatScreen: React.FC<ConsultChatScreenProps> = ({
  user,
  onOpenLogin,
  onBackToAi,
  planSummary
}) => {
  /**
   * 空串 = 还没有会话。
   *
   * 刻意不再回退到硬编码的 '1'：会话 1 未必属于当前游客，
   * 拿别人的会话发消息会被后端 assertParticipant 挡成 404，前端只会一直显示发送失败。
   * 拿到真实会话 ID 之前不允许发送，比"发出去再失败"诚实得多。
   */
  const [convId, setConvId] = useState<string>('');
  const [messages, setMessages] = useState<ImStoreMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<WsConnectionStatus>('disconnected');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const timerMapRef = useRef<Map<string, any>>(new Map());
  const wsClientRef = useRef<ImWsClient | null>(null);

  const currentUserId = user?.id || user?.userId || 'guest';
  const isLoggedIn = Boolean(user && getAccessToken());

  // 1. 初始化并连接 WebSocket 通道
  useEffect(() => {
    if (!isLoggedIn) {
      setConnectionStatus('disconnected');
      return;
    }

    const client = new ImWsClient({
      getToken: () => getAccessToken(),
      defaultConvId: convId,
      getLastSeq: (cId) => imStore.getLastSeq(cId),
      getDeviceId: () => localStorage.getItem('im_device_id') || undefined,
      saveDeviceId: (id) => localStorage.setItem('im_device_id', id)
    });

    wsClientRef.current = client;

    const unbindStatus = client.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    const unbindMsg = client.onMessage((msg) => {
      imStore.mergeIncomingMessage(msg);
      // 收到消息后主动发送已读 ack 推进游标
      client.sendAck(msg.convId, msg.seq);
    });

    const unbindAck = client.onAck((ack) => {
      // 客户端三板斧 2：ack_ok 改 sent
      imStore.markMessageSent(ack.clientMsgId, ack.seq);
      const timer = timerMapRef.current.get(ack.clientMsgId);
      if (timer) {
        clearTimeout(timer);
        timerMapRef.current.delete(ack.clientMsgId);
      }
    });

    client.connect();

    /**
     * 拉取（或建立）当前咨询会话，灌入历史消息。
     *
     * 关键修复：新注册游客一个会话都没有，原来代码会盲退到 DEFAULT_CONV_ID='1'。
     * 会话 1 通常属于别人，于是第一条消息发送时后端 assertParticipant 直接 404，
     * 前端只能一直显示「发送失败 · 点击重发」。
     * 现在改为：没有会话就自动创建一条，新会话 assignee_id 为空，
     * 天然落进 B 端客服工作台的「待接入」队列，客服接入即打通全链路。
     */
    const ensureConversation = async (): Promise<string | null> => {
      const convRes = await request<any>('/im/conversations?size=1');
      const list = convRes?.list || convRes || [];
      if (list.length > 0) {
        return String(list[0].conversation_id || list[0].id);
      }
      const created = await request<any>('/im/conversations', 'POST', {});
      const createdId = String(created?.conversation_id ?? '');
      return createdId || null;
    };

    void (async () => {
      try {
        const targetId = await ensureConversation();
        if (!targetId) return;
        setConvId(targetId);
        // 会话 ID 变了，WS 的 sync 与降级轮询目标也要跟着切
        client.setActiveConversation(targetId);

        const historyRes = await request<any>(`/im/conversations/${targetId}/messages?since_id=0`);
        const historyList = Array.isArray(historyRes) ? historyRes : historyRes?.list || [];
        imStore.mergeBatch(targetId, historyList);
      } catch {
        // 无 im:conv:manage 权限或网络异常：停在默认会话，界面上的登录横幅已给出指引
      }
    })();

    return () => {
      unbindStatus();
      unbindMsg();
      unbindAck();
      client.destroy();
      wsClientRef.current = null;
      timerMapRef.current.forEach((t) => clearTimeout(t));
      timerMapRef.current.clear();
    };
  }, [isLoggedIn]);

  // 2. 订阅消息仓库变更
  useEffect(() => {
    const unsubscribe = imStore.subscribe(convId, (updatedMessages) => {
      setMessages(updatedMessages);
    });
    return unsubscribe;
  }, [convId]);

  // 3. 消息更新自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * 客户端三板斧核心流程：
   * 1. 点击即上屏（生成 clientMsgId，addSendingMessage，<100ms 立即呈现在界面）
   * 2. 发送 msg 帧至服务端，等待 ack_ok
   * 3. 3s 无回执则将状态置为 failed，展示红点与【点击重发】按钮
   */
  const executeSendMessage = (textToSend: string, existingClientMsgId?: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;
    // 会话还没建立（首屏请求仍在飞）时不假装发送成功
    if (!convId) return;

    // 若是重发，沿用相同的 clientMsgId；若是新发，生成唯一 clientMsgId
    const clientMsgId =
      existingClientMsgId ||
      `cmsg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 步骤 ①：点击即上屏（写入 imStore，status: 'sending'）
    imStore.addSendingMessage(convId, clientMsgId, currentUserId, trimmed);
    if (!existingClientMsgId) {
      setInputText('');
    }

    // 步骤 ②：通过 WS 通道（或降级通道）发出 msg 帧
    if (wsClientRef.current) {
      wsClientRef.current.sendMessage(convId, clientMsgId, trimmed);
    }

    // 清理旧计时器
    if (timerMapRef.current.has(clientMsgId)) {
      clearTimeout(timerMapRef.current.get(clientMsgId));
    }

    // 步骤 ③：3秒无回执判定 failed
    const timeoutTimer = setTimeout(() => {
      imStore.markMessageFailed(clientMsgId);
      timerMapRef.current.delete(clientMsgId);
    }, 3000);

    timerMapRef.current.set(clientMsgId, timeoutTimer);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSendMessage(inputText);
  };

  const handleRetry = (msg: ImStoreMessage) => {
    executeSendMessage(msg.content, msg.clientMsgId);
  };

  /**
   * 发起一条新咨询。
   *
   * 新建的会话 assignee_id 为空 → 自动进入 B 端客服工作台的「待接入」队列，
   * 由客服接入后才建立接待关系（抢单模式，不需要游客预先知道谁值班）。
   * 之前 C 端只能读第一条已存在的会话，没有「新建」入口，
   * 导致客服台的待接入池永远是空的 —— 这里补上最小入口。
   */
  const [creating, setCreating] = useState(false);
  const createConsultation = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await request<any>('/im/conversations', 'POST', {});
      const newId = String(res?.conversation_id ?? '');
      if (newId) {
        setMessages([]);
        setConvId(newId);
        // 新会话接管为活跃会话：WS 的 sync 与降级轮询都切到这条
        wsClientRef.current?.setActiveConversation(newId);
      }
    } catch {
      // 未登录 / 无 im:conv:manage 时静默失败，页面上的登录横幅已经给出指引
    } finally {
      setCreating(false);
    }
  };

  // 快捷咨询话术
  const quickPrompts = useMemo(
    () => [
      '我想定制一条0回头路的云南5日深度游',
      '请问秒杀专区路线包含接送机和景点门票吗？',
      '如果因突发天气原因无法出行，退改签规则如何？',
      '帮我推荐适合带老人小孩的休闲线路'
    ],
    []
  );
 
   return (
     <div className="consult-chat-container">
       {/* 顶部 Header */}
       <header className="consult-chat-header">
         <div className="header-advisor-info">
           <div className="advisor-avatar-box">
             <span className="advisor-avatar-icon"><Icon name="headset" size={20} /></span>
             <span
               className={`advisor-status-dot ${
                 connectionStatus === 'connected'
                   ? 'online'
                   : connectionStatus === 'degraded_polling'
                   ? 'polling'
                   : 'offline'
               }`}
             />
           </div>
           <div className="advisor-text-meta">
             <div className="advisor-name-row">
               <h3 className="advisor-title">专属行程顾问 · 小程</h3>
               <span className="badge-advisor-tag">认证管家</span>
             </div>
             <div className="advisor-subline">
               {connectionStatus === 'connected' && (
                 <span className="status-label connected"><span className="status-dot" style={{ background: '#10b981' }} />WS 实时在线 · 毫秒直连</span>
               )}
               {connectionStatus === 'degraded_polling' && (
                 <span className="status-label polling"><span className="status-dot" style={{ background: '#f59e0b' }} />降级长轮询中 (/v1/im/poll)</span>
               )}
               {connectionStatus === 'reconnecting' && (
                 <span className="status-label reconnecting"><span className="status-dot" style={{ background: '#ea580c' }} />网络波动，正在退避重连...</span>
               )}
               {connectionStatus === 'connecting' && (
                 <span className="status-label connecting"><Icon name="clock" size={12} />连接中...</span>
               )}
               {connectionStatus === 'disconnected' && (
                 <span className="status-label disconnected"><span className="status-dot" style={{ background: '#9ca3af' }} />未连接</span>
               )}
             </div>
           </div>
         </div>
         <div className="header-action-tags">
           <button
             type="button"
             className="btn-back-to-ai"
             disabled={!isLoggedIn || creating}
             onClick={() => void createConsultation()}
           >
             <Icon name="plus" size={14} /> {creating ? '创建中…' : '发起咨询'}
           </button>
           {onBackToAi && (
             <button
               type="button"
               className="btn-back-to-ai"
               onClick={onBackToAi}
             >
               <Icon name="sparkles" size={14} /> 切回AI
             </button>
           )}
           <span className="conv-id-pill">{convId ? `会话 #${convId}` : '会话建立中'}</span>
         </div>
       </header>
 
       {/* 未登录遮罩提示 */}
       {!isLoggedIn && (
         <div className="consult-login-banner">
           <div className="banner-content">
             <span className="banner-icon">💬</span>
             <div>
               <strong>开启 1 对 1 实时顾问咨询</strong>
               <p>登录后可享专属行程答疑、特惠秒杀锁定与线路定制支持</p>
             </div>
           </div>
           {onOpenLogin && (
             <button type="button" className="banner-login-btn" onClick={onOpenLogin}>
               立即登录
             </button>
           )}
         </div>
       )}
 
       {/* 消息滚动流 */}
       <div className="consult-message-list">
         <div className="message-notice-pill">
           🔒 专属加密实时会话 · 顾问平均响应时间 &lt; 15秒
         </div>
 
         {/* 顾问欢迎卡片 */}
         <div className="consult-bubble-row advisor-row">
           <div className="bubble-avatar"><Icon name="headset" size={18} /></div>
           <div className="bubble-content-wrapper">
             <div className="bubble-bubble advisor-bubble">
               您好！我是您的专属金牌旅行顾问小程 😊
               无论是定制个性化动线、咨询秒杀特惠路线，还是解答行李与天气疑问，我都会全天候为您排忧解难。
             </div>
             <span className="bubble-time">系统接入</span>
           </div>
         </div>
 
         {/* 消息条目 */}
         {messages.map((item) => {
           const isMe = String(item.senderId) === String(currentUserId);
           return (
             <div
               key={item.clientMsgId || item.id || `msg_${item.seq}`}
               className={`consult-bubble-row ${isMe ? 'user-row' : 'advisor-row'}`}
             >
               {!isMe && <div className="bubble-avatar">👩‍💼</div>}
               <div className="bubble-content-wrapper">
                 <div className={`bubble-bubble ${isMe ? 'user-bubble' : 'advisor-bubble'}`}>
                   {item.content}
                 </div>
                 <div className="bubble-meta-line">
                   {item.createdAt && (
                     <span className="bubble-time">
                       {new Date(item.createdAt).toLocaleTimeString([], {
                         hour: '2-digit',
                         minute: '2-digit'
                       })}
                     </span>
                   )}
                   {/* 客户端三态标识 */}
                   {isMe && (
                     <span className={`msg-status-tag ${item.status}`}>
                       {item.status === 'sending' && (
                         <span className="status-sending-spinner" title="发送中...">
                           <Icon name="clock" size={12} /> 发送中
                         </span>
                       )}
                       {item.status === 'sent' && (
                         <span className="status-sent-check" title="已落库送达">
                           <Icon name="check" size={12} /> 已送达
                         </span>
                       )}
                       {item.status === 'failed' && (
                         <button
                           type="button"
                           className="status-retry-btn"
                           onClick={() => handleRetry(item)}
                           title="3秒未收到ACK回执，点击使用相同 clientMsgId 重发"
                         >
                           <Icon name="warning" size={12} /> 发送失败 · 点击重发
                         </button>
                       )}
                     </span>
                   )}
                 </div>
               </div>
               {isMe && <div className="bubble-avatar me-avatar"><Icon name="backpack" size={18} /></div>}
             </div>
           );
         })}

         <div ref={messagesEndRef} />
       </div>
 
      {/* 快捷话术推荐 */}
      <div className="quick-prompts-bar">
        {/*
          AI 侧带过来的行程摘要。游客在智能体里刚算完方案就切人工，
          客服看不到上下文；一键把方案标题/天数/预算作为一条普通消息发过去，
          人工就能接着聊，不必从头再问一遍需求。
        */}
        {planSummary && isLoggedIn && (
          <button
            type="button"
            className="quick-prompt-chip chip-plan-summary"
            onClick={() => executeSendMessage(planSummary)}
            title="把当前 AI 方案摘要发给人工顾问"
          >
            <Icon name="route" size={12} /> 发送当前 AI 方案给顾问
          </button>
        )}
        {quickPrompts.map((promptText, idx) => (
           <button
             key={idx}
             type="button"
             className="quick-prompt-chip"
             onClick={() => executeSendMessage(promptText)}
           >
             {promptText}
           </button>
         ))}
       </div>
 
       {/* 底部输入框 */}
       <form className="consult-input-bar" onSubmit={handleFormSubmit}>
        <input
          type="text"
          className="consult-text-input"
           placeholder={
             !isLoggedIn
               ? '请先登录以开启实时顾问对话…'
               : !convId
               ? '正在为您建立专属会话…'
               : '输入您想咨询的问题，按回车发送…'
           }
           disabled={!isLoggedIn || !convId}
           value={inputText}
           onChange={(e) => setInputText(e.target.value)}
         />
         <button
           type="submit"
           className="consult-send-button"
           disabled={!isLoggedIn || !convId || !inputText.trim()}
         >
          <Icon name="send" size={18} />
           <span>发送</span>
         </button>
       </form>
     </div>
   );
 };
 
 export default ConsultChatScreen;
