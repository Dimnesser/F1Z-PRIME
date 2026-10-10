import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { clearChunkReloadFlag, ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { Skeleton } from './components/ui'
import { api, auth } from './lib/api'
import { SessionCtx } from './lib/session'
import type { Me } from './lib/types'
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
  const [checking, setChecking] = useState(Boolean(auth.get()))
  const [counters, setCounters] = useState({ tickets: 0, review: 0 })
  const location = useLocation()

  useEffect(() => {
    // the app loaded fine, so a later stale-chunk error may reload once again
    const t = window.setTimeout(clearChunkReloadFlag, 5000)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
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
      const d = await api<{ open_tickets: number; pending_payments: number }>('/dashboard?days=7')
      setCounters({ tickets: d.open_tickets, review: d.pending_payments })
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
  if (!me) return <Login onLogin={setMe} />

  const manager = me.role !== 'support'
  return (
    <SessionCtx.Provider value={me}>
      <Layout counters={counters} onLogout={() => { auth.clear(); setMe(null) }}>
        <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/users" element={<Users />} />
            <Route path="/support" element={<Support onChange={refreshCounters} />} />
            <Route path="/settings" element={<Settings />} />
            {manager && <Route path="/products" element={<Products />} />}
            {manager && <Route path="/premium" element={<Premium />} />}
            {manager && <Route path="/countries" element={<Countries />} />}
            {manager && <Route path="/finance" element={<Finance onChange={refreshCounters} />} />}
            {manager && <Route path="/automation" element={<Automation />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </Layout>
    </SessionCtx.Provider>
  )
}
