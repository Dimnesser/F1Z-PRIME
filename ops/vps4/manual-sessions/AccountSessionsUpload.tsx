import { CheckCircle2, Loader2, Upload, XCircle } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { auth } from '../../lib/api'
import { Btn, Card, Field } from '../ui'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

type SessionFormat = 'telethon' | 'pyrogram'

/** Raw .session upload; the optional 2FA password goes in a header (URL-encoded), never in the URL. */
export async function uploadSessionFile<T>(path: string, file: File, format: SessionFormat, twoFa: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
  const token = auth.get()
  if (token) headers.Authorization = `Bearer ${token}`
  if (twoFa.trim()) headers['X-Account-2FA'] = encodeURIComponent(twoFa.trim())
  const query = `format=${format}&filename=${encodeURIComponent(file.name)}`
  let res: Response
  try {
    res = await fetch(`${BASE}/api/admin${path}?${query}`, { method: 'POST', headers, body: file })
  } catch {
    throw new Error('Нет соединения с сервером')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `Ошибка ${res.status}`)
  return data as T
}

type Uploaded = { phone: string; country: string | null; two_fa: boolean; stock: number }
type Row = { name: string; state: 'wait' | 'ok' | 'error'; note: string }

export function AccountSessionsUpload({ onSaved }: { onSaved?: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState<SessionFormat>('telethon')
  const [twoFa, setTwoFa] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!files.length || busy) return
    setBusy(true)
    const list: Row[] = files.map((f) => ({ name: f.name, state: 'wait', note: 'Проверяем в Telegram…' }))
    setRows([...list])
    let added = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file.name.toLowerCase().endsWith('.session')) {
        list[i] = { name: file.name, state: 'error', note: 'Нужен файл .session' }
      } else {
        try {
          const r = await uploadSessionFile<Uploaded>('/manual-sessions/accounts', file, format, twoFa)
          added++
          list[i] = { name: file.name, state: 'ok',
            note: `${r.phone}${r.country ? ` · ${r.country}` : ''}${r.two_fa ? ' · 2FA сохранён' : ''} · на складе: ${r.stock}` }
        } catch (e) {
          list[i] = { name: file.name, state: 'error', note: (e as Error).message }
        }
      }
      setRows([...list])
    }
    setBusy(false)
    if (added) onSaved?.()
  }

  return (
    <Card title={<span className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary-soft" />Рандом аккаунты 2015–2019: загрузка сессий</span>}>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Каждый файл проверяется в Telegram (сессия авторизована, на аккаунте только это устройство) и попадает на склад
        товара «Рандом аккаунт 2015–2019». После оплаты бот сам отправит покупателю номер, .session, пароль 2FA и кнопку
        «Получить код». В обычный склад номеров эти аккаунты не попадают.
      </p>
      <div className="grid max-w-xl gap-4 sm:grid-cols-2">
        <Field label="Формат файлов">
          <select className="input" value={format} disabled={busy} onChange={(e) => setFormat(e.target.value as SessionFormat)}>
            <option value="telethon">.session Telethon</option>
            <option value="pyrogram">.session Pyrogram</option>
          </select>
        </Field>
        <Field label="Пароль 2FA (необязательно)" hint="Применится ко всем выбранным файлам">
          <input className="input" type="password" autoComplete="off" maxLength={128} value={twoFa} disabled={busy}
            onChange={(e) => setTwoFa(e.target.value)} />
        </Field>
      </div>
      <input ref={input} type="file" accept=".session" multiple className="hidden" aria-label="Файлы .session"
        onChange={(e) => { void pick(e) }} />
      <Btn className="mt-4" loading={busy} onClick={() => input.current?.click()}><Upload className="h-4 w-4" /> Выбрать файлы .session</Btn>
      {rows.length > 0 && (
        <ul className="mt-4 space-y-2" aria-live="polite">
          {rows.map((r, i) => (
            <li key={`${i}:${r.name}`} className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm">
              {r.state === 'wait' ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted" />
                : r.state === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
              <div className="min-w-0"><div className="break-all font-semibold">{r.name}</div><div className="text-muted">{r.note}</div></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
