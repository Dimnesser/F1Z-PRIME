import clsx from 'clsx'
import { Check, Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AreaChart, BarList } from '../components/charts'
import {
  Badge, Btn, Card, Chips, DataTable, ErrorBox, METHOD, PAYMENT_STATUS, PageHead, Pager, SearchInput, Skeleton, TX_TYPE, Tabs, UserCell,
  useConfirm, useToast,
} from '../components/ui'
import { api, compactMoney, download, dt, errMsg, money, num, qs } from '../lib/api'
import type { Paged, Payment, SeriesPoint } from '../lib/types'
import { useApi, useDebounced } from '../lib/useApi'

interface Summary {
  date_from: string; date_to: string; revenue: number; paid_orders: number; average_check: number; refunds: number; refunds_count: number
  topups: number; topups_count: number; users_balance_total: number; by_method: { method: string; revenue: number; orders: number }[]
  payment_statuses: Record<string, number>; daily: SeriesPoint[]
  failed_payments: { id: number; amount: number; method: string; kind: string; user: string; comment: string | null; created_at: string }[]
}
interface Tx { id: number; type: string; amount: number; balance_after: number; description: string; order_id: number | null; created_at: string; user: { id: number; telegram_id: number; username: string | null; first_name: string | null } }

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
function presetRange(p: string): { from: string; to: string } {
  const now = new Date()
  const days = (n: number) => iso(new Date(now.getTime() - n * 86400000))
  if (p === 'today') return { from: iso(now), to: iso(now) }
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) }
  return { from: days(Number(p) - 1), to: iso(now) }
}

export default function Finance({ onChange }: { onChange?: () => void }) {
  const [tab, setTab] = useState<'overview' | 'payments' | 'journal'>('overview')
  const [preset, setPreset] = useState('30')
  const [range, setRange] = useState(presetRange('30'))
  const toast = useToast()
  const pick = (p: string) => {
    setPreset(p)
    if (p !== 'custom') setRange(presetRange(p))
  }
  return (
    <div className="fade-in">
      <PageHead title="Финансы" subtitle="Суммы считаются только по подтверждённым платежам и движениям баланса">
        <Btn variant="secondary" onClick={() => download(`/finance/report.csv${qs({ date_from: range.from, date_to: range.to })}`, 'report.csv').catch((e) => toast(errMsg(e), 'error'))}>
          <Download className="h-4 w-4" /> Отчёт CSV
        </Btn>
      </PageHead>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Chips value={preset} onChange={pick} options={[
          { value: 'today', label: 'Сегодня' }, { value: '7', label: '7 дней' }, { value: '30', label: '30 дней' },
          { value: 'month', label: 'Этот месяц' }, { value: '90', label: '90 дней' }, { value: 'custom', label: 'Период…' },
        ]} />
        {preset === 'custom' && (
          <div className="flex w-full gap-2 sm:w-auto">
            <input className="input h-9 flex-1 sm:w-40" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="С" />
            <input className="input h-9 flex-1 sm:w-40" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="По" />
          </div>
        )}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Сводка' }, { value: 'payments', label: 'Платежи' }, { value: 'journal', label: 'Журнал операций' }]} />
      {tab === 'overview' && <Overview range={range} />}
      {tab === 'payments' && <Payments range={range} onChange={onChange} />}
      {tab === 'journal' && <Journal range={range} />}
    </div>
  )
}

function Overview({ range }: { range: { from: string; to: string } }) {
  const { data: d, error, reload } = useApi<Summary>(`/finance/summary${qs({ date_from: range.from, date_to: range.to })}`)
  if (error) return <ErrorBox text={error} onRetry={() => reload()} />
  if (!d) return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  const tiles = [
    { label: 'Выручка', value: money(d.revenue), sub: `${num(d.paid_orders)} оплаченных заказов`, cls: 'text-success' },
    { label: 'Средний чек', value: money(Math.round(d.average_check * 100) / 100), sub: 'по оплаченным заказам' },
    { label: 'Возвраты', value: money(d.refunds), sub: `${d.refunds_count} операций`, cls: d.refunds ? 'text-danger' : '' },
    { label: 'Пополнения', value: money(d.topups), sub: `${d.topups_count} подтверждённых` },
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card min-w-0 p-4">
            <div className="text-[12.5px] font-semibold text-muted">{t.label}</div>
            <div className={clsx('tabular mt-1.5 truncate font-display text-xl font-bold sm:text-2xl', t.cls)}>{t.value}</div>
            <div className="mt-0.5 truncate text-xs text-muted">{t.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Выручка по дням">
          <AreaChart data={d.daily.map((x) => ({ date: x.date, value: x.revenue ?? 0 }))} color="#22C55E" format={(v) => `${compactMoney(v)} грн`} />
        </Card>
        <Card title="Способы оплаты">
          {d.by_method.length === 0 ? <div className="py-6 text-center text-sm text-muted">Нет оплат за период</div>
            : <BarList items={d.by_method.map((m) => ({ label: METHOD[m.method] ?? m.method, value: m.revenue, sub: `${m.orders} шт` }))} />}
          <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
            {Object.entries(PAYMENT_STATUS).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2">
                <span className="text-muted">{v.label}</span><span className="tabular font-semibold">{d.payment_statuses[k] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Ошибки платежей (отклонённые)" pad={false}>
        {d.failed_payments.length === 0 ? <div className="px-5 pb-6 text-sm text-muted">За период отклонённых платежей нет.</div> : (
          <div className="divide-y divide-line/60">
            {d.failed_payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                <div className="min-w-0"><div className="truncate font-semibold">#{p.id} · {p.user} · {METHOD[p.method] ?? p.method}</div><div className="truncate text-xs text-muted">{dt(p.created_at)}{p.comment ? ` · ${p.comment}` : ''}</div></div>
                <span className="tabular shrink-0 font-semibold">{money(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <p className="text-xs text-muted">Деньги на балансах пользователей: <span className="tabular font-semibold text-ink">{money(d.users_balance_total)}</span></p>
    </div>
  )
}

const SIZE = 25
function Payments({ range, onChange }: { range: { from: string; to: string }; onChange?: () => void }) {
  const [status, setStatus] = useState('awaiting_confirmation')
  const [method, setMethod] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebounced(search)
  const filters = { status, method, search: q, date_from: status === 'awaiting_confirmation' ? '' : range.from, date_to: status === 'awaiting_confirmation' ? '' : range.to }
  const { data, loading, error, reload } = useApi<Paged<Payment>>(`/payments${qs({ ...filters, page, size: SIZE })}`)
  const confirm = useConfirm()
  const toast = useToast()
  useEffect(() => { setPage(1) }, [status, method, q, range.from, range.to])

  const decide = async (p: Payment, ok: boolean) => {
    const res = await confirm(ok ? {
      title: `Подтвердить перевод #${p.id} на ${money(p.amount)}?`,
      text: <>Подтверждайте только после того, как деньги <b className="text-ink">реально поступили</b> на счёт. {p.kind === 'order' ? `Заказ #${p.order_id} станет оплаченным.` : 'Сумма зачислится на баланс.'}{p.user_comment ? <><br /><br />Комментарий покупателя: «{p.user_comment}»</> : null}</>,
      confirmLabel: 'Деньги получены', input: { label: 'Комментарий (необязательно)', placeholder: 'Например: поступило на карту *1234' },
    } : {
      title: `Отклонить платёж #${p.id}?`, danger: true, confirmLabel: 'Отклонить',
      text: 'Покупатель получит уведомление с причиной.', input: { label: 'Причина (увидит покупатель)', required: true, placeholder: 'Платёж не найден' },
    })
    if (res === false) return
    try {
      await api(`/payments/${p.id}/${ok ? 'confirm' : 'reject'}`, { method: 'POST', body: { comment: res } })
      toast(ok ? 'Платёж подтверждён' : 'Платёж отклонён')
      reload(true)
      onChange?.()
    } catch (e) { toast(errMsg(e), 'error') }
  }
  const actions = (p: Payment) => p.status === 'awaiting_confirmation' && p.method === 'manual' && (
    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
      <Btn size="sm" variant="success" onClick={() => decide(p, true)}><Check className="h-3.5 w-3.5" /> Подтвердить</Btn>
      <Btn size="sm" variant="danger" onClick={() => decide(p, false)}><X className="h-3.5 w-3.5" /></Btn>
    </div>
  )

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput className="min-w-[200px] flex-1" value={search} onChange={setSearch} placeholder="№ платежа/заказа, @username, Telegram ID" />
        <select className="input w-auto" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Способ">
          <option value="">Все способы</option>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <Btn variant="secondary" className="h-11" onClick={() => download(`/payments/export.csv${qs(filters)}`, 'payments.csv').catch((e) => toast(errMsg(e), 'error'))}><Download className="h-4 w-4" /></Btn>
      </div>
      <Chips className="mb-4" value={status} onChange={setStatus} options={[
        { value: 'awaiting_confirmation', label: 'На проверке' }, { value: '', label: 'Все' }, { value: 'confirmed', label: 'Подтверждённые' },
        { value: 'rejected', label: 'Отклонённые' }, { value: 'pending', label: 'Не оплачены' }, { value: 'cancelled', label: 'Отменённые' },
      ]} />
      {status === 'awaiting_confirmation' && <p className="mb-3 text-xs text-muted">Здесь только ручные переводы, которые покупатель отметил как оплаченные. Платежи Telegram Stars подтверждаются автоматически.</p>}
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable rows={data?.items} loading={loading} rowKey={(p) => p.id} emptyText={status === 'awaiting_confirmation' ? 'Нет платежей на проверке 🎉' : 'Платежей нет'}
        columns={[
          { header: '№', cell: (p) => <span className="tabular font-mono text-muted">#{p.id}</span> },
          { header: 'Пользователь', cell: (p) => <UserCell u={p.user} /> },
          { header: 'Назначение', cell: (p) => <span className="whitespace-nowrap">{p.kind === 'topup' ? 'Пополнение' : `Заказ #${p.order_id}`}{p.is_test && <Badge tone="gray" className="ml-2">тест</Badge>}</span> },
          { header: 'Сумма', align: 'right', cell: (p) => <span className="tabular font-bold">{money(p.amount)}{p.stars_amount ? <span className="block text-xs font-normal text-muted">⭐ {p.stars_amount}</span> : null}</span> },
          { header: 'Способ', cell: (p) => METHOD[p.method] ?? p.method },
          { header: 'Статус', cell: (p) => <Badge tone={PAYMENT_STATUS[p.status].tone} dot>{PAYMENT_STATUS[p.status].label}</Badge> },
          { header: 'Комментарий', cell: (p) => <span className="block max-w-[200px] truncate text-muted" title={p.user_comment ?? p.admin_comment ?? ''}>{p.user_comment || p.admin_comment || '—'}</span> },
          { header: 'Дата', cell: (p) => <span className="whitespace-nowrap text-muted">{dt(p.created_at)}</span> },
          { header: '', align: 'right', cell: (p) => actions(p) },
        ]}
        card={(p) => (
          <div>
            <div className="flex items-start justify-between gap-3">
              <UserCell u={p.user} sub={`#${p.id} · ${p.kind === 'topup' ? 'Пополнение' : `Заказ #${p.order_id}`} · ${METHOD[p.method] ?? p.method}`} />
              <span className="tabular shrink-0 font-bold">{money(p.amount)}</span>
            </div>
            {p.user_comment && <div className="mt-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs text-muted">«{p.user_comment}»</div>}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge>
              {actions(p) || <span className="text-xs text-muted">{dt(p.created_at)}</span>}
            </div>
          </div>
        )} />
      {data && <Pager page={page} total={data.total} size={SIZE} onPage={setPage} />}
    </>
  )
}

function Journal({ range }: { range: { from: string; to: string } }) {
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebounced(search)
  const toast = useToast()
  const filters = { type, search: q, date_from: range.from, date_to: range.to }
  const { data, loading, error, reload } = useApi<Paged<Tx>>(`/finance/transactions${qs({ ...filters, page, size: SIZE })}`)
  useEffect(() => { setPage(1) }, [type, q, range.from, range.to])
  return (
    <>
      <div className="mb-3 flex gap-2">
        <SearchInput className="flex-1" value={search} onChange={setSearch} placeholder="@username, Telegram ID или описание" />
        <Btn variant="secondary" className="h-11" onClick={() => download(`/finance/transactions/export.csv${qs(filters)}`, 'transactions.csv').catch((e) => toast(errMsg(e), 'error'))}><Download className="h-4 w-4" /></Btn>
      </div>
      <Chips className="mb-4" value={type} onChange={setType} options={[{ value: '', label: 'Все' }, ...Object.entries(TX_TYPE).map(([k, v]) => ({ value: k, label: v.label }))]} />
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable rows={data?.items} loading={loading} rowKey={(t) => t.id}
        columns={[
          { header: 'Дата', cell: (t) => <span className="whitespace-nowrap text-muted">{dt(t.created_at)}</span> },
          { header: 'Пользователь', cell: (t) => <UserCell u={t.user} /> },
          { header: 'Тип', cell: (t) => <Badge tone={TX_TYPE[t.type]?.tone ?? 'gray'}>{TX_TYPE[t.type]?.label ?? t.type}</Badge> },
          { header: 'Описание', cell: (t) => <span className="block max-w-[320px] truncate" title={t.description}>{t.description}</span> },
          { header: 'Сумма', align: 'right', cell: (t) => <span className={clsx('tabular font-bold', t.amount > 0 && 'text-success')}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</span> },
          { header: 'Баланс после', align: 'right', cell: (t) => <span className="tabular text-muted">{money(t.balance_after)}</span> },
        ]}
        card={(t) => (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="truncate text-sm font-semibold">{t.description}</div><div className="text-xs text-muted">{t.user.username ? `@${t.user.username}` : t.user.telegram_id} · {dt(t.created_at)}</div></div>
              <span className={clsx('tabular shrink-0 font-bold', t.amount > 0 && 'text-success')}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</span>
            </div>
            <div className="mt-2"><Badge tone={TX_TYPE[t.type]?.tone ?? 'gray'}>{TX_TYPE[t.type]?.label ?? t.type}</Badge></div>
          </div>
        )} />
      {data && <Pager page={page} total={data.total} size={SIZE} onPage={setPage} />}
    </>
  )
}

