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
        // VITE_PROXY_TARGET 可在 .env 中覆盖；默认 host.docker.internal（容器内访问宿主机后端）
        // Docker nginx 模式下此代理不生效，仅 Vite 直连（port 5173）时有效
        target: process.env.VITE_PROXY_TARGET || 'http://host.docker.internal:8080',
        changeOrigin: true,
        // Vite 代理与 Nginx 保持一致：将 /api 前缀去掉再转发
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
