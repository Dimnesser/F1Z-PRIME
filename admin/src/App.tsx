import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { api, auth } from './lib/api'
import Countries from './pages/Countries'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Orders from './pages/Orders'
import Payments from './pages/Payments'
import Premium from './pages/Premium'
import Products from './pages/Products'
import Settings from './pages/Settings'
import Support from './pages/Support'
import Users from './pages/Users'

export default function App() {
  const [admin, setAdmin] = useState<string | null>(null)
  const [checking, setChecking] = useState(Boolean(auth.get()))

  useEffect(() => {
    if (auth.get()) {
      api<{ username: string }>('/me').then((r) => setAdmin(r.username)).catch(() => auth.clear()).finally(() => setChecking(false))
    }
    const onLogout = () => setAdmin(null)
    window.addEventListener('f1z-logout', onLogout)
    return () => window.removeEventListener('f1z-logout', onLogout)
  }, [])

  if (checking) return <div className="grid min-h-screen place-items-center text-muted">Загрузка…</div>
  if (!admin) return <Login onLogin={setAdmin} />

  return (
    <Layout admin={admin} onLogout={() => { auth.clear(); setAdmin(null) }}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/users" element={<Users />} />
        <Route path="/products" element={<Products />} />
        <Route path="/countries" element={<Countries />} />
        <Route path="/premium" element={<Premium />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/support" element={<Support />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}
