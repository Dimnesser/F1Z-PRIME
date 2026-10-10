import { motion } from 'framer-motion'
import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Btn, Field } from '../components/ui'
import { api, auth } from '../lib/api'

export default function Login({ onLogin }: { onLogin: (name: string) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const r = await api<{ token: string; username: string }>('/login', { method: 'POST', body: { username, password } })
      auth.set(r.token)
      onLogin(r.username)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative z-10 grid min-h-screen place-items-center p-4">
      <motion.form initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit} className="card w-full max-w-sm p-8">
        <div className="mx-auto h-24 w-24 rounded-full bg-brand p-[3px] shadow-glow"><img src="/admin/brand.jpg" alt="F1Z PRIME" className="h-full w-full rounded-full object-cover" /></div>
        <h1 className="mt-5 text-center font-display text-2xl font-bold">F1Z <span className="text-gradient">PRIME</span></h1>
        <p className="mt-1 text-center text-sm text-muted">Панель администратора</p>
        <div className="mt-8 space-y-4">
          <Field label="Логин"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></Field>
          <Field label="Пароль"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus /></Field>
          {error && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
          <Btn className="h-12 w-full" loading={loading}><Lock className="h-4 w-4" /> Войти</Btn>
        </div>
      </motion.form>
    </div>
  )
}
