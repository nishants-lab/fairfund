import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { ThemeProvider } from './lib/theme.tsx'
import { AuthProvider } from './lib/auth.tsx'
import './index.css'
import { reloadForNewDeploy, reloadOnNewWorker } from './lib/staleChunk'

// A preload of a chunk the latest deploy replaced: reload once for the new build instead of failing.
window.addEventListener('vite:preloadError', e => { if (reloadForNewDeploy()) e.preventDefault() })
// A tab opened from the stored copy of the previous build: reload once when the new build's worker takes over.
reloadOnNewWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
