import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: resolve(__dirname, 'node_modules/buffer'),
    },
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  server: {
    host: true,
    allowedHosts: ['.trycloudflare.com'],
    port: 5173,
    proxy: {
      // Proxy WebSocket connections to your game server
      '/socket': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/socket/, '')
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      },
      '/nft': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
