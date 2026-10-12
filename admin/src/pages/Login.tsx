import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Btn, Field } from '../components/ui'
import { api, auth } from '../lib/api'
import type { Me } from '../lib/types'

export default function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const r = await api<{ token: string }>('/login', { method: 'POST', body: { username: username.trim(), password } })
      auth.set(r.token)
      onLogin(await api<Me>('/me'))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <form onSubmit={submit} className="fade-in w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/admin/brand.jpg" alt="F1Z PRIME" className="mx-auto h-16 w-16 rounded-2xl object-cover shadow-glow ring-1 ring-white/10" />
          <h1 className="mt-5 font-brand text-2xl font-bold">F1Z <span className="text-primary-soft">PRIME</span></h1>
          <p className="mt-1 text-sm text-muted">Панель управления магазином</p>
        </div>
        <div className="card space-y-4 p-6">
          <Field label="Логин"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus /></Field>
          <Field label="Пароль"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          {error && <div className="rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-danger">{error}</div>}
          <Btn type="submit" size="lg" className="w-full" loading={loading} disabled={!username || !password}><Lock className="h-4 w-4" /> Войти</Btn>
        </div>
      </form>
    </div>
  )
}
