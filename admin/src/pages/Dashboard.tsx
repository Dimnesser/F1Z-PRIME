import clsx from 'clsx'
import {
  AlertTriangle, ArrowRight, Boxes, Clock, CreditCard, Headphones, PackagePlus, Percent, ShoppingCart, TrendingUp, UserPlus, Users, Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AreaChart, BarList, MiniBars } from '../components/charts'
import { Card, Chips, Empty, ErrorBox, OrderBadge, PageHead, Skeleton } from '../components/ui'
import { ago, compactMoney, money, num } from '../lib/api'
import { useCanManage } from '../lib/session'
import type { Order, SeriesPoint } from '../lib/types'
import { useApi } from '../lib/useApi'

interface Dash {
  days: number; users: number; new_users_today: number; orders: number; paid_orders: number; orders_today: number
  revenue: number; revenue_today: number; revenue_period: number; stock: number; premium_available: number
  pending_orders: number; pending_payments: number; failed_payments: number; open_tickets: number; low_stock_threshold: number
  sales: SeriesPoint[]; new_users: SeriesPoint[]
  categories: { slug: string; title: string; revenue: number; orders: number }[]
  low_stock: { id: number; title: string; stock: number; flag: string | null; price: number }[]
  recent_orders: Order[]
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
  const navigate = useNavigate()
  const manage = useCanManage()

  return (
    <div className="fade-in">
      <PageHead title="Обзор" subtitle="Ключевые показатели магазина в реальном времени" />
      {error && <div className="mb-4"><ErrorBox text={error} onRetry={() => reload()} /></div>}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {loading || !d ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />) : (<>
          <Stat icon={Wallet} label="Общая выручка" value={money(d.revenue)} sub={`${num(d.paid_orders)} оплаченных заказов`} tone="green" to={manage ? '/finance' : undefined} />
          <Stat icon={TrendingUp} label="Выручка сегодня" value={money(d.revenue_today)} sub={`${d.orders_today} заказов сегодня`} tone="violet" />
          <Stat icon={ShoppingCart} label="Заказы" value={num(d.orders)} sub={`за ${d.days} дн: ${money(d.revenue_period)}`} tone="cyan" to="/orders" />
          <Stat icon={Users} label="Пользователи" value={num(d.users)} sub={`+${d.new_users_today} сегодня`} tone="violet" to="/users" />
          <Stat icon={Boxes} label="Товаров в наличии" value={num(d.stock)} sub={`+ ${d.premium_available} красивых номеров`} tone="cyan" to={manage ? '/products' : undefined} />
          <Stat icon={Clock} label="Ожидают оплаты" value={num(d.pending_orders)} sub={d.pending_payments ? `${d.pending_payments} платежей на проверке` : 'нет платежей на проверке'} tone="amber" to="/orders" />
          <Stat icon={AlertTriangle} label="Неудачные платежи" value={num(d.failed_payments)} sub="отклонённые" tone="red" to={manage ? '/finance' : undefined} />
          <Stat icon={Headphones} label="Открытые обращения" value={num(d.open_tickets)} sub="ждут ответа" tone="amber" to="/support" />
        </>)}
      </div>

      {d && d.pending_payments > 0 && manage && (
        <Link to="/finance" className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-warning/10 px-4 py-3 text-sm font-semibold text-warning ring-1 ring-warning/20">
          <span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> {d.pending_payments} ручных платежей ждут проверки</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Продажи"
          action={<Chips value={days} onChange={setDays} className="!mx-0 !px-0" options={[{ value: '7', label: '7 дн' }, { value: '30', label: '30 дн' }, { value: '90', label: '90 дн' }]} />}>
          {!d ? <Skeleton className="h-[240px]" /> : (
            <>
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div><span className="text-muted">Выручка: </span><span className="tabular font-bold">{money(d.revenue_period)}</span></div>
                <div><span className="text-muted">Заказов: </span><span className="tabular font-bold">{num(d.sales.reduce((s, x) => s + (x.orders ?? 0), 0))}</span></div>
              </div>
              <AreaChart data={d.sales.map((x) => ({ date: x.date, value: x.revenue ?? 0 }))} format={(v) => `${compactMoney(v)} грн`} />
            </>
          )}
        </Card>
        <Card title="Новые пользователи" action={d && <span className="tabular text-sm font-bold">+{num(d.new_users.reduce((s, x) => s + (x.users ?? 0), 0))}</span>}>
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
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" pad={false} title="Последние заказы" action={<Link to="/orders" className="text-sm font-semibold text-primary-soft">Все →</Link>}>
          {!d ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : d.recent_orders.length === 0 ? <Empty title="Заказов пока нет" /> : (
            <div className="divide-y divide-white/[0.05]">
              {d.recent_orders.map((o) => (
                <button key={o.id} type="button" onClick={() => navigate(`/orders?open=${o.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02] sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="tabular text-xs text-muted">#{o.id}</span>
                      <span className="truncate text-sm font-semibold">{o.item_title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">{o.user.username ? `@${o.user.username}` : o.user.telegram_id} · {ago(o.created_at)}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="tabular text-sm font-bold">{money(o.total)}</span>
                    <OrderBadge status={o.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Популярные категории">
            {!d ? <Skeleton className="h-32" /> : d.categories.length === 0 ? <div className="py-6 text-center text-sm text-muted">Нет продаж за период</div> : (
              <BarList items={d.categories.map((c) => ({ label: c.title, value: c.revenue, sub: `${c.orders} шт` }))} />
            )}
          </Card>
          <Card title="Низкие остатки" action={d && <span className="text-xs text-muted">≤ {d.low_stock_threshold} шт</span>}>
            {!d ? <Skeleton className="h-24" /> : d.low_stock.length === 0 ? <div className="py-4 text-center text-sm text-muted">Всё в наличии 👌</div> : (
              <div className="space-y-1">
                {d.low_stock.map((p) => (
                  <Link key={p.id} to={manage ? `/products?edit=${p.id}` : '#'} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.03]">
                    <span className="truncate">{p.flag ?? '📦'} {p.title}</span>
                    <span className={clsx('tabular shrink-0 font-bold', p.stock === 0 ? 'text-danger' : 'text-warning')}>{p.stock} шт</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {manage && (
        <Card className="mt-4" title="Быстрые действия">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { to: '/products?new=1', icon: PackagePlus, label: 'Добавить товар' },
              { to: '/products', icon: Percent, label: 'Изменить цены' },
              { to: '/orders?status=paid', icon: ShoppingCart, label: 'Заказы к выдаче' },
              { to: '/support?status=open', icon: Headphones, label: 'Ответить клиентам' },
              { to: '/finance', icon: CreditCard, label: 'Проверить платежи' },
              { to: '/users', icon: UserPlus, label: 'Найти пользователя' },
              { to: '/automation', icon: Clock, label: 'Автоматизация' },
              { to: '/settings', icon: Boxes, label: 'Настройки магазина' },
            ].map((a) => (
              <Link key={a.label} to={a.to} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-3 text-sm font-semibold transition hover:bg-white/[0.06]">
                <a.icon className="h-[18px] w-[18px] shrink-0 text-primary-soft" /><span className="truncate">{a.label}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
      {!manage && <p className="mt-4 text-xs text-muted">Режим поддержки: доступны обращения, заказы и пользователи (только просмотр).</p>}
    </div>
  )
}
