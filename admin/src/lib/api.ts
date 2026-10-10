const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const TOKEN_KEY = 'f1z_admin_token'

export const auth = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ } },
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = auth.get()
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`${BASE}/api/admin${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером')
  }
  const data = await res.json().catch(() => null)
  if (res.status === 401 && path !== '/login') {
    auth.clear()
    window.dispatchEvent(new Event('f1z-logout'))
  }
  if (!res.ok) throw new ApiError(res.status, typeof data?.detail === 'string' ? data.detail : `Ошибка ${res.status}`)
  return data as T
}

export const money = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v)} грн`

export const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
