import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { port: 5174, host: true, proxy: { '/api': 'http://localhost:8000' } },
  build: { target: 'es2020' },
})
