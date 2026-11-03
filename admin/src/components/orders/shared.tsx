import { Badge, type Tone } from '../ui'
import type { Order, OrderEvent, Payment } from '../../lib/types'

/** Lifecycle stages from backend services/orders.py (STAGE_LABELS). */
export const STAGES: Record<string, { label: string; tone: Tone }> = {
  pending_payment: { label: 'Ожидает оплаты', tone: 'amber' },
  payment_review: { label: 'Платёж на проверке', tone: 'amber' },
  paid: { label: 'Оплачен', tone: 'cyan' },
  fulfillment_pending: { label: 'Ожидает выдачи', tone: 'cyan' },
  processing: { label: 'В обработке', tone: 'violet' },
  delivered: { label: 'Выдан', tone: 'green' },
  manual_review: { label: 'Ручная проверка', tone: 'amber' },
  failed: { label: 'Ошибка выдачи', tone: 'red' },
  cancelled: { label: 'Отменён', tone: 'gray' },
  refunded: { label: 'Возврат', tone: 'red' },
}

/** Order fields added by the backend (OrderOut) that the shared Order type may not list yet. */
export type OrderX = Order & {
  public_id?: string | null; stage?: string; fulfillment_status?: string | null; discount?: number; promo_code?: string | null
}

export const orderNo = (o: { id: number; public_id?: string | null }) => o.public_id || `#${o.id}`

/** `in_review` (list) turns pending_payment into payment_review, as the detail endpoint does. */
export function stageOf(o: OrderX): string {
  const s = o.stage || ''
  if (s === 'pending_payment' && o.in_review) return 'payment_review'
  return s
}

export function StageBadge({ stage, label }: { stage: string; label?: string }) {
  const s = STAGES[stage]
  return <Badge tone={s?.tone ?? 'gray'} dot>{label ?? s?.label ?? (stage || '—')}</Badge>
}

export const FULFILLMENT_LABEL: Record<string, string> = {
  pending: 'В очереди', processing: 'Выдаётся', delivered: 'Выдано', failed: 'Ошибка', manual: 'У оператора', review: 'На проверке',
}
export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'В очереди', tone: 'cyan' },
  running: { label: 'Выполняется', tone: 'violet' },
  done: { label: 'Готово', tone: 'green' },
  dead: { label: 'Ошибка', tone: 'red' },
}
export const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: 'Запрошен', tone: 'amber' },
  processing: { label: 'Обрабатывается', tone: 'violet' },
  manual_pending: { label: 'Ждёт перевода', tone: 'amber' },
  succeeded: { label: 'Выполнен', tone: 'green' },
  failed: { label: 'Ошибка', tone: 'red' },
  rejected: { label: 'Отклонён', tone: 'gray' },
}
export const REFUND_METHOD: Record<string, string> = { balance: 'На баланс', stars: 'Telegram Stars', manual: 'Ручной перевод' }

/** Customer events that may be re-sent from the order card (backend TEMPLATES, audience=customer). */
export const CUSTOMER_EVENTS: { key: string; label: string }[] = [
  { key: 'order_created', label: 'Заказ создан' },
  { key: 'payment_review', label: 'Платёж на проверке' },
  { key: 'payment_confirmed', label: 'Оплата подтверждена' },
  { key: 'payment_rejected', label: 'Платёж отклонён' },
  { key: 'order_processing', label: 'Заказ обрабатывается' },
  { key: 'order_delivered', label: 'Товар выдан' },
  { key: 'order_review', label: 'Требуется проверка' },
  { key: 'order_problem', label: 'Возникла проблема' },
  { key: 'order_cancelled', label: 'Заказ отменён' },
  { key: 'order_expired', label: 'Резерв истёк' },
  { key: 'order_refunded', label: 'Возврат выполнен' },
]

export type TimelineKind = 'status' | 'payment' | 'refund' | 'notification' | 'error' | 'incident'
export interface TimelineItem { at: string; kind: TimelineKind | string; title: string; note: string | null; actor: string | null }
export interface RefundRow {
  id: number; amount: number; method: string; status: string; reason: string; requested_by: string; error: string | null
  created_at: string; completed_at: string | null
}
export interface OrderDetailData {
  order: OrderX
  stage: string
  stage_label: string
  payments: Payment[]
  events: OrderEvent[]
  timeline: TimelineItem[]
  allowed: string[]
  product: { id: number; category: string; delivery_note: string; fulfillment_mode: string; uses_inventory: boolean } | null
  fulfillment: {
    status: string | null; attempts: number; error: string | null; delivered_at: string | null
    job: { status: string; attempts: number; run_at: string; last_error: string | null } | null
  }
  units: { id: number; label: string; status: string }[]
  refunds: RefundRow[]
  refund_methods: string[]
  incidents: { id: number; kind: string; title: string; status: string; severity: string; created_at: string }[]
  tickets: { id: number; subject: string; status: string; priority: string | null }[]
}
