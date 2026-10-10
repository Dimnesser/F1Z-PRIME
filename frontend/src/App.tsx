import { AnimatePresence, motion } from 'framer-motion'
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
import OrderDetail from './pages/OrderDetail'
import Orders from './pages/Orders'
import ProductPage from './pages/ProductPage'
import Profile from './pages/Profile'
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
    else if (['catalog', 'numbers', 'orders', 'profile', 'support'].includes(kind)) navigate(`/${kind}`)
  }, [navigate])
}

export default function App() {
  const location = useLocation()
  useStartParam()
  useEffect(() => window.scrollTo({ top: 0 }), [location.pathname])
  const { error } = useMe()
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return <AuthGate message={error.message} />

  return (
    <div className="relative z-10 mx-auto min-h-screen max-w-lg">
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="pb-nav px-4"
          style={{ paddingTop: 'calc(var(--safe-top) + 16px)' }}
        >
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/numbers" element={<Numbers />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/support" element={<Support />} />
            <Route path="/support/:id" element={<Ticket />} />
            <Route path="/product/:id" element={<ProductPage />} />
            <Route path="/number/:id" element={<NumberPage />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </motion.main>
      </AnimatePresence>
      <BottomNav />
    </div>
  )
}

function AuthGate({ message }: { message: string }) {
  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center">
      <Logo />
      <div className="mt-10 grid h-20 w-20 place-items-center rounded-[28px] bg-brand shadow-glow">
        <Send className="h-9 w-9 text-white" />
      </div>
      <h1 className="mt-6 font-display text-2xl font-bold">Откройте в Telegram</h1>
      <p className="mt-2 text-sm text-muted">{message}. Магазин F1Z PRIME работает как Telegram Mini App — запустите его кнопкой «🚀 Открыть магазин» в боте.</p>
    </div>
  )
}
