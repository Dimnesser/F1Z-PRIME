import { Download, Filter } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { OrderDetail } from '../components/orders/OrderCard'
import { StageBadge, orderNo, stageOf, type OrderX } from '../components/orders/shared'
import {
  Btn, Chips, DataTable, ErrorBox, Field, METHOD, ORDER_STATUS, PageHead, Pager, SearchInput, UserCell, useToast,
} from '../components/ui'
import { download, dt, errMsg, money, qs } from '../lib/api'
import { useCan } from '../lib/session'
import type { Paged } from '../lib/types'
import { useApi, useDebounced } from '../lib/useApi'

const FILTERS = ['', 'awaiting_payment', 'pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded', 'expired'] as const
type F = (typeof FILTERS)[number]
const SIZE = 25

export default function Orders() {
  const [params, setParams] = useSearchParams()
  const { orderId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const status = (params.get('status') ?? '') as F
  const openId = Number(orderId) || null
  const canExport = useCan('orders.export')
  const [search, setSearch] = useState('')
  const [method, setMethod] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const toast = useToast()
  // public number F1Z-000123 is derived from the internal id — the list search understands plain digits
  const q = useDebounced(search).trim().replace(/^f1z-0*(\d+)$/i, '$1')
  const filters = { status, search: q, method, date_from: from, date_to: to }
  const { data, loading, error, reload } = useApi<Paged<OrderX> & { counts: Record<string, number> }>(`/orders${qs({ ...filters, page, size: SIZE })}`)

  useEffect(() => { setPage(1) }, [status, q, method, from, to])
  // legacy links (?open=123) → /orders/123, keeping the other filters in the query
  useEffect(() => {
    const legacy = Number(params.get('open'))
    if (!legacy) return
    const next = new URLSearchParams(params)
    next.delete('open')
    const s = next.toString()
    navigate(`/orders/${legacy}${s ? `?${s}` : ''}`, { replace: true })
  }, [params, navigate])
  const openOrder = (id: number) => navigate(`/orders/${id}${location.search}`)
  const closeOrder = () => navigate(`/orders${location.search}`)
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : undefined

  return (
    <div className="fade-in">
      <PageHead title="Заказы" subtitle="Поиск, фильтры, этапы выдачи и хронология заказа">
        {canExport && <Btn variant="secondary" onClick={() => download(`/orders/export.csv${qs(filters)}`, 'orders.csv').catch((e) => toast(errMsg(e), 'error'))}>
          <Download className="h-4 w-4" /> CSV
        </Btn>}
      </PageHead>
      <div className="mb-3 flex gap-2">
        <SearchInput className="flex-1" value={search} onChange={setSearch} placeholder="F1Z-000123, товар, @username или Telegram ID" />
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
        rows={data?.items} loading={loading} rowKey={(o) => o.id} onRowClick={(o) => openOrder(o.id)}
        columns={[
          { header: '№', cell: (o) => <span className="tabular whitespace-nowrap font-mono text-muted">{orderNo(o)}</span> },
          { header: 'Покупатель', cell: (o) => <UserCell u={o.user} /> },
          { header: 'Товар', cell: (o) => <div className="max-w-[260px] truncate font-semibold">{o.item_title}{o.quantity > 1 && <span className="text-muted"> × {o.quantity}</span>}</div> },
          { header: 'Сумма', align: 'right', cell: (o) => <span className="tabular font-bold">{money(o.total)}</span> },
          { header: 'Оплата', cell: (o) => <span className="text-muted">{o.payment_method ? METHOD[o.payment_method] ?? o.payment_method : '—'}</span> },
          { header: 'Этап', cell: (o) => <StageBadge stage={stageOf(o)} /> },
          { header: 'Дата', cell: (o) => <span className="whitespace-nowrap text-muted">{dt(o.created_at)}</span> },
        ]}
        card={(o) => (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold">{o.item_title}</div>
                <div className="mt-0.5 truncate text-xs text-muted">{orderNo(o)} · {o.user.username ? `@${o.user.username}` : o.user.telegram_id} · {dt(o.created_at)}</div>
              </div>
              <span className="tabular shrink-0 font-bold">{money(o.total)}</span>
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <StageBadge stage={stageOf(o)} />
              <span className="text-xs text-muted">{o.payment_method ? METHOD[o.payment_method] : ''}</span>
            </div>
          </div>
        )}
      />
      {data && <Pager page={page} total={data.total} size={SIZE} onPage={setPage} />}
      {openId && <OrderDetail key={openId} id={openId} onClose={closeOrder} onChanged={() => reload(true)} />}
    </div>
  )
}

export { OrderDetail }
