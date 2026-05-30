import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'
import Explore from './pages/Explore'
import FundDetail from './pages/FundDetail'
import Compare from './pages/Compare'
import Planner from './pages/Planner'
import Methodology from './pages/Methodology'
import ScrollToTop from './components/ScrollToTop'
import Onboarding from './components/Onboarding'
import ChatWidget from './components/ChatWidget'

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/fund/:code" element={<FundDetail />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/methodology" element={<Methodology />} />
        </Routes>
      </main>
      <Footer />
      <Onboarding />
      <ChatWidget />
    </div>
  )
}
