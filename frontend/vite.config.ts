import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * 组员4（阶段三·前端状态流与网络层）
 * 代理目标从 .env 读取：
 *   VITE_API_PROXY_TARGET=http://127.0.0.1:3001   ← 本地后端
 *   VITE_API_PROXY_TARGET=https://m1.apifoxmock.com   ← 让 dev server 转发到 Mock 根域名
 * 真正决定前端请求去哪的仍然是 VITE_API_BASE_URL（见 src/lib/config.ts）。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'shared')
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');
            if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(normalizedId)) {
              return 'vendor-react';
            }
            if (normalizedId.includes('/node_modules/axios/')) {
              return 'vendor-http';
            }
          }
        }
      }
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
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
