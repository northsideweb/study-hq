import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // host: true also serves the app to other devices on the same wifi (phone, iPad),
    // not just this computer. Find the address printed as "Network:" when the app starts.
    host: true,
    port: 5220,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:4100', changeOrigin: true } },
  },
})
