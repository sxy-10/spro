import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 旅行社管理端（B 端 Web）子应用。
 * 与 C 端共用同一 Node 后端：dev 代理 /v1 → 127.0.0.1:3001。
 * 独立端口 5174，避免与 C 端 5173 冲突。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001';

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5174,
      proxy: {
        '/v1': {
          target: proxyTarget,
          changeOrigin: true
        }
      }
    }
  };
});
