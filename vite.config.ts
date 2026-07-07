import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Read the live fund count from the canonical index so static HTML stays in sync
// with the dataset. Injected into index.html at build time via the placeholder below.
const fundCount = (
  JSON.parse(
    readFileSync(new URL('./src/data/funds.json', import.meta.url), 'utf-8'),
  ) as { totalFunds: number }
).totalFunds

function injectFundCount() {
  return {
    name: 'inject-fund-count',
    transformIndexHtml(html: string) {
      return html.replace(/__FUND_COUNT__/g, String(fundCount))
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), injectFundCount()],
  base: './',
  define: {
    __DATA_VERSION__: JSON.stringify(Date.now().toString(36)),
  },
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
