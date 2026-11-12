/**
 * 组员5（阶段4 · 前端权限）
 *
 * 写请求幂等键。后端按 Idempotency-Key 缓存首次执行结果，重复提交同一个 key
 * 会被当成「同一次业务」直接返回旧结果 —— 所以「每次点保存都必须换新 key」，
 * 不能把 key 存在组件 state 里复用。
 *
 * 本轮只提供工具函数，不发起任何请求；下一轮接线时：
 *   request('/roles/1/permissions', 'PUT', {permission_ids}, { idempotencyKey })
 * lib/http.ts 的拦截器会优先使用这里传入的 key。
 */
export const newIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 老浏览器兜底：长度落在契约要求的 8–128 字符内
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
};
