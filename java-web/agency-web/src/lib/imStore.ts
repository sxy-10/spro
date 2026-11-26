 /**
  * IM 本地消息仓库（第 4 棒 · 组员4）
  * 
  * 核心保障：
  * 1. 严格按 seq 排序：已落库消息按 seq 升序展示，发送中消息排在尾部
  * 2. clientMsgId + seq 双去重：
  *    - 本地乐观上屏使用 clientMsgId 占位，服务端回 ack_ok 或推送 msg 时命中 clientMsgId 则就地更新，不产生重复条目
  *    - 历史同步或多端推送时根据 convId + seq 去重，即使网络重发也不重复上屏
  * 3. 消息三态维护：sending (发送中) / sent (已落库) / failed (超时/网络失败)
  */
 
 export type MessageStatus = 'sending' | 'sent' | 'failed';
 
 export interface ImStoreMessage {
   id?: string;
   convId: string | number;
   seq: number;
   clientMsgId: string;
   senderId: string | number;
   type: 'TEXT' | 'SYSTEM';
   content: string;
   status: MessageStatus;
   createdAt: number;
 }
 
 class ImMessageStore {
   /** 按 convId 分组存储消息列表 */
   private messagesByConv = new Map<string, ImStoreMessage[]>();
   /** 订阅者监听集合 */
   private listenersByConv = new Map<string, Set<(msgs: ImStoreMessage[]) => void>>();
 
   private normalizeConvId(convId: string | number): string {
     return String(convId);
   }
 
   /** 获取指定会话的消息列表（返回按 seq / createdAt 排序的副本） */
   public getMessages(convId: string | number): ImStoreMessage[] {
     const key = this.normalizeConvId(convId);
     return [...(this.messagesByConv.get(key) || [])];
   }
 
   /** 获取指定会话当前最大的 seq 序号（断线 sync / 轮询 since 用） */
   public getLastSeq(convId: string | number): number {
     const msgs = this.getMessages(convId);
     let maxSeq = 0;
     for (const m of msgs) {
       if (m.seq > maxSeq) {
         maxSeq = m.seq;
       }
     }
     return maxSeq;
   }
 
   /** 订阅指定会话的消息变更 */
   public subscribe(convId: string | number, listener: (msgs: ImStoreMessage[]) => void): () => void {
     const key = this.normalizeConvId(convId);
     if (!this.listenersByConv.has(key)) {
       this.listenersByConv.set(key, new Set());
     }
     const set = this.listenersByConv.get(key)!;
     set.add(listener);
     listener(this.getMessages(convId));
     return () => set.delete(listener);
   }
 
   /** 触发订阅广播通知 */
   private notify(convId: string | number): void {
     const key = this.normalizeConvId(convId);
     const set = this.listenersByConv.get(key);
     if (!set || set.size === 0) return;
     const currentList = this.getMessages(convId);
     set.forEach((listener) => {
       try {
         listener(currentList);
       } catch (err) {
         console.error('[imStore] 监听器执行异常:', err);
       }
     });
   }
 
   /** 对单会话消息进行排序（seq > 0 升序排前，未落库 seq=0 的按 createdAt 升序排后） */
   private sortMessages(list: ImStoreMessage[]): ImStoreMessage[] {
     return list.sort((a, b) => {
       if (a.seq > 0 && b.seq > 0) {
         return a.seq - b.seq;
       }
       if (a.seq > 0 && b.seq === 0) {
         return -1;
       }
       if (a.seq === 0 && b.seq > 0) {
         return 1;
       }
       return a.createdAt - b.createdAt;
     });
   }
 
   /**
    * 客户端三板斧 1：点击即上屏
    * 创建本地发送中消息并立刻入库上屏展示
    */
   public addSendingMessage(
     convId: string | number,
     clientMsgId: string,
     senderId: string | number,
     content: string,
     type: 'TEXT' | 'SYSTEM' = 'TEXT'
   ): ImStoreMessage {
     const key = this.normalizeConvId(convId);
     const currentList = this.messagesByConv.get(key) || [];
 
     // 检查是否已有该 clientMsgId（重发场景）
     const existingIndex = currentList.findIndex((m) => m.clientMsgId === clientMsgId);
     if (existingIndex >= 0) {
       currentList[existingIndex] = {
         ...currentList[existingIndex],
         status: 'sending',
         content,
         createdAt: Date.now()
       };
       this.messagesByConv.set(key, this.sortMessages(currentList));
       this.notify(convId);
       return currentList[existingIndex];
     }
 
     const newMessage: ImStoreMessage = {
       convId: key,
       seq: 0,
       clientMsgId,
       senderId: String(senderId),
       type,
       content,
       status: 'sending',
       createdAt: Date.now()
     };
 
     currentList.push(newMessage);
     this.messagesByConv.set(key, this.sortMessages(currentList));
     this.notify(convId);
     return newMessage;
   }
 
   /**
    * 客户端三板斧 2：ack_ok 改 sent
    * 收到服务端确认回执，根据 clientMsgId 将消息标记为 sent 并回填分配的 seq
    */
   public markMessageSent(clientMsgId: string, seq: number): boolean {
     let updated = false;
     for (const [key, list] of this.messagesByConv.entries()) {
       const targetIndex = list.findIndex((m) => m.clientMsgId === clientMsgId);
       if (targetIndex >= 0) {
         list[targetIndex] = {
           ...list[targetIndex],
           seq,
           status: 'sent'
         };
         this.messagesByConv.set(key, this.sortMessages(list));
         this.notify(key);
         updated = true;
         break;
       }
     }
     return updated;
   }
 
   /**
    * 客户端三板斧 3：3s 无回执显示重发
    * 超时未收到 ACK，将该 clientMsgId 标记为 failed
    */
   public markMessageFailed(clientMsgId: string): boolean {
     let updated = false;
     for (const [key, list] of this.messagesByConv.entries()) {
       const targetIndex = list.findIndex((m) => m.clientMsgId === clientMsgId);
       if (targetIndex >= 0 && list[targetIndex].status === 'sending') {
         list[targetIndex] = {
           ...list[targetIndex],
           status: 'failed'
         };
         this.messagesByConv.set(key, this.sortMessages(list));
         this.notify(key);
         updated = true;
         break;
       }
     }
     return updated;
   }
 
   /**
    * 接收并合并服务端推送/同步下来的消息（按 clientMsgId + seq 双去重）
    */
   public mergeIncomingMessage(raw: {
     id?: string;
     convId: string | number;
     seq: number;
     clientMsgId: string;
     senderId: string | number;
     type?: string;
     content: string;
     ts?: number;
   }): void {
     const key = this.normalizeConvId(raw.convId);
     const currentList = this.messagesByConv.get(key) || [];
 
     // 1) 优先按 clientMsgId 去重（本地自己发出的消息回执上屏）
     if (raw.clientMsgId) {
       const matchByClientId = currentList.findIndex((m) => m.clientMsgId === raw.clientMsgId);
       if (matchByClientId >= 0) {
         currentList[matchByClientId] = {
           ...currentList[matchByClientId],
           id: raw.id || currentList[matchByClientId].id,
           seq: raw.seq || currentList[matchByClientId].seq,
           content: raw.content || currentList[matchByClientId].content,
           status: 'sent',
           createdAt: raw.ts || currentList[matchByClientId].createdAt
         };
         this.messagesByConv.set(key, this.sortMessages(currentList));
         this.notify(key);
         return;
       }
     }
 
     // 2) 其次按 seq 去重（对方发送的消息或历史消息重放）
     if (raw.seq && raw.seq > 0) {
       const matchBySeq = currentList.findIndex((m) => m.seq === raw.seq);
       if (matchBySeq >= 0) {
         // 已存在相同 seq 的消息，静默更新
         currentList[matchBySeq] = {
           ...currentList[matchBySeq],
           id: raw.id || currentList[matchBySeq].id,
           content: raw.content,
           status: 'sent'
         };
         this.messagesByConv.set(key, this.sortMessages(currentList));
         this.notify(key);
         return;
       }
     }
 
     // 3) 新消息添加
     currentList.push({
       id: raw.id,
       convId: key,
       seq: raw.seq || 0,
       clientMsgId: raw.clientMsgId,
       senderId: String(raw.senderId),
       type: (raw.type as any) || 'TEXT',
       content: raw.content,
       status: 'sent',
       createdAt: raw.ts || Date.now()
     });
 
     this.messagesByConv.set(key, this.sortMessages(currentList));
     this.notify(key);
   }
 
   /** 批量合并历史消息 */
   public mergeBatch(convId: string | number, list: any[]): void {
     list.forEach((item) => {
       this.mergeIncomingMessage({
         id: item.message_id || item.id,
         convId: item.conversation_id || convId,
         seq: Number(item.seq),
         clientMsgId: item.client_msg_id || item.clientMsgId,
         senderId: item.sender_id || item.senderId,
         type: item.content_type || item.type,
         content: item.content,
         ts: item.created_at ? new Date(item.created_at).getTime() : item.ts
       });
     });
   }
 }
 
 /** 全局单例消息仓库 */
 export const imStore = new ImMessageStore();
