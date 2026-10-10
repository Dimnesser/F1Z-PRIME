import { motion } from 'framer-motion'
import { Boxes, CreditCard, Gem, Headphones, ShoppingCart, TrendingUp, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, ORDER_STATUS, PageHead, Skeleton, UserCell } from '../components/ui'
import { dt, money } from '../lib/api'
import type { Order, User } from '../lib/types'
import { useApi } from '../lib/useApi'

interface Dash {
  users: number; orders: number; paid_orders: number; revenue: number; stock: number; premium_available: number
  pending_payments: number; open_tickets: number; daily: { date: string; revenue: number; orders: number }[]
  recent_orders: Order[]; recent_users: User[]
}

export default function Dashboard() {
  const { data: d, loading } = useApi<Dash>('/dashboard')
  const stats = d ? [
    { label: 'Пользователи', value: d.users, icon: Users, tint: 'from-primary/30 to-primary/5 text-primary-soft' },
    { label: 'Заказы', value: `${d.orders}`, sub: `${d.paid_orders} оплачено`, icon: ShoppingCart, tint: 'from-secondary/30 to-secondary/5 text-secondary' },
    { label: 'Выручка', value: money(d.revenue), icon: TrendingUp, tint: 'from-success/30 to-success/5 text-success' },
    { label: 'Товары в наличии', value: d.stock, sub: `${d.premium_available} красивых номеров`, icon: Boxes, tint: 'from-warning/30 to-warning/5 text-warning' },
  ] : []
  const max = Math.max(1, ...(d?.daily.map((x) => x.revenue) ?? [1]))

  return (
    <div>
      <PageHead title="Dashboard" subtitle="Ключевые показатели магазина" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-3xl" />)}
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card relative overflow-hidden p-5">
            <div className={`absolute -right-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-br ${s.tint} blur-2xl`} />
            <div className={`relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${s.tint}`}><s.icon className="h-5 w-5" /></div>
            <div className="relative mt-4 text-[12px] font-semibold uppercase tracking-wider text-muted">{s.label}</div>
            <div className="relative mt-1 font-display text-2xl font-bold">{s.value}</div>
            {s.sub && <div className="relative text-xs text-muted">{s.sub}</div>}
          </motion.div>
        ))}
      </div>

      {d && (d.pending_payments > 0 || d.open_tickets > 0) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {d.pending_payments > 0 && <Link to="/payments" className="flex items-center gap-2 rounded-2xl bg-warning/10 px-4 py-3 text-sm font-semibold text-warning ring-1 ring-warning/25"><CreditCard className="h-4 w-4" /> {d.pending_payments} платежей ждут проверки</Link>}
          {d.open_tickets > 0 && <Link to="/support" className="flex items-center gap-2 rounded-2xl bg-secondary/10 px-4 py-3 text-sm font-semibold text-secondary ring-1 ring-secondary/25"><Headphones className="h-4 w-4" /> {d.open_tickets} открытых обращений</Link>}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display font-semibold">Выручка за 14 дней</h2>
            <Gem className="h-4 w-4 text-primary-soft" />
          </div>
          {d && d.daily.length === 0 && <div className="py-14 text-center text-sm text-muted">Оплаченных заказов пока нет</div>}
          <div className="flex h-48 gap-2 pt-8">
            {d?.daily.map((x) => (
              <div key={x.date} className="group flex max-w-[72px] flex-1 flex-col items-center gap-2">
                <div className="relative w-full flex-1">
                  <motion.div initial={{ height: 0 }} animate={{ height: `${(x.revenue / max) * 100}%` }} className="absolute bottom-0 w-full rounded-lg bg-brand opacity-80 group-hover:opacity-100" />
                  <div className="absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface px-2 py-1 text-[11px] font-bold group-hover:block">{money(x.revenue)}</div>
                </div>
                <span className="text-[10px] text-muted">{x.date.slice(8, 10)}.{x.date.slice(5, 7)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-4 font-display font-semibold">Новые пользователи</h2>
          <div className="space-y-3">
            {d?.recent_users.map((u) => (
              <div key={u.id} className="flex items-center justify-between">
                <UserCell u={u} />
                <span className="text-xs text-muted">{dt(u.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="font-display font-semibold">Последние заказы</h2>
          <Link to="/orders" className="text-sm font-semibold text-primary-soft">Все заказы →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">#</th><th className="th">Товар</th><th className="th">Покупатель</th><th className="th">Сумма</th><th className="th">Статус</th><th className="th">Дата</th></tr></thead>
            <tbody className="divide-y divide-white/[0.05]">
              {d?.recent_orders.map((o) => (
                <tr key={o.id} className="hover:bg-white/[0.02]">
                  <td className="td font-mono text-muted">#{o.id}</td>
                  <td className="td font-semibold">{o.item_title}</td>
                  <td className="td"><UserCell u={o.user} /></td>
                  <td className="td font-bold">{money(o.total)}</td>
                  <td className="td"><Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge></td>
                  <td className="td text-muted">{dt(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
