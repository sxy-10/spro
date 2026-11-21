 import React, { useEffect, useRef, useState, useMemo } from 'react';
 import { ImWsClient, WsConnectionStatus } from '../../shared/ws';
import { imStore, ImStoreMessage } from '../lib/imStore';
import { getAccessToken } from '../lib/session';
import { request } from '../api';
 
 interface ConsultChatScreenProps {
   user?: any;
   onOpenLogin?: () => void;
   onBackToAi?: () => void;
 }
 
 const DEFAULT_CONV_ID = '1';
 
 export const ConsultChatScreen: React.FC<ConsultChatScreenProps> = ({ user, onOpenLogin, onBackToAi }) => {
   const [convId, setConvId] = useState<string>(DEFAULT_CONV_ID);
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
 
     // 拉取服务端初始会话与历史消息
     void (async () => {
       try {
         const convRes = await request<any>('/im/conversations?size=1');
         const list = convRes?.list || convRes || [];
         const targetId = list.length > 0 ? String(list[0].conversation_id || list[0].id) : DEFAULT_CONV_ID;
         setConvId(targetId);
 
         const historyRes = await request<any>(`/im/conversations/${targetId}/messages?since_id=0`);
         const historyList = Array.isArray(historyRes) ? historyRes : historyRes?.list || [];
         imStore.mergeBatch(targetId, historyList);
       } catch {
         // 若尚未建表或网络异常，使用默认会话
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
             <span className="advisor-avatar-icon">👩‍💼</span>
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
                 <span className="status-label connected">🟢 WS 实时在线 · 毫秒直连</span>
               )}
               {connectionStatus === 'degraded_polling' && (
                 <span className="status-label polling">🟡 降级长轮询中 (/v1/im/poll)</span>
               )}
               {connectionStatus === 'reconnecting' && (
                 <span className="status-label reconnecting">🟠 网络波动，正在退避重连...</span>
               )}
               {connectionStatus === 'connecting' && (
                 <span className="status-label connecting">⏳ 连接中...</span>
               )}
               {connectionStatus === 'disconnected' && (
                 <span className="status-label disconnected">⚪ 未连接</span>
               )}
             </div>
           </div>
         </div>
         <div className="header-action-tags">
           {onBackToAi && (
             <button
               type="button"
               className="btn-back-to-ai"
               onClick={onBackToAi}
             >
               <span>🤖</span> 切回AI
             </button>
           )}
           <span className="conv-id-pill">会话 #{convId}</span>
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
           <div className="bubble-avatar">👩‍💼</div>
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
                           ⏳ 发送中
                         </span>
                       )}
                       {item.status === 'sent' && (
                         <span className="status-sent-check" title="已落库送达">
                           ✓ 已送达
                         </span>
                       )}
                       {item.status === 'failed' && (
                         <button
                           type="button"
                           className="status-retry-btn"
                           onClick={() => handleRetry(item)}
                           title="3秒未收到ACK回执，点击使用相同 clientMsgId 重发"
                         >
                           ⚠️ 发送失败 · 点击重发
                         </button>
                       )}
                     </span>
                   )}
                 </div>
               </div>
               {isMe && <div className="bubble-avatar me-avatar">🎒</div>}
             </div>
           );
         })}

         <div ref={messagesEndRef} />
       </div>
 
       {/* 快捷话术推荐 */}
       <div className="quick-prompts-bar">
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
           placeholder={isLoggedIn ? '输入您想咨询的问题，按回车发送…' : '请先登录以开启实时顾问对话…'}
           disabled={!isLoggedIn}
           value={inputText}
           onChange={(e) => setInputText(e.target.value)}
         />
         <button
           type="submit"
           className="consult-send-button"
           disabled={!isLoggedIn || !inputText.trim()}
         >
           <svg
             width="18"
             height="18"
             viewBox="0 0 24 24"
             fill="none"
             stroke="currentColor"
             strokeWidth="2"
             strokeLinecap="round"
             strokeLinejoin="round"
           >
             <line x1="22" y1="2" x2="11" y2="13" />
             <polygon points="22 2 15 22 11 13 2 9 22 2" />
           </svg>
           <span>发送</span>
         </button>
       </form>
     </div>
   );
 };
 
 export default ConsultChatScreen;
