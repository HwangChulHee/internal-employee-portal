import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 개발 중에도 same-origin으로 동작시켜 쿠키 문제를 피한다.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
