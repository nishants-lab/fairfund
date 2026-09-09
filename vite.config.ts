import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
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
  plugins: [
    react(),
    injectFundCount(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'FairFund - MF Research',
        short_name: 'FairFund',
        description: 'Forward-looking mutual fund research for India',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        scope: './',
        start_url: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell (JS, CSS, HTML, fonts, SVG)
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Exclude the massive per-fund JSON data from precache
        globIgnores: [
          '**/fund-data/**',
          '**/nav/**',
          '**/holdings-history/**',
          '**/category-median/**',
          '**/aum-index.json',
        ],
        runtimeCaching: [
          {
            // Fund metadata: changes with each data refresh (~weekly)
            urlPattern: /\/fund-data\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fund-data',
              expiration: { maxEntries: 1000, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // NAV series: changes daily, freshness matters
            urlPattern: /\/nav\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nav-data',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 1000, maxAgeSeconds: 2 * 24 * 60 * 60 },
            },
          },
          {
            // Holdings history: changes monthly
            urlPattern: /\/holdings-history\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'holdings',
              expiration: { maxEntries: 1000, maxAgeSeconds: 14 * 24 * 60 * 60 },
            },
          },
          {
            // Category medians: changes with data refresh
            urlPattern: /\/category-median\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cat-median',
              expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Google Fonts: effectively immutable
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
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
