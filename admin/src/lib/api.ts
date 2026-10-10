import { inTelegram, tgInitData } from './telegram'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const TOKEN_KEY = 'f1z_admin_token'
// Inside Telegram the short-lived token lives only for this WebView session (never in the URL).
const store = (): Storage | null => {
  try { return inTelegram ? sessionStorage : localStorage } catch { return null }
}

export const auth = {
  get: () => {
    try { return store()?.getItem(TOKEN_KEY) ?? null } catch { return null }
  },
  set: (t: string) => { try { store()?.setItem(TOKEN_KEY, t) } catch { /* private mode */ } },
  clear: () => { try { store()?.removeItem(TOKEN_KEY) } catch { /* private mode */ } },
}

/** Exchange signed Telegram initData for a short-lived admin token (POST body, not URL). */
export async function telegramLogin(): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${BASE}/api/admin/telegram-login`, { method: 'POST', headers: { Authorization: `tma ${tgInitData()}` } })
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, typeof data?.detail === 'string' ? data.detail : `Ошибка ${res.status}`)
  auth.set(data.token as string)
}

let relogin: Promise<void> | null = null

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function request(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}, retried = false): Promise<Response> {
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = auth.get()
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`${BASE}/api/admin${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'Нет соединения с сервером')
  }
  if (res.status === 401 && path !== '/login') {
    auth.clear()
    // Mini App session expired: get a fresh token from initData once, then repeat the request.
    if (inTelegram && !retried) {
      try {
        relogin ??= telegramLogin().finally(() => { relogin = null })
        await relogin
        return request(path, init, true)
      } catch { /* fall through to logout */ }
    }
    window.dispatchEvent(new Event('f1z-logout'))
  }
  return res
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await request(path, init)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, typeof data?.detail === 'string' ? data.detail : `Ошибка ${res.status}`)
  return data as T
}

/** Downloads a protected file (CSV, backup) — auth header can't be sent with a plain <a href>. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await request(path)
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(res.status, typeof data?.detail === 'string' ? data.detail : `Ошибка ${res.status}`)
  }
  const blob = await res.blob()
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = match?.[1] ?? fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined) q.set(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
export const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : nf.format(v))
export const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${nf.format(v)} грн`)
export const compactMoney = (v: number) =>
  v >= 1_000_000 ? `${nf.format(Math.round(v / 100_000) / 10)}M` : v >= 10_000 ? `${nf.format(Math.round(v / 100) / 10)}K` : nf.format(Math.round(v))

export const dt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
export const dateShort = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} дн назад`
  return dt(iso)
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Ошибка')
