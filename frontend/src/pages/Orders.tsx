import { ChevronRight, Package } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OrderStageBadge } from '../components/StatusBadge'
import { Button, Chips, EmptyState, ErrorState, PageTitle, Skeleton } from '../components/ui'
import { date, money } from '../lib/format'
import { useOrders } from '../lib/queries'
import { haptic } from '../lib/telegram'
import type { Order } from '../lib/types'

type Group = 'active' | 'done' | 'cancelled' | 'refunded'

/** Uses the server-computed stage; the raw status is a fallback for older rows. */
export function orderGroup(o: Order): Group {
  if (o.stage === 'refunded' || o.status === 'refunded') return 'refunded'
  if (o.stage === 'cancelled' || o.status === 'cancelled' || o.status === 'expired') return 'cancelled'
  if (o.stage === 'delivered' || o.status === 'completed') return 'done'
  return 'active'
}

const EMPTY: Record<Group, { title: string; text: string }> = {
  active: { title: 'Нет активных заказов', text: 'Здесь появятся заказы, которые ждут оплаты или выдачи' },
  done: { title: 'Пока нет покупок', text: 'Выполненные заказы и выданные товары появятся здесь' },
  cancelled: { title: 'Отменённых нет', text: 'Сюда попадают отменённые заказы и истёкшие резервы' },
  refunded: { title: 'Возвратов нет', text: 'Если по заказу будет возврат, он отобразится здесь' },
}

export default function Orders() {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useOrders()
  const counts = useMemo(() => {
    const c: Record<Group, number> = { active: 0, done: 0, cancelled: 0, refunded: 0 }
    for (const o of data ?? []) c[orderGroup(o)]++
    return c
  }, [data])
  const [tab, setTab] = useState<Group | null>(null)
  // open on «Активные» when something is in progress, otherwise on the purchase history
  const current: Group = tab ?? (counts.active > 0 || !data?.length ? 'active' : 'done')
  const list = (data ?? []).filter((o) => orderGroup(o) === current)

  return (
    <div>
      <PageTitle title="Заказы" subtitle="Статусы, выданные товары и история покупок" />
      <Chips
        className="mb-4"
        value={current}
        onChange={setTab}
        options={[
          { value: 'active', label: 'Активные', count: counts.active || undefined },
          { value: 'done', label: 'Завершённые', count: counts.done || undefined },
          { value: 'cancelled', label: 'Отменённые', count: counts.cancelled || undefined },
          { value: 'refunded', label: 'Возвраты', count: counts.refunded || undefined },
        ]}
      />
      {isLoading ? (
        <div className="space-y-2.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[88px] rounded-[20px]" />)}</div>
      ) : error ? (
        <ErrorState text={(error as Error).message} onRetry={() => refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Package className="h-7 w-7" />}
          title={EMPTY[current].title}
          text={EMPTY[current].text}
          action={current === 'active' || current === 'done' ? <Button size="md" onClick={() => navigate('/catalog')}>Перейти в каталог</Button> : undefined}
        />
      ) : (
        <div className="stagger space-y-2.5">
          {list.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => { haptic.select(); navigate(`/orders/${o.id}`) }}
              className="card pressable flex w-full items-center gap-3 p-3.5 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="num font-mono text-[12px] text-muted">{o.public_id ?? `#${o.id}`}</span>
                  <span className="text-[12px] text-muted">· {date(o.created_at)}</span>
                </div>
                <div className="mt-1 truncate text-[15px] font-semibold">{o.item_title}</div>
                <div className="mt-2 flex items-center gap-2">
                  <OrderStageBadge order={o} />
                  {o.quantity > 1 && <span className="text-[12px] text-muted">{o.quantity} шт</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="num text-[16px] font-bold">{money(o.total)}</span>
                <ChevronRight className="h-4 w-4 text-muted" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
