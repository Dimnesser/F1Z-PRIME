import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ChevronRight, Package } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StatusBadge } from '../components/StatusBadge'
import { Button, EmptyState, PageTitle, Skeleton, stagger } from '../components/ui'
import { date, money } from '../lib/format'
import { useOrders } from '../lib/queries'
import { haptic } from '../lib/telegram'

const TABS = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Активные' },
  { id: 'done', label: 'Завершённые' },
] as const

export default function Orders() {
  const navigate = useNavigate()
  const { data, isLoading } = useOrders()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('all')
  const list = (data ?? []).filter((o) =>
    tab === 'all' ? true : tab === 'active' ? ['pending', 'paid', 'processing'].includes(o.status) : !['pending', 'paid', 'processing'].includes(o.status),
  )

  return (
    <div>
      <PageTitle title="Покупки" subtitle="История заказов и их статусы" />
      <div className="mb-5 grid grid-cols-3 gap-1 rounded-2xl bg-card p-1 ring-1 ring-white/[0.06]">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); haptic.select() }} className="relative rounded-xl py-2.5 text-[13px] font-bold">
            {tab === t.id && <motion.span layoutId="orders-tab" className="absolute inset-0 rounded-xl bg-white/[0.08]" />}
            <span className={clsx('relative', tab === t.id ? 'text-ink' : 'text-muted')}>{t.label}</span>
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] rounded-3xl" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Package className="h-7 w-7" />}
          title="Здесь пока пусто"
          text="Ваши заказы появятся здесь после первой покупки"
          action={<Button size="md" onClick={() => navigate('/catalog')}>Перейти в каталог</Button>}
        />
      ) : (
        <motion.div variants={stagger.container} initial="hidden" animate="show" className="space-y-3">
          {list.map((o) => (
            <motion.button
              key={o.id}
              variants={stagger.item}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(`/orders/${o.id}`)}
              className="card flex w-full items-center gap-3.5 p-4 text-left"
            >
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-soft font-display text-[13px] font-bold text-primary-soft ring-1 ring-white/10">
                #{o.id}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">{o.item_title}</div>
                <div className="mt-0.5 text-[12px] text-muted">{date(o.created_at)} · {o.quantity} шт</div>
                <div className="mt-2"><StatusBadge status={o.status} /></div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="font-display text-[16px] font-bold">{money(o.total)}</span>
                <ChevronRight className="h-4 w-4 text-muted" />
              </div>
            </motion.button>
          ))}
        </motion.div>
      )}
    </div>
  )
}
