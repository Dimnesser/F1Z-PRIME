import { ORDER_STATUS } from '../lib/format'
import type { OrderStatus } from '../lib/types'
import { Badge } from './ui'

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status]
  return <Badge tone={s.tone}>{s.label}</Badge>
}
