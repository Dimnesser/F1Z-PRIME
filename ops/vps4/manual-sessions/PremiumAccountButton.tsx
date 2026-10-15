import { Send } from 'lucide-react'
import { useState } from 'react'
import { api, errMsg } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { Btn, useConfirm, useToast } from '../ui'

type State = { available: boolean; two_fa?: boolean; delivered_at?: string | null; can_send?: boolean }

/** Premium-number order: send the bound .session + 2FA to the buyer and complete the order. */
export function PremiumAccountButton({ orderId, onDone }: { orderId: number; onDone: () => void }) {
  const { data, reload } = useApi<State>(`/orders/${orderId}/premium-account`)
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  if (!data?.available) return null

  const send = async () => {
    if (await confirm({ title: 'Выдать аккаунт покупателю?', confirmLabel: 'Выдать',
      text: 'Бот отправит покупателю номер, файл .session и пароль 2FA. Заказ будет завершён.' }) === false) return
    setBusy(true)
    try {
      await api(`/orders/${orderId}/premium-account`, { method: 'POST' })
      toast('Аккаунт отправлен покупателю')
      reload(true)
      onDone()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line p-3 text-sm">
      <div className="font-semibold">Сессия красивого номера загружена{data.two_fa ? ' · 2FA сохранён' : ''}</div>
      {data.delivered_at
        ? <p className="mt-1 text-muted">Выдана покупателю {new Date(data.delivered_at).toLocaleString('ru-RU')}</p>
        : data.can_send
          ? <Btn className="mt-2" loading={busy} onClick={send}><Send className="h-4 w-4" /> Выдать аккаунт в бот</Btn>
          : <p className="mt-1 text-muted">Кнопка выдачи появится после оплаты заказа.</p>}
    </div>
  )
}
