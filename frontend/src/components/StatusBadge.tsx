import { ORDER_STAGE, ORDER_STATUS } from '../lib/format'
import type { Order, OrderStatus } from '../lib/types'
import { Badge } from './ui'

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status]
  return <Badge tone={s.tone} dot>{s.label}</Badge>
}

/** Order lifecycle stage computed on the server (falls back to the raw status). */
export function OrderStageBadge({ order }: { order: Pick<Order, 'stage' | 'status'> }) {
  if (!order.stage || !ORDER_STAGE[order.stage]) return <StatusBadge status={order.status} />
  const s = ORDER_STAGE[order.stage]
  return <Badge tone={s.tone} dot>{s.label}</Badge>
}
