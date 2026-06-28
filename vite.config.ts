import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split the heavy data file into its own chunk (loaded on demand by lazy pages)
          'fund-data': ['./src/data/funds.json'],
          // Keep React + router in a vendor chunk (cacheable across deploys)
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Recharts is only used on detail/compare pages
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
})
