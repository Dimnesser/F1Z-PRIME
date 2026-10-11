import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { clearChunkReloadFlag, ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { Skeleton } from './components/ui'
import { api, auth, telegramLogin } from './lib/api'
import { backToShop, initTelegram, inTelegram, attachTelegramBackButton } from './lib/telegram'
import { hasPerm, SessionCtx } from './lib/session'
import type { Counters, Me } from './lib/types'
import { NAV } from './components/Layout'
import Login from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Orders = lazy(() => import('./pages/Orders'))
const Users = lazy(() => import('./pages/Users'))
const Products = lazy(() => import('./pages/Products'))
const Premium = lazy(() => import('./pages/Premium'))
const Countries = lazy(() => import('./pages/Countries'))
const Finance = lazy(() => import('./pages/Finance'))
const Support = lazy(() => import('./pages/Support'))
const Automation = lazy(() => import('./pages/Automation'))
const Settings = lazy(() => import('./pages/Settings'))
const Promo = lazy(() => import('./pages/Promo'))
const Rules = lazy(() => import('./pages/Rules'))
const Team = lazy(() => import('./pages/Team'))
const System = lazy(() => import('./pages/System'))
const Inbox = lazy(() => import('./pages/Inbox'))

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  )
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [checking, setChecking] = useState(Boolean(auth.get()) || inTelegram)
  const [tgDenied, setTgDenied] = useState<string | null>(null)
  const [counters, setCounters] = useState<Counters>({ inbox: 0 })
  const location = useLocation()

  useEffect(() => {
    // the app loaded fine, so a later stale-chunk error may reload once again
    const t = window.setTimeout(clearChunkReloadFlag, 5000)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (inTelegram) {
      // Opened from the Mini App: sign in with Telegram initData (role is checked on the server).
      initTelegram()
      const cleanup = attachTelegramBackButton()
      ;(async () => {
        try {
          if (!auth.get()) await telegramLogin()
          setMe(await api<Me>('/me'))
        } catch (e) {
          auth.clear()
          setTgDenied((e as Error).message)
        } finally {
          setChecking(false)
        }
      })()
      const onLogout = () => setMe(null)
      window.addEventListener('f1z-logout', onLogout)
      return () => {
        cleanup()
        window.removeEventListener('f1z-logout', onLogout)
      }
    }
    if (auth.get()) {
      api<Me>('/me').then(setMe).catch(() => auth.clear()).finally(() => setChecking(false))
    }
    const onLogout = () => setMe(null)
    window.addEventListener('f1z-logout', onLogout)
    return () => window.removeEventListener('f1z-logout', onLogout)
  }, [])

  // badge counters for the navigation (open tickets, payments waiting for review)
  const refreshCounters = useCallback(async () => {
    try {
      setCounters(await api<Counters>('/counters'))
    } catch { /* not critical */ }
  }, [])
  useEffect(() => {
    if (!me) return
    void refreshCounters()
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCounters()
    }, 60_000)
    return () => window.clearInterval(t)
  }, [me, refreshCounters])

  if (checking) return <div className="grid min-h-screen place-items-center text-sm text-muted">Загрузка…</div>
  if (!me && inTelegram) return <TelegramDenied text={tgDenied ?? 'Сессия завершена'} />
  if (!me) return <Login onLogin={setMe} />

  const allow = (...perms: string[]) => hasPerm(me, ...perms)
  const home = NAV.find((n) => !n.perms || hasPerm(me, ...n.perms))?.to ?? '/inbox'
  return (
    <SessionCtx.Provider value={me}>
      <Layout counters={counters} onLogout={() => { auth.clear(); if (inTelegram) backToShop(); else setMe(null) }}>
        <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={allow('analytics.view') ? <Dashboard /> : <Navigate to={home} replace />} />
            {allow('orders.view') && <Route path="/orders" element={<Orders />} />}
            {allow('orders.view') && <Route path="/orders/:orderId" element={<Orders />} />}
            {allow('users.view') && <Route path="/users" element={<Users />} />}
            {allow('support.view') && <Route path="/support" element={<Support onChange={refreshCounters} />} />}
            <Route path="/settings" element={<Settings />} />
            <Route path="/inbox" element={<Inbox onChange={refreshCounters} />} />
            {allow('products.view') && <Route path="/products" element={<Products />} />}
            {allow('promo.manage') && <Route path="/promo" element={<Promo />} />}
            {allow('products.edit') && <Route path="/premium" element={<Premium />} />}
            {allow('products.edit') && <Route path="/countries" element={<Countries />} />}
            {allow('payments.view', 'finance.view') && <Route path="/finance" element={<Finance onChange={refreshCounters} />} />}
            {allow('system.view') && <Route path="/automation" element={<Automation />} />}
            {allow('system.view') && <Route path="/rules" element={<Rules />} />}
            {allow('system.view') && <Route path="/system" element={<System />} />}
            {allow('staff.manage', 'staff.roles', 'refunds.approve') && <Route path="/team" element={<Team onChange={refreshCounters} />} />}
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </Layout>
    </SessionCtx.Provider>
  )
}

function TelegramDenied({ text }: { text: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div className="fade-in max-w-xs">
        <img src="/admin/brand.jpg" alt="" className="mx-auto h-16 w-16 rounded-2xl object-cover ring-1 ring-white/10" />
        <h1 className="mt-5 font-display text-xl font-bold">Нет доступа</h1>
        <p className="mt-2 text-sm text-muted">{text}</p>
        <button type="button" onClick={backToShop} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-white shadow-glow">
          ← Вернуться в магазин
        </button>
      </div>
    </div>
  )
}
