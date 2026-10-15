import { KeyRound, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { api, errMsg } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { Badge, Btn, Field, useToast } from '../ui'
import { uploadSessionFile } from './AccountSessionsUpload'

type PremiumSession = {
  premium_number_id: number; filename: string; two_fa: boolean; delivered_order_id: number | null; delivered_at: string | null
}

/** Upload / show / remove the .session bound to one premium number (kept out of the phone stock). */
export function PremiumSessionBox({ numberId, sold }: { numberId: number; sold: boolean }) {
  const toast = useToast()
  const { data, reload } = useApi<PremiumSession[]>('/premium-sessions')
  const input = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState<'telethon' | 'pyrogram'>('telethon')
  const [twoFa, setTwoFa] = useState('')
  const [busy, setBusy] = useState(false)
  const current = data?.find((s) => s.premium_number_id === numberId) ?? null

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || busy) return
    setBusy(true)
    try {
      await uploadSessionFile(`/premium-numbers/${numberId}/session`, file, format, twoFa)
      setTwoFa('')
      toast('Сессия проверена и привязана к номеру')
      reload(true)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api(`/premium-numbers/${numberId}/session`, { method: 'DELETE' })
      toast('Сессия удалена')
      reload(true)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-line p-4 sm:col-span-2">
      <div className="mb-2 flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> Сессия аккаунта для выдачи</div>
      {current ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={current.delivered_at ? 'violet' : 'green'} dot>
            {current.delivered_at ? `Выдана по заказу #${current.delivered_order_id}` : 'Загружена'}
          </Badge>
          <span className="break-all text-muted">{current.filename}{current.two_fa ? ' · 2FA сохранён' : ''}</span>
          {!current.delivered_at && (
            <Btn variant="danger" className="ml-auto" loading={busy} onClick={remove}><Trash2 className="h-4 w-4" /> Удалить</Btn>
          )}
        </div>
      ) : sold ? (
        <p className="text-sm text-muted">Номер продан — загрузка сессии недоступна.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">
            Загрузите .session именно этого номера: она проверится в Telegram и будет храниться отдельно от склада номеров.
            После оплаты в карточке заказа появится кнопка «Выдать аккаунт в бот».
          </p>
          <div className="grid gap-3 sm:grid-cols-[170px_1fr_auto]">
            <Field label="Формат">
              <select className="input" value={format} disabled={busy} onChange={(e) => setFormat(e.target.value as 'telethon' | 'pyrogram')}>
                <option value="telethon">Telethon</option>
                <option value="pyrogram">Pyrogram</option>
              </select>
            </Field>
            <Field label="Пароль 2FA (необязательно)">
              <input className="input" type="password" autoComplete="off" maxLength={128} value={twoFa} disabled={busy}
                onChange={(e) => setTwoFa(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Btn className="h-11 w-full" loading={busy} onClick={() => input.current?.click()}><Upload className="h-4 w-4" /> .session</Btn>
            </div>
          </div>
          <input ref={input} type="file" accept=".session" className="hidden" aria-label="Файл .session"
            onChange={(e) => { void pick(e) }} />
        </>
      )}
    </div>
  )
}
