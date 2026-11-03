import { ChevronRight, Package } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OrderStageBadge } from '../components/StatusBadge'
import { Button, Chips, EmptyState, ErrorState, PageTitle, Skeleton } from '../components/ui'
import { money } from '../lib/format'

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
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
      <PageTitle title="Заказы" />
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
        <div className="card hairline overflow-hidden">
          {list.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => { haptic.select(); navigate(`/orders/${o.id}`) }}
              className="pressable flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-ov/[0.03]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15.5px] font-medium">{o.item_title}{o.quantity > 1 ? `, ${o.quantity} шт.` : ''}</div>
                <div className="mt-1.5"><OrderStageBadge order={o} /></div>
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-[15.5px] font-semibold">{money(o.total)}</div>
                <div className="mt-1 text-[12.5px] text-muted">{shortDay(o.created_at)}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted/70" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
