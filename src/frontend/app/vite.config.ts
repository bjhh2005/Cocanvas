import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 配置前端独立运行时的开发代理
    proxy: {
      '/api': {
        // 由于前端运行在 Docker 容器中，localhost 指向的是前端容器自己
        // 获取宿主机上的后端服务需要使用 host.docker.internal
        target: process.env.VITE_PROXY_TARGET || 'http://host.docker.internal:8080' || 'http://localhost:8080',
        changeOrigin: true,
        // Vite 代理跟 Nginx 保持一致的行为：将 /api 前缀去掉
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/ws': {
        target: process.env.VITE_PROXY_TARGET || 'http://host.docker.internal:8080',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
