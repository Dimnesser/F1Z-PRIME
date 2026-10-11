import clsx from 'clsx'
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Boxes, Clock, CreditCard, Eye, EyeOff, Headphones, PackagePlus, Percent, Phone, ShoppingCart,
  SlidersHorizontal, TicketPercent, TrendingUp, UserPlus, Users, Wallet,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AreaChart, BarList, MiniBars } from '../components/charts'
import { StageBadge, orderNo, stageOf, type OrderX } from '../components/orders/shared'
import { Btn, Card, Chips, Empty, ErrorBox, Modal, PageHead, Skeleton, Toggle, useToast } from '../components/ui'
import { ago, api, compactMoney, errMsg, money, num } from '../lib/api'
import { hasPerm, useMe } from '../lib/session'
import type { SeriesPoint } from '../lib/types'
import { useApi } from '../lib/useApi'

interface Dash {
  finance_hidden?: boolean
  days: number; users: number; new_users_today: number; orders: number; paid_orders: number; orders_today: number
  revenue: number | null; revenue_today: number | null; revenue_period: number | null; stock: number; premium_available: number
  pending_orders: number; pending_payments: number; failed_payments: number; failed_fulfillments: number; phones_available: number; open_tickets: number; low_stock_threshold: number
  sales: SeriesPoint[]; new_users: SeriesPoint[]
  categories: { slug: string; title: string; revenue: number; orders: number }[]
  low_stock: { id: number; title: string; stock: number; flag: string | null; price: number }[]
  recent_orders: OrderX[]
}

/** Per-admin UI preferences (GET/PUT /prefs, free-form JSON shared with other pages — always merged). */
interface Prefs { dashboard?: { order?: string[]; hidden?: string[] }; compact?: boolean; [k: string]: unknown }

const WIDGETS: { id: string; label: string; span: string }[] = [
  { id: 'kpi', label: 'Ключевые показатели', span: 'xl:col-span-3' },
  { id: 'sales', label: 'Продажи', span: 'xl:col-span-2' },
  { id: 'new_users', label: 'Новые пользователи', span: '' },
  { id: 'recent_orders', label: 'Последние заказы', span: 'xl:col-span-2' },
  { id: 'categories', label: 'Популярные категории', span: '' },
  { id: 'low_stock', label: 'Низкие остатки', span: '' },
  { id: 'quick', label: 'Быстрые действия', span: 'xl:col-span-3' },
]
const DEFAULT_ORDER = WIDGETS.map((w) => w.id)

/** Applies the compact density class to <html> (styles in index.css). */
export function applyCompact(on: boolean) {
  document.documentElement.classList.toggle('compact', on)
}
const normalizeOrder = (order: string[] | undefined) => {
  const known = (order ?? []).filter((id) => DEFAULT_ORDER.includes(id))
  return [...known, ...DEFAULT_ORDER.filter((id) => !known.includes(id))]
}

function Stat({ icon: Icon, label, value, sub, tone = 'violet', to }: {
  icon: typeof Users; label: string; value: string; sub?: string; tone?: 'violet' | 'cyan' | 'green' | 'amber' | 'red'; to?: string
}) {
  const tones = {
    violet: 'bg-primary/15 text-primary-soft', cyan: 'bg-secondary/15 text-secondary', green: 'bg-success/15 text-success',
    amber: 'bg-warning/15 text-warning', red: 'bg-danger/15 text-danger',
  }
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-muted">{label}</span>
        <span className={clsx('grid h-8 w-8 place-items-center rounded-lg', tones[tone])}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="tabular mt-2 truncate font-display text-[22px] font-bold leading-tight sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </>
  )
  const cls = 'card block min-w-0 p-4 transition'
  return to ? <Link to={to} className={clsx(cls, 'hover:border-white/[0.12]')}>{body}</Link> : <div className={cls}>{body}</div>
}

export default function Dashboard() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30')
  const { data: d, loading, error, reload } = useApi<Dash>(`/dashboard?days=${days}`, { poll: 60_000 })
  const prefsApi = useApi<Prefs>('/prefs')
  const [customize, setCustomize] = useState(false)
  const navigate = useNavigate()
  const me = useMe()
  const can = (...p: string[]) => hasPerm(me, ...p)
  const finance = can('payments.view', 'finance.view')

  const prefs = prefsApi.data ?? {}
  const order = normalizeOrder(prefs.dashboard?.order)
  const hidden = new Set(prefs.dashboard?.hidden ?? [])
  useEffect(() => { if (prefsApi.data) applyCompact(Boolean(prefsApi.data.compact)) }, [prefsApi.data])

  const money_ = !d?.finance_hidden
  const periodOrders = d ? d.sales.reduce((s, x) => s + (x.orders ?? 0), 0) : 0

  const widgets: Record<string, ReactNode> = {
    kpi: (
      <div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {loading || !d ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />) : (<>
            {money_ && <Stat icon={Wallet} label="Общая выручка" value={money(d.revenue)} sub={`${num(d.paid_orders)} оплаченных заказов`} tone="green" to={finance ? '/finance' : undefined} />}
            {money_ && <Stat icon={TrendingUp} label="Выручка сегодня" value={money(d.revenue_today)} sub={`${d.orders_today} заказов сегодня`} tone="violet" />}
            {!money_ && <Stat icon={TrendingUp} label="Оплачено заказов" value={num(d.paid_orders)} sub={`${d.orders_today} сегодня`} tone="violet" />}
            <Stat icon={ShoppingCart} label="Заказы" value={num(d.orders)} sub={money_ ? `за ${d.days} дн: ${money(d.revenue_period)}` : `за ${d.days} дн оплачено: ${num(periodOrders)}`} tone="cyan" to={can('orders.view') ? '/orders' : undefined} />
            <Stat icon={Users} label="Пользователи" value={num(d.users)} sub={`+${d.new_users_today} сегодня`} tone="violet" to={can('users.view') ? '/users' : undefined} />
            <Stat icon={Boxes} label="Товаров в наличии" value={num(d.stock)} sub={`+ ${d.premium_available} красивых номеров`} tone="cyan" to={can('products.view') ? '/products' : undefined} />
            <Stat icon={Clock} label="Ожидают оплаты" value={num(d.pending_orders)} sub={d.pending_payments ? `${d.pending_payments} платежей на проверке` : 'нет платежей на проверке'} tone="amber" to={can('orders.view') ? '/orders?status=pending' : undefined} />
            <Stat icon={Phone} label="Номеров в наличии" value={num(d.phones_available)} sub={d.phones_available === 0 ? 'склад пуст' : 'готовы к продаже'} tone={d.phones_available === 0 ? 'red' : 'green'} to={can('products.view') ? '/phones' : undefined} />
            <Stat icon={AlertTriangle} label="Ошибки выдачи" value={num(d.failed_fulfillments)} sub={d.failed_fulfillments ? 'нужен оператор' : 'нет ошибок'} tone={d.failed_fulfillments ? 'red' : 'green'} to={can('orders.view') ? '/orders?status=paid' : undefined} />
            <Stat icon={AlertTriangle} label="Неудачные платежи" value={num(d.failed_payments)} sub="отклонённые" tone="red" to={finance ? '/finance' : undefined} />
            <Stat icon={Headphones} label="Открытые обращения" value={num(d.open_tickets)} sub="ждут ответа" tone="amber" to={can('support.view') ? '/support' : undefined} />
          </>)}
        </div>
        {d && d.pending_payments > 0 && can('payments.view') && (
          <Link to="/finance" className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm font-semibold text-warning ring-1 ring-warning/20">
            <span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> {d.pending_payments} ручных платежей ждут проверки</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    ),
    sales: (
      <Card className="h-full" title="Продажи"
        action={<Chips value={days} onChange={setDays} className="!mx-0 !px-0" options={[{ value: '7', label: '7 дн' }, { value: '30', label: '30 дн' }, { value: '90', label: '90 дн' }]} />}>
        {!d ? <Skeleton className="h-[240px]" /> : (
          <>
            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {money_ && <div><span className="text-muted">Выручка: </span><span className="tabular font-bold">{money(d.revenue_period)}</span></div>}
              <div><span className="text-muted">Заказов: </span><span className="tabular font-bold">{num(periodOrders)}</span></div>
            </div>
            {money_
              ? <AreaChart data={d.sales.map((x) => ({ date: x.date, value: x.revenue ?? 0 }))} format={(v) => `${compactMoney(v)} грн`} />
              : <AreaChart data={d.sales.map((x) => ({ date: x.date, value: x.orders ?? 0 }))} format={(v) => `${num(v)} шт`} />}
            {!money_ && <p className="mt-2 text-xs text-muted">Суммы скрыты — нет доступа к финансам. Показано число оплаченных заказов.</p>}
          </>
        )}
      </Card>
    ),
    new_users: (
      <Card className="h-full" title="Новые пользователи" action={d && <span className="tabular text-sm font-bold">+{num(d.new_users.reduce((s, x) => s + (x.users ?? 0), 0))}</span>}>
        {!d ? <Skeleton className="h-[240px]" /> : (
          <>
            <MiniBars data={d.new_users.map((x) => ({ date: x.date, value: x.users ?? 0 }))} height={150} />
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-xs text-muted">Сегодня</div><div className="tabular font-bold">+{d.new_users_today}</div></div>
              <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-xs text-muted">Всего</div><div className="tabular font-bold">{num(d.users)}</div></div>
            </div>
          </>
        )}
      </Card>
    ),
    recent_orders: (
      <Card className="h-full" pad={false} title="Последние заказы" action={can('orders.view') && <Link to="/orders" className="text-sm font-semibold text-primary-soft">Все →</Link>}>
        {!d ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : d.recent_orders.length === 0 ? <Empty title="Заказов пока нет" /> : (
          <div className="divide-y divide-white/[0.05]">
            {d.recent_orders.map((o) => (
              <button key={o.id} type="button" disabled={!can('orders.view')} onClick={() => navigate(`/orders/${o.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02] disabled:cursor-default sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="tabular shrink-0 font-mono text-xs text-muted">{orderNo(o)}</span>
                    <span className="truncate text-sm font-semibold">{o.item_title}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">{o.user.username ? `@${o.user.username}` : o.user.telegram_id} · {ago(o.created_at)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {money_ && <span className="tabular text-sm font-bold">{money(o.total)}</span>}
                  <StageBadge stage={stageOf(o)} />
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    ),
    categories: (
      <Card className="h-full" title="Популярные категории">
        {!d ? <Skeleton className="h-32" /> : d.categories.length === 0 ? <div className="py-6 text-center text-sm text-muted">Нет продаж за период</div> : money_ ? (
          <BarList items={d.categories.map((c) => ({ label: c.title, value: c.revenue, sub: `${c.orders} шт` }))} format={(v) => `${compactMoney(v)} грн`} />
        ) : (
          <BarList items={d.categories.map((c) => ({ label: c.title, value: c.orders }))} format={(v) => `${num(v)} шт`} />
        )}
      </Card>
    ),
    low_stock: (
      <Card className="h-full" title="Низкие остатки" action={d && <span className="text-xs text-muted">≤ {d.low_stock_threshold} шт</span>}>
        {!d ? <Skeleton className="h-24" /> : d.low_stock.length === 0 ? <div className="py-4 text-center text-sm text-muted">Всё в наличии 👌</div> : (
          <div className="space-y-1">
            {d.low_stock.map((p) => {
              const row = (<>
                <span className="truncate">{p.flag ?? '📦'} {p.title}</span>
                <span className={clsx('tabular shrink-0 font-bold', p.stock === 0 ? 'text-danger' : 'text-warning')}>{p.stock} шт</span>
              </>)
              const cls = 'flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm'
              return can('products.edit')
                ? <Link key={p.id} to={`/products?edit=${p.id}`} className={clsx(cls, 'hover:bg-white/[0.03]')}>{row}</Link>
                : <div key={p.id} className={cls}>{row}</div>
            })}
          </div>
        )}
      </Card>
    ),
    quick: <QuickActions can={can} />,
  }

  const visible = order.filter((id) => !hidden.has(id))

  return (
    <div className="fade-in">
      <PageHead title="Обзор" subtitle="Ключевые показатели магазина в реальном времени">
        <Btn variant="secondary" onClick={() => setCustomize(true)} disabled={!prefsApi.data && !prefsApi.error}>
          <SlidersHorizontal className="h-4 w-4" /> Настроить
        </Btn>
      </PageHead>
      {error && <div className="mb-4"><ErrorBox text={error} onRetry={() => reload()} /></div>}

      {visible.length === 0 ? (
        <div className="card"><Empty icon={EyeOff} title="Все виджеты скрыты" action={<Btn onClick={() => setCustomize(true)}>Настроить обзор</Btn>} /></div>
      ) : (
        <div className="grid gap-4 xl:grid-flow-row-dense xl:grid-cols-3">
          {visible.map((id) => {
            const w = WIDGETS.find((x) => x.id === id)!
            return <div key={id} className={clsx('min-w-0', w.span)}>{widgets[id]}</div>
          })}
        </div>
      )}

      {customize && (
        <Customize prefs={prefs} onClose={() => setCustomize(false)} onSaved={(p) => { prefsApi.setData(p); setCustomize(false) }} />
      )}
    </div>
  )
}

function QuickActions({ can }: { can: (...p: string[]) => boolean }) {
  const actions = [
    { to: '/products?new=1', icon: PackagePlus, label: 'Добавить товар', perms: ['products.edit'] },
    { to: '/products', icon: Percent, label: 'Изменить цены', perms: ['products.edit'] },
    { to: '/orders?status=paid', icon: ShoppingCart, label: 'Заказы к выдаче', perms: ['orders.view'] },
    { to: '/support?status=open', icon: Headphones, label: 'Ответить клиентам', perms: ['support.view'] },
    { to: '/finance', icon: CreditCard, label: 'Проверить платежи', perms: ['payments.view'] },
    { to: '/users', icon: UserPlus, label: 'Найти пользователя', perms: ['users.view'] },
    { to: '/promo', icon: TicketPercent, label: 'Промокоды', perms: ['promo.manage'] },
    { to: '/automation', icon: Clock, label: 'Автоматизация', perms: ['system.view'] },
  ].filter((a) => can(...a.perms))
  if (!actions.length) return null
  return (
    <Card title="Быстрые действия">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {actions.map((a) => (
          <Link key={a.label} to={a.to} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-3 text-sm font-semibold transition hover:bg-white/[0.06]">
            <a.icon className="h-[18px] w-[18px] shrink-0 text-primary-soft" /><span className="truncate">{a.label}</span>
          </Link>
        ))}
      </div>
    </Card>
  )
}

function Customize({ prefs, onClose, onSaved }: { prefs: Prefs; onClose: () => void; onSaved: (p: Prefs) => void }) {
  const [order, setOrder] = useState(() => normalizeOrder(prefs.dashboard?.order))
  const [hidden, setHidden] = useState(() => new Set(prefs.dashboard?.hidden ?? []))
  const [compact, setCompact] = useState(Boolean(prefs.compact))
  const [dragged, setDragged] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const move = (i: number, dir: -1 | 1) => setOrder((o) => {
    const j = i + dir
    if (j < 0 || j >= o.length) return o
    const next = [...o]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const dropOn = (target: string) => {
    if (!dragged || dragged === target) return
    setOrder((o) => {
      const next = o.filter((x) => x !== dragged)
      next.splice(next.indexOf(target), 0, dragged)
      return next
    })
  }
  const toggle = (id: string) => setHidden((h) => {
    const next = new Set(h)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const save = async (data: Prefs) => {
    setBusy(true)
    try {
      // re-read the latest prefs so keys written by other pages/devices are kept
      const current = await api<Prefs>('/prefs').catch(() => prefs)
      const saved = await api<Prefs>('/prefs', { method: 'PUT', body: { data: { ...current, ...data } } })
      applyCompact(Boolean(saved.compact))
      toast('Настройки обзора сохранены')
      onSaved(saved)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="Настройка обзора" subtitle="Сохраняется для вашей учётной записи на всех устройствах"
      footer={<>
        <Btn variant="ghost" disabled={busy} onClick={() => { setOrder(DEFAULT_ORDER); setHidden(new Set()); setCompact(false) }}>По умолчанию</Btn>
        <Btn loading={busy} onClick={() => save({ dashboard: { order, hidden: [...hidden] }, compact })}>Сохранить</Btn>
      </>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Компактный режим</div>
            <div className="text-xs text-muted">Меньше отступов — больше данных на экране (во всей панели)</div>
          </div>
          <Toggle checked={compact} onChange={setCompact} label="Компактный режим" />
        </div>
        <div>
          <div className="label">Виджеты — порядок и видимость</div>
          <ol className="space-y-1.5">
            {order.map((id, i) => {
              const w = WIDGETS.find((x) => x.id === id)!
              const off = hidden.has(id)
              return (
                <li key={id} draggable onDragStart={() => setDragged(id)} onDragEnd={() => setDragged(null)}
                  onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(id)}
                  className={clsx('flex items-center gap-2 rounded-xl border border-white/[0.06] bg-surface px-2 py-1.5', dragged === id && 'opacity-50')}>
                  <span className="w-5 shrink-0 text-center text-xs tabular text-muted">{i + 1}</span>
                  <span className={clsx('min-w-0 flex-1 truncate text-sm font-semibold', off && 'text-muted line-through')}>{w.label}</span>
                  <button type="button" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-ink disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label="Ниже" disabled={i === order.length - 1} onClick={() => move(i, 1)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-ink disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" aria-label={off ? 'Показать' : 'Скрыть'} onClick={() => toggle(id)} className={clsx('grid h-9 w-9 place-items-center rounded-lg hover:bg-white/[0.06]', off ? 'text-muted' : 'text-primary-soft')}>
                    {off ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="mt-2 text-xs text-muted">На компьютере строки можно перетаскивать мышью.</p>
        </div>
      </div>
    </Modal>
  )
}
