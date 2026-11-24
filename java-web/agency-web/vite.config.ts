import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    // 开发期：前端热更新在 5174，接口同源代理到 Spring Boot :8080（浏览器仍认为同源）
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: {
    // 直接写进 Maven 的输出目录，随后被 spring-boot-maven-plugin 打进 jar：一个 jar = 后端 + 前端
    outDir: '../target/classes/static',
    emptyOutDir: true,
    sourcemap: false,
  },
})
