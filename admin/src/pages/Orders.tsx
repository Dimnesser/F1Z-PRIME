import { Download, Filter, History, User as UserIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge, Btn, Chips, DataTable, ErrorBox, Field, KV, METHOD, Modal, ORDER_STATUS, OrderBadge, PAYMENT_STATUS, PageHead, Pager,
  SearchInput, Skeleton, UserCell, useConfirm, useToast,
} from '../components/ui'
import { api, download, dt, errMsg, money, qs } from '../lib/api'
import { useCanManage } from '../lib/session'
import type { Order, OrderEvent, Paged, Payment } from '../lib/types'
import { useApi, useDebounced } from '../lib/useApi'

const FILTERS = ['', 'awaiting_payment', 'pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded', 'expired'] as const
type F = (typeof FILTERS)[number]
const SIZE = 25

export default function Orders() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') ?? '') as F
  const openId = Number(params.get('open')) || null
  const [search, setSearch] = useState('')
  const [method, setMethod] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const toast = useToast()
  const q = useDebounced(search)
  const filters = { status, search: q, method, date_from: from, date_to: to }
  const { data, loading, error, reload } = useApi<Paged<Order> & { counts: Record<string, number> }>(`/orders${qs({ ...filters, page, size: SIZE })}`)

  useEffect(() => { setPage(1) }, [status, q, method, from, to])
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : undefined

  return (
    <div className="fade-in">
      <PageHead title="Заказы" subtitle="Поиск, фильтры, детали и история изменений">
        <Btn variant="secondary" onClick={() => download(`/orders/export.csv${qs(filters)}`, 'orders.csv').catch((e) => toast(errMsg(e), 'error'))}>
          <Download className="h-4 w-4" /> CSV
        </Btn>
      </PageHead>
      <div className="mb-3 flex gap-2">
        <SearchInput className="flex-1" value={search} onChange={setSearch} placeholder="№ заказа, товар, @username или Telegram ID" />
        <Btn variant={showFilters || method || from || to ? 'primary' : 'secondary'} className="h-11 w-11 shrink-0 px-0 sm:w-auto sm:px-4" onClick={() => setShowFilters((v) => !v)}>
          <Filter className="h-4 w-4" /><span className="hidden sm:inline">Фильтры</span>
        </Btn>
      </div>
      {showFilters && (
        <div className="card mb-3 grid gap-3 p-4 sm:grid-cols-4">
          <Field label="Способ оплаты">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Все</option>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="С даты"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="По дату"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="flex items-end"><Btn variant="ghost" className="h-11 w-full" onClick={() => { setMethod(''); setFrom(''); setTo('') }}>Сбросить</Btn></div>
        </div>
      )}
      <Chips className="mb-4" value={status} onChange={(v) => setParam('status', v || null)}
        options={FILTERS.map((f) => ({ value: f, label: f ? ORDER_STATUS[f].label : 'Все', count: f === '' ? total : f === 'awaiting_payment' ? undefined : data?.counts[f] ?? 0 }))} />
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable
        rows={data?.items} loading={loading} rowKey={(o) => o.id} onRowClick={(o) => setParam('open', String(o.id))}
        columns={[
          { header: '№', cell: (o) => <span className="tabular font-mono text-muted">#{o.id}</span> },
          { header: 'Покупатель', cell: (o) => <UserCell u={o.user} /> },
          { header: 'Товар', cell: (o) => <div className="max-w-[260px] truncate font-semibold">{o.item_title}{o.quantity > 1 && <span className="text-muted"> × {o.quantity}</span>}</div> },
          { header: 'Сумма', align: 'right', cell: (o) => <span className="tabular font-bold">{money(o.total)}</span> },
          { header: 'Оплата', cell: (o) => <span className="text-muted">{o.payment_method ? METHOD[o.payment_method] ?? o.payment_method : '—'}</span> },
          { header: 'Статус', cell: (o) => <OrderBadge status={o.status} inReview={o.in_review} /> },
          { header: 'Дата', cell: (o) => <span className="whitespace-nowrap text-muted">{dt(o.created_at)}</span> },
        ]}
        card={(o) => (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold">{o.item_title}</div>
                <div className="mt-0.5 truncate text-xs text-muted">#{o.id} · {o.user.username ? `@${o.user.username}` : o.user.telegram_id} · {dt(o.created_at)}</div>
              </div>
              <span className="tabular shrink-0 font-bold">{money(o.total)}</span>
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <OrderBadge status={o.status} inReview={o.in_review} />
              <span className="text-xs text-muted">{o.payment_method ? METHOD[o.payment_method] : ''}</span>
            </div>
          </div>
        )}
      />
      {data && <Pager page={page} total={data.total} size={SIZE} onPage={setPage} />}
      {openId && <OrderDetail key={openId} id={openId} onClose={() => setParam('open', null)} onChanged={() => reload(true)} />}
    </div>
  )
}

interface Detail { order: Order; payments: Payment[]; events: OrderEvent[]; allowed: string[]; product: { id: number; category: string; delivery_note: string } | null }

const ACTION_LABEL: Record<string, string> = {
  processing: 'В обработку', completed: 'Выполнить и выдать', refunded: 'Вернуть деньги', cancelled: 'Отменить',
}

export function OrderDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged?: () => void }) {
  const { data, loading, error, reload } = useApi<Detail>(`/orders/${id}`)
  const manage = useCanManage()
  const confirm = useConfirm()
  const toast = useToast()
  const [delivery, setDelivery] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const o = data?.order

  const change = async (next: string) => {
    if (!o) return
    const danger = next === 'refunded' || next === 'cancelled'
    const ok = await confirm({
      title: `${ACTION_LABEL[next] ?? next} — заказ #${o.id}?`,
      danger,
      text: next === 'refunded' ? `${money(o.total)} вернутся на баланс покупателя. Действие необратимо.`
        : next === 'cancelled' ? 'Резерв товара будет снят. Покупатель получит уведомление.'
        : 'Покупатель получит уведомление в Telegram.',
      confirmLabel: ACTION_LABEL[next] ?? 'Подтвердить',
    })
    if (ok === false) return
    setBusy(next)
    try {
      await api(`/orders/${o.id}/status`, {
        method: 'POST',
        body: { status: next, delivery_data: delivery ?? undefined, admin_note: note ?? undefined },
      })
      toast(`Заказ #${o.id}: ${ORDER_STATUS[next].label}`)
      await reload(true)
      onChanged?.()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy('') }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={o ? `Заказ #${o.id}` : 'Заказ'} subtitle={o && <OrderBadge status={o.status} inReview={data?.payments.some((p) => p.status === 'awaiting_confirmation')} />}
      footer={manage && o && data!.allowed.length > 0 ? data!.allowed.map((s) => (
        <Btn key={s} variant={s === 'refunded' || s === 'cancelled' ? 'danger' : s === 'completed' ? 'primary' : 'secondary'} loading={busy === s} onClick={() => change(s)}>{ACTION_LABEL[s] ?? s}</Btn>
      )) : undefined}>
      {error && <ErrorBox text={error} />}
      {loading || !o ? <Skeleton className="h-64" /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KV label="Сумма">{money(o.total)}</KV>
            <KV label="Кол-во">{o.quantity} × {money(o.unit_price)}</KV>
            <KV label="Оплата">{o.payment_method ? METHOD[o.payment_method] ?? o.payment_method : '—'}</KV>
            <KV label="Создан">{dt(o.created_at)}</KV>
          </div>
          <div className="rounded-2xl bg-white/[0.03] p-3.5">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted"><UserIcon className="h-3.5 w-3.5" /> Покупатель</div>
            <UserCell u={o.user} sub={`ID ${o.user.telegram_id} · баланс ${money(o.user.balance)}`} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-muted">Товар</div>
            <div className="font-semibold">{o.item_title}</div>
          </div>
          {o.delivery_data && (
            <div className="rounded-2xl bg-success/10 p-3.5 text-sm">
              <div className="mb-1 text-xs font-semibold text-success">Выдано покупателю</div>
              <div className="whitespace-pre-wrap break-words">{o.delivery_data}</div>
            </div>
          )}
          {manage && data!.allowed.includes('completed') && (
            <Field label="Данные для выдачи (придут покупателю при завершении)" hint={!o.premium_number_id && data!.product?.delivery_note ? 'Пусто — покупатель увидит инструкцию товара.' : undefined}>
              <textarea className="input min-h-[80px]" value={delivery ?? o.delivery_data ?? ''} onChange={(e) => setDelivery(e.target.value)} placeholder="Например: код, ссылка или инструкция" />
            </Field>
          )}
          {manage && data!.allowed.length > 0 && (
            <Field label="Заметка администратора (видна только в админке)">
              <input className="input" value={note ?? o.admin_note ?? ''} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          {!manage && o.admin_note && <KV label="Заметка">{o.admin_note}</KV>}

          {data!.payments.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold text-muted">Платежи</div>
              <div className="space-y-1.5">
                {data!.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate">#{p.id} · {METHOD[p.method] ?? p.method}{p.user_comment ? ` · «${p.user_comment}»` : ''}</span>
                    <span className="flex shrink-0 items-center gap-2"><span className="tabular font-semibold">{money(p.amount)}</span><Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge></span>
                  </div>
                ))}
              </div>
              {data!.payments.some((p) => p.status === 'awaiting_confirmation') && manage && (
                <p className="mt-2 text-xs text-warning">Перевод ждёт проверки — подтвердите или отклоните его в разделе «Финансы → Платежи».</p>
              )}
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted"><History className="h-3.5 w-3.5" /> История изменений</div>
            {data!.events.length === 0 ? <div className="text-sm text-muted">История появится при следующем изменении статуса.</div> : (
              <ol className="relative space-y-3 border-l border-white/10 pl-4">
                {data!.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-surface" />
                    <div className="text-sm font-semibold">{ORDER_STATUS[e.to_status]?.label ?? e.to_status}</div>
                    <div className="text-xs text-muted">{dt(e.created_at)} · {e.actor}{e.note ? ` · ${e.note}` : ''}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
