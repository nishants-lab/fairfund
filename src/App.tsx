import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import PageError from './components/PageError'
import { withChunkReload } from './lib/staleChunk'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'
import ScrollToTop from './components/ScrollToTop'
import UsageTracker from './components/UsageTracker'
import Onboarding from './components/Onboarding'
import InstallBanner from './components/InstallBanner'
import BackToTopFAB from './components/BackToTopFAB'
import { ToastProvider } from './components/Toast'

import NotFound from './pages/NotFound'

// Lazy-load heavy pages to reduce initial bundle size.
// Home stays eager (it's the landing page).
const Explore = lazy(withChunkReload(() => import('./pages/Explore')))
const FundDetail = lazy(withChunkReload(() => import('./pages/FundDetail')))
const Compare = lazy(withChunkReload(() => import('./pages/Compare')))
const Methodology = lazy(withChunkReload(() => import('./pages/Methodology')))
const Wishlist = lazy(withChunkReload(() => import('./pages/Wishlist')))
const SignIn = lazy(withChunkReload(() => import('./pages/SignIn')))
const MyDashboard = lazy(withChunkReload(() => import('./pages/MyDashboard')))
const Portfolio = lazy(withChunkReload(() => import('./pages/Portfolio')))
const Movers = lazy(withChunkReload(() => import('./pages/Movers')))
const CategoryDetail = lazy(withChunkReload(() => import('./pages/CategoryDetail')))
const Nfo = lazy(withChunkReload(() => import('./pages/Nfo')))

function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        <span className="text-sm text-muted">Loading…</span>
      </div>
    </div>
  )
}

export default function App() {
  const { pathname } = useLocation()
  return (
    <ToastProvider>
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <UsageTracker />
      <Navbar />
      <main className="flex-1">
        <PageError resetKey={pathname}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/movers" element={<Movers />} />
            <Route path="/fund/:code/:slug?" element={<FundDetail />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/methodology" element={<Methodology />} />
            <Route path="/wishlist" element={<Wishlist />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/my" element={<MyDashboard />} />
            <Route path="/my/portfolio" element={<Portfolio />} />
            <Route path="/category/:slug" element={<CategoryDetail />} />
            <Route path="/nfo" element={<Nfo />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </PageError>
      </main>
      <Footer />
      <Onboarding />
      <InstallBanner />
      <BackToTopFAB />
    </div>
    </ToastProvider>
  )
}
