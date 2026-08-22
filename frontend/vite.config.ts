import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 개발 중에도 same-origin으로 동작시켜 쿠키 문제를 피한다.
    // 검증용으로 가짜 API 백엔드를 다른 포트에 띄울 때만 env로 바꾼다.
    proxy: {
      '/api': process.env.VITE_API_TARGET ?? 'http://localhost:8000',
    },
  },
})
