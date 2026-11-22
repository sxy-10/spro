import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * 第 5 棒 · 组员5（agency-web：客服工作台 + 实时大屏）
 *
 * 三条复用约定（对应分工文档 5.4 与《交接-阶段4.md》§二）：
 *   @shared → frontend/shared        复用第 4 棒 WS 客户端底座 ws.ts（不复制第二份）
 *   @cend   → frontend/src/lib       复用第 4 棒本地消息仓库 imStore.ts（seq 排序 + 双去重 + 三态）
 *   @auth   → shared-auth            复用全项目共享鉴权包（B 端 persist:'full'）
 *
 * 代理：与 C 端同口径，target 从 .env 读 VITE_API_PROXY_TARGET；
 * ws:true 必须开 —— 客服台的 WS 走 /v1/im/ws，忘了它本地就连不上（第 4 棒踩过的坑）。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared'),
        '@cend': path.resolve(__dirname, '../src/lib'),
        '@auth': path.resolve(__dirname, '../../shared-auth')
      }
    },
    server: {
      host: '0.0.0.0',
      port: 5174,
      proxy: {
        '/v1': {
          target: proxyTarget,
          changeOrigin: true,
          ws: true
        }
      }
    }
  };
});
