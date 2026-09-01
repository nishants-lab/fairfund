import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'
import ScrollToTop from './components/ScrollToTop'
import Onboarding from './components/Onboarding'

import NotFound from './pages/NotFound'

// Lazy-load heavy pages to reduce initial bundle size.
// Home stays eager (it's the landing page).
const Explore = lazy(() => import('./pages/Explore'))
const FundDetail = lazy(() => import('./pages/FundDetail'))
const Compare = lazy(() => import('./pages/Compare'))
const Methodology = lazy(() => import('./pages/Methodology'))
const Wishlist = lazy(() => import('./pages/Wishlist'))
const SignIn = lazy(() => import('./pages/SignIn'))
const MyDashboard = lazy(() => import('./pages/MyDashboard'))
const Portfolio = lazy(() => import('./pages/Portfolio'))

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
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <Navbar />
      <main className="flex-1">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/fund/:code/:slug?" element={<FundDetail />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/methodology" element={<Methodology />} />
            <Route path="/wishlist" element={<Wishlist />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/my" element={<MyDashboard />} />
            <Route path="/my/portfolio" element={<Portfolio />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
      <Onboarding />

    </div>
  )
}
