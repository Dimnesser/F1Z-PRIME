import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronRight, Copy, Headphones, Package, Plus, ShieldCheck, ShoppingCart, Wallet } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { useToast } from '../components/Toast'
import { Badge, Button, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { date, money, shortDate, TX_LABEL } from '../lib/format'
import { useConfig, useMe } from '../lib/queries'
import { useShop } from '../lib/shop'
import { openAdminPanel } from '../lib/telegram'

export default function Profile() {
  const navigate = useNavigate()
  const toast = useToast()
  const { topup } = useShop()
  const { data: me, isLoading } = useMe()
  const { data: config } = useConfig()
  const { data: txs, isLoading: txLoading } = useQuery({ queryKey: ['transactions'], queryFn: api.transactions })
  // shown only when the server confirms owner/admin for this Telegram account
  const { data: access } = useQuery({ queryKey: ['admin-access'], queryFn: api.adminAccess, staleTime: 60_000, retry: false })

  if (isLoading || !me) return <div className="space-y-4"><Skeleton className="h-48 rounded-[32px]" /><Skeleton className="h-40 rounded-3xl" /></div>

  return (
    <div className="space-y-5">
      <motion.div className="fade-in relative overflow-hidden rounded-[32px] bg-brand-soft p-5 text-center ring-1 ring-white/10">
        <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.60),transparent)]" />
        <div className="relative mx-auto w-fit"><Avatar me={me} size={84} /></div>
        <div className="relative mt-3 font-display text-xl font-bold">{[me.first_name, me.last_name].filter(Boolean).join(' ') || 'Пользователь'}</div>
        {me.username && <div className="relative text-sm text-muted">@{me.username}</div>}
        <button
          onClick={() => { navigator.clipboard?.writeText(String(me.telegram_id)); toast('ID скопирован', 'success') }}
          className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 font-mono text-[12.5px] font-semibold pressable"
        >
          ID {me.telegram_id} <Copy className="h-3.5 w-3.5 text-muted" />
        </button>
        {config?.dev_mode && <div className="relative mt-3"><Badge tone="amber">DEV_MODE · тестовый пользователь</Badge></div>}
      </motion.div>

      <div className="card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-[radial-gradient(closest-side,rgba(34,211,238,0.33),transparent)]" />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wider text-muted">Баланс</div>
            <div className="font-display text-3xl font-bold">{money(me.balance)}</div>
          </div>
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary-soft"><Wallet className="h-6 w-6" /></div>
        </div>
        <Button className="mt-4 w-full" size="md" onClick={topup}><Plus className="h-4 w-4" strokeWidth={3} /> Пополнить баланс</Button>
      </div>

      <motion.div className="stagger grid grid-cols-3 gap-2.5">
        {[
          { icon: ShoppingCart, label: 'Покупок', value: String(me.orders_count) },
          { icon: Wallet, label: 'Потрачено', value: money(me.total_spent) },
          { icon: CalendarDays, label: 'С нами с', value: shortDate(me.created_at).replace(' г.', '') },
        ].map(({ icon: Icon, label, value }) => (
          <motion.div key={label} className="card p-3.5">
            <Icon className="h-[18px] w-[18px] text-primary-soft" />
            <div className="mt-2 text-[11px] font-semibold text-muted">{label}</div>
            <div className="mt-0.5 text-[13.5px] font-bold leading-tight">{value}</div>
          </motion.div>
        ))}
      </motion.div>

      {access?.allowed && (
        <button
          type="button"
          onClick={openAdminPanel}
          className="fade-in group relative flex w-full items-center gap-3.5 overflow-hidden rounded-3xl bg-brand p-[1.5px] text-left shadow-glow pressable"
        >
          <span className="flex w-full items-center gap-3.5 rounded-[calc(1.5rem-1.5px)] bg-[linear-gradient(135deg,#1d1440_0%,#111027_55%,#0c1c26_100%)] px-4 py-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/20 text-primary-soft ring-1 ring-primary/30">
              <ShieldCheck className="h-[22px] w-[22px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-bold">🛡 Админ-панель</span>
              <span className="block truncate text-[12px] text-muted">
                {access.role === 'owner' ? 'Владелец' : 'Администратор'} · заказы, товары, финансы
              </span>
            </span>
            <ChevronRight className="h-5 w-5 text-primary-soft transition group-active:translate-x-0.5" />
          </span>
        </button>
      )}

      <div className="card divide-y divide-white/[0.06]">
        {[
          { icon: Package, label: 'Мои покупки', to: '/orders' },
          { icon: Headphones, label: 'Поддержка', to: '/support' },
        ].map(({ icon: Icon, label, to }) => (
          <button key={to} onClick={() => navigate(to)} className="flex w-full items-center gap-3 p-4 text-left pressable">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-primary-soft"><Icon className="h-[18px] w-[18px]" /></div>
            <span className="flex-1 text-[15px] font-semibold">{label}</span>
            <ChevronRight className="h-4 w-4 text-muted" />
          </button>
        ))}
      </div>

      <section>
        <h2 className="mb-3 px-1 font-display text-[17px] font-semibold">История операций</h2>
        {txLoading ? (
          <Skeleton className="h-40 rounded-3xl" />
        ) : !txs?.length ? (
          <div className="card p-5 text-center text-sm text-muted">Операций пока нет</div>
        ) : (
          <div className="card divide-y divide-white/[0.06]">
            {txs.map((t) => {
              const plus = t.amount > 0
              return (
                <div key={t.id} className="flex items-center gap-3 p-3.5">
                  <div className={`grid h-10 w-10 place-items-center rounded-xl ${plus ? 'bg-success/12 text-success' : 'bg-white/[0.05] text-ink'}`}>
                    {plus ? <ArrowDownLeft className="h-[18px] w-[18px]" /> : <ArrowUpRight className="h-[18px] w-[18px]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{TX_LABEL[t.type]}</div>
                    <div className="truncate text-[11.5px] text-muted">{t.description} · {date(t.created_at)}</div>
                  </div>
                  <div className={`font-display text-[14px] font-bold ${plus ? 'text-success' : ''}`}>{plus ? '+' : ''}{money(t.amount)}</div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
