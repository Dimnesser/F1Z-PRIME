import { Search } from 'lucide-react'
import { useState } from 'react'
import { Badge, Btn, Field, METHOD, Modal, ORDER_STATUS, PageHead, Pager, Table, UserCell, useToast } from '../components/ui'
import { api, dt, money } from '../lib/api'
import type { Order } from '../lib/types'
import { useApi } from '../lib/useApi'

export default function Orders() {
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const qs = new URLSearchParams({ page: String(page), size: '25' })
  if (status) qs.set('status', status)
  if (q) qs.set('search', q)
  const { data, loading, reload } = useApi<{ total: number; items: Order[]; transitions: Record<string, string[]> }>(`/orders?${qs}`)
  const [open, setOpen] = useState<Order | null>(null)
  const [next, setNext] = useState('')
  const [delivery, setDelivery] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const openOrder = (o: Order) => {
    setOpen(o)
    setNext('')
    setDelivery(o.delivery_data ?? '')
    setNote(o.admin_note ?? '')
  }
  const apply = async () => {
    if (!open || !next) return
    if (next === 'refunded' && !confirm(`Вернуть ${money(open.total)} на баланс пользователя?`)) return
    setBusy(true)
    try {
      await api(`/orders/${open.id}/status`, { method: 'POST', body: { status: next, delivery_data: delivery || null, admin_note: note || null } })
      toast('Статус заказа обновлён, пользователь уведомлён')
      setOpen(null)
      reload()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const allowed = open && data ? data.transitions[open.status] ?? [] : []

  return (
    <div>
      <PageHead title="Orders" subtitle="Все заказы. Статусы меняются только по разрешённым переходам.">
        <form onSubmit={(e) => { e.preventDefault(); setQ(search); setPage(1) }} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input w-60 pl-9" placeholder="#id, товар, @user, TG ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <select className="input w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">Все статусы</option>
          {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </PageHead>
      <Table loading={loading} empty={data?.items.length === 0} head={['#', 'Товар', 'Покупатель', 'Сумма', 'Оплата', 'Статус', 'Создан']}>
        {data?.items.map((o) => (
          <tr key={o.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => openOrder(o)}>
            <td className="td font-mono text-muted">#{o.id}</td>
            <td className="td"><div className="font-semibold">{o.item_title}</div><div className="text-xs text-muted">{o.quantity} × {money(o.unit_price)}</div></td>
            <td className="td"><UserCell u={o.user} /></td>
            <td className="td font-bold">{money(o.total)}</td>
            <td className="td">{o.payment_method ? METHOD[o.payment_method] ?? o.payment_method : '—'}</td>
            <td className="td"><Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge></td>
            <td className="td text-muted">{dt(o.created_at)}</td>
          </tr>
        ))}
      </Table>
      {data && <Pager page={page} total={data.total} size={25} onPage={setPage} />}

      <Modal open={open !== null} onClose={() => setOpen(null)} title={`Заказ #${open?.id ?? ''}`} wide>
        {open && (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              {[['Товар', `${open.item_title} × ${open.quantity}`], ['Сумма', money(open.total)], ['Статус', ORDER_STATUS[open.status].label],
                ['Покупатель', `${open.user.first_name ?? ''} ${open.user.username ? '@' + open.user.username : ''} (${open.user.telegram_id})`],
                ['Оплачен', dt(open.paid_at)], ['Способ', open.payment_method ? METHOD[open.payment_method] : '—']].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-card p-3.5 ring-1 ring-white/[0.06]"><div className="text-[11px] font-semibold uppercase text-muted">{k}</div><div className="mt-1 text-sm font-semibold">{v}</div></div>
              ))}
            </div>
            {allowed.length === 0 ? (
              <div className="rounded-2xl bg-white/[0.04] p-4 text-sm text-muted">
                {open.status === 'pending' ? 'Заказ ожидает оплаты. Перевести в «Оплачен» можно только подтверждением платежа (раздел Payments). Доступна отмена.' : 'Финальный статус — изменения недоступны.'}
              </div>
            ) : null}
            {allowed.length > 0 && (
              <div className="space-y-4 rounded-2xl bg-card p-4 ring-1 ring-white/[0.06]">
                <div>
                  <span className="label">Новый статус</span>
                  <div className="flex flex-wrap gap-2">
                    {allowed.map((s) => (
                      <button key={s} onClick={() => setNext(s)} className={`rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 transition ${next === s ? 'bg-primary/20 ring-primary/50' : 'bg-white/[0.04] ring-white/[0.08] text-muted'}`}>
                        {ORDER_STATUS[s].label}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Данные выдачи (увидит покупатель)"><textarea className="input min-h-[80px] font-mono" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="Номер / код / инструкция" /></Field>
                <Field label="Заметка администратора"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <Btn className="h-11 w-full" loading={busy} disabled={!next} onClick={apply}>Применить</Btn>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
