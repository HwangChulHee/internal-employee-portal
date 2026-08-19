import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 개발 중에도 same-origin으로 동작시켜 쿠키 문제를 피한다.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
