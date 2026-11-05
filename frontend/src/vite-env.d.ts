/// <reference types="vite/client" />

// 组员4（阶段三·前端状态流与网络层）：环境变量声明，集中在这里维护
interface ImportMetaEnv {
  /** 后端根地址。留空 = 走 Vite 代理（/v1 -> http://127.0.0.1:3001）；填 Apifox Mock 地址即为云端假数据 */
  readonly VITE_API_BASE_URL?: string;
  /** Vite 代理目标（仅 dev 生效） */
  readonly VITE_API_PROXY_TARGET?: string;
  /** =1 时把 refresh_token 存 sessionStorage，页面刷新后可静默续期；默认只在内存 */
  readonly VITE_AUTH_PERSIST?: string;
}
