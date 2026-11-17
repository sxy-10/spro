/**
 * 组员4（阶段三·前端状态流与网络层）
 * HTTP 薄壳：网络层实现已迁移至 shared-auth/src/http.js（跨端共享，fetch 零依赖）。
 *
 * 共享包拦截器做了四件事（与原 axios 实现行为一致）：
 * 1. 自动带 Authorization: Bearer <token>；
 * 2. 写请求自动补 Idempotency-Key，登录态下再补 X-Timestamp / X-Nonce / X-Signature
 *    （HMAC-SHA256，密钥=当前 token，签名原文与实际发出的 body 完全一致）；
 * 3. 剥掉 {code,message,data,trace_id} 外壳，code!==0 一律抛 ApiError；
 * 4. 401（业务码 20012）时「单飞」刷新令牌，成功后自动重放原请求一次（新 token 重签）；
 *    刷新失败则清空会话并抛 AuthExpiredError，UI 订阅到 expired 自动回登录页。
 *
 * 本文件保留 C 端 TS 类型与秒杀封装（sendSeckill / pollSeckillResult）。
 */
import { request } from '../../../shared-auth/index.js';

/** 后端统一响应外壳 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  trace_id?: string;
}

export { ApiError, AuthExpiredError, renewToken, hasAccessToken } from '../../../shared-auth/index.js';

/** 统一请求函数（泛型转发自共享包）：兼容旧签名 request(path, method, body, idempotencyKey|options) */
export { request };
export default request;

/* ------------------------------------------------------------------ */
/* 秒杀相关接口封装（组员4 · 阶段五）                                    */
/* ------------------------------------------------------------------ */
export interface SeckillSubmitResult {
  status: 'queued' | 'sold_out';
  req_id?: string;
}

export interface SeckillPollResult {
  status: 'pending' | 'success' | 'failed' | 'timeout';
  order_id?: number | null;
}

/**
 * 发起秒杀预扣请求：POST /v1/seckill/:routeId
 */
export async function sendSeckill(
  routeId: number | string,
  date: string,
  people: number = 1
): Promise<SeckillSubmitResult> {
  return request<SeckillSubmitResult>(`/seckill/${routeId}`, 'POST', { date, people });
}

/**
 * 轮询秒杀结果：GET /v1/seckill/result/:reqId
 * 默认间隔 1s，最多轮询 10 次
 */
export async function pollSeckillResult(
  reqId: string,
  maxAttempts = 10,
  intervalMs = 1000,
  onProgress?: (attempt: number, max: number) => void
): Promise<SeckillPollResult> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress?.(attempt, maxAttempts);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const res = await request<{ status: 'pending' | 'success' | 'failed'; order_id?: number }>(
        `/seckill/result/${encodeURIComponent(reqId)}`,
        'GET'
      );
      if (res && (res.status === 'success' || res.status === 'failed')) {
        return res;
      }
    } catch (err) {
      // 中间单次网络抖动不立即中断，继续尝试下一次轮询
      if (attempt >= maxAttempts) {
        throw err;
      }
    }
  }
  return { status: 'timeout' };
}
