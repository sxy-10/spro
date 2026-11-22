/**
 * 第 5 棒 · 组员5（agency-web · 鉴权配置）
 *
 * 复用全项目共享鉴权包 shared-auth（与 C 端同一份实现，零复制）。
 * B 端与 C 端唯一的差异是持久化档位：
 *   - C 端：access token 只在内存（persist 'none' / 'refresh'），刷新页面重新登录；
 *   - B 端：客服台 / 大屏是「开着等咨询」的工作面，必须刷新不掉线，
 *           用 shared-auth 的 'full' 档 —— 完整令牌 + 用户 + 权限缓存落 localStorage，
 *           key 用 agency_* 前缀，与 prototype 的 web_* / C 端的 travel-agent.* 完全隔离。
 *
 * baseUrl 用同源相对路径 '/v1'：请求走 vite 代理（ws:true 同时代理 WebSocket），
 * 生产环境由 Nginx 反代到 3001，前端永远不需要知道后端地址。
 */
import { configureAuth, hydrateSession } from '@auth';

configureAuth({
  baseUrl: '/v1',
  apiPrefix: '/v1',
  refreshPath: '/auth/refresh',
  captchaHeader: 'X-Captcha-Id',
  persist: 'full',
  storage: 'local',
  cacheKeys: { tokens: 'agency_tokens', me: 'agency_me', perms: 'agency_perms' },
  loginPath: '#/login'
});

/** 从 localStorage 恢复上次会话（幂等，只在快照为空时执行一次） */
hydrateSession();
