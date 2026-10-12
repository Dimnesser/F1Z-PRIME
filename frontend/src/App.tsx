import { useEffect } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { Send } from 'lucide-react'
import { Logo } from './components/Logo'
import { ApiError } from './lib/api'
import { useMe } from './lib/queries'
import { startParam } from './lib/telegram'
import Catalog from './pages/Catalog'
import Home from './pages/Home'
import NumberPage from './pages/NumberPage'
import Numbers from './pages/Numbers'
import Sms from './pages/Sms'
import OrderDetail from './pages/OrderDetail'
import Orders from './pages/Orders'
import ProductPage from './pages/ProductPage'
import Profile from './pages/Profile'
import Balance from './pages/Balance'
import Support from './pages/Support'
import Ticket from './pages/Ticket'

function useStartParam() {
  const navigate = useNavigate()
  useEffect(() => {
    // t.me/<bot>/<app>?startapp=product_5 | number_3 | orders | support
    const p = startParam()
    if (!p) return
    const [kind, id] = p.split('_')
    if (kind === 'product' && id) navigate(`/product/${id}`)
    else if (kind === 'number' && id) navigate(`/number/${id}`)
    else if (['catalog', 'numbers', 'sms', 'orders', 'balance', 'profile', 'support'].includes(kind)) navigate(`/${kind}`)
  }, [navigate])
}

export default function App() {
  const location = useLocation()
  useStartParam()
  // Braces matter: in newer Chrome (153+) scroll methods return a Promise, and an arrow
  // expression body would hand it to React as the effect cleanup -> "i is not a function".
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])
  const { error } = useMe()
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return <AuthGate message={error.message} />

  return (
    <div className="relative z-10 mx-auto min-h-screen max-w-lg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-xl focus:bg-surface focus:px-3 focus:py-2">К содержимому</a>
      {/* No exit-animation gate between tabs: the new page always mounts immediately. */}
      <main id="main" key={location.pathname} className="fade-in pb-nav px-4" style={{ paddingTop: 'calc(var(--safe-top) + 14px)' }}>
        <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/numbers" element={<Numbers />} />
            <Route path="/sms" element={<Sms />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/balance" element={<Balance />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/support" element={<Support />} />
            <Route path="/support/:id" element={<Ticket />} />
            <Route path="/product/:id" element={<ProductPage />} />
            <Route path="/number/:id" element={<NumberPage />} />
            <Route path="*" element={<Home />} />
          </Routes>
      </main>
      <BottomNav />
    </div>
  )
}

function AuthGate({ message }: { message: string }) {
  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center">
      <Logo />
      <div className="mt-10 grid h-20 w-20 place-items-center rounded-[26px] bg-primary/15 text-primary-soft ring-1 ring-inset ring-primary/25">
        <Send className="h-9 w-9" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Откройте в Telegram</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">{message}. Магазин F1Z PRIME работает как Telegram Mini App — запустите его кнопкой «Открыть магазин» в боте.</p>
    </div>
  )
}
