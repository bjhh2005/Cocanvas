import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 通过 Nginx 对外暴露的端口（局域网设备访问时使用的端口），用于 HMR 回连
const publicPort = Number(process.env.VITE_PUBLIC_PORT || 8088)
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET
  || process.env.VITE_PROXY_TARGET
  || 'http://host.docker.internal:8080'
const wsProxyTarget = process.env.VITE_WS_PROXY_TARGET
  || process.env.VITE_PROXY_TARGET
  || 'http://host.docker.internal:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 监听所有网卡，允许局域网设备访问
    host: true,
    // 允许任意 Host 头（局域网 IP、主机名等），否则 Vite 会返回 "Blocked request"
    allowedHosts: true,
    // HMR 热更新通过 Nginx 的对外端口回连，保证局域网设备也能正常连上 websocket
    hmr: {
      clientPort: publicPort,
    },
    // 配置前端独立运行时的开发代理
    proxy: {
      '/api': {
        // 由于前端运行在 Docker 容器中，localhost 指向的是前端容器自己
        // 获取宿主机上的后端服务需要使用 host.docker.internal
        target: apiProxyTarget,
        changeOrigin: true,
        // Vite 代理跟 Nginx 保持一致的行为：将 /api 前缀去掉
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/ws': {
        target: wsProxyTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
})
