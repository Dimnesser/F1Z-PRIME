import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, Copy, PackageCheck, Receipt } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { Badge, Button, EmptyState, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { date, METHOD_LABEL, money, PAYMENT_STATUS } from '../lib/format'
import { useShop } from '../lib/shop'
import { useBack } from '../lib/useBack'
import type { OrderStatus } from '../lib/types'

const STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'pending', label: 'Создан' },
  { key: 'paid', label: 'Оплачен' },
  { key: 'processing', label: 'Обработка' },
  { key: 'completed', label: 'Выполнен' },
]

export default function OrderDetail() {
  useBack('/orders')
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const { checkout } = useShop()
  const { data: o, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.order(Number(id)),
    refetchInterval: (q) => (q.state.data && ['pending', 'paid', 'processing'].includes(q.state.data.status) ? 8000 : false),
  })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-56 rounded-3xl" /></div>
  if (error || !o) return <EmptyState icon={<Receipt className="h-7 w-7" />} title="Заказ не найден" />

  const failed = ['cancelled', 'expired', 'refunded'].includes(o.status)
  const stepIdx = STEPS.findIndex((s) => s.key === o.status)

  const cancel = async () => {
    try {
      await api.cancel(o.id)
      toast('Заказ отменён', 'info')
      qc.invalidateQueries()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-muted pressable">
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>
      <motion.div className="fade-in card overflow-hidden">
        <div className="bg-brand-soft p-5">
          <div className="flex items-center justify-between">
            <span className="font-display text-sm font-semibold text-muted">Заказ #{o.id}</span>
            <StatusBadge status={o.status} />
          </div>
          <div className="mt-2 text-lg font-bold">{o.item_title}</div>
          <div className="mt-1 font-display text-3xl font-bold text-gradient">{money(o.total)}</div>
        </div>
        {!failed && (
          <div className="flex items-center justify-between px-5 py-4">
            {STEPS.map((s, i) => {
              const done = stepIdx >= i || (o.status === 'completed')
              return (
                <div key={s.key} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className={clsx('grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold', done ? 'bg-brand text-white' : 'bg-white/[0.06] text-muted')}>
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                  </div>
                  <span className={clsx('text-[10.5px] font-semibold', done ? 'text-ink' : 'text-muted')}>{s.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </motion.div>

      {o.delivery_data && (
        <div className="rounded-3xl border border-success/25 bg-success/[0.06] p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-success"><PackageCheck className="h-4 w-4" /> Ваш товар</div>
          <div className="mt-2 whitespace-pre-line break-words font-mono text-[15px] font-bold">{o.delivery_data}</div>
          <button
            onClick={() => { navigator.clipboard?.writeText(o.delivery_data ?? ''); toast('Скопировано', 'success') }}
            className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-success pressable"
          >
            <Copy className="h-4 w-4" /> Скопировать
          </button>
        </div>
      )}
      {o.delivery_note && !o.delivery_data && (
        <div className="card p-4 text-[13.5px] text-ink/85">{o.delivery_note}</div>
      )}

      <div className="card divide-y divide-white/[0.06]">
        {[
          ['Дата покупки', date(o.created_at)],
          ['Количество', `${o.quantity} шт`],
          ['Цена за шт.', money(o.unit_price)],
          ['Способ оплаты', o.payment_method ? METHOD_LABEL[o.payment_method] ?? o.payment_method : '—'],
          ['Оплачен', o.paid_at ? date(o.paid_at) : '—'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-3 text-[14px]">
            <span className="text-muted">{k}</span>
            <span className="font-semibold">{v}</span>
          </div>
        ))}
      </div>

      {o.payments.length > 0 && (
        <div className="card p-4">
          <div className="mb-3 text-[13px] font-bold text-muted">Платежи</div>
          <div className="space-y-2.5">
            {o.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-[13.5px]">
                <span>{METHOD_LABEL[p.method]} {p.is_test && <Badge tone="amber" className="ml-1">TEST</Badge>}</span>
                <span className="text-muted">{PAYMENT_STATUS[p.status]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {o.status === 'pending' && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button onClick={() => checkout({ kind: 'order', order: o })}>Оплатить {money(o.total)}</Button>
          <Button variant="danger" onClick={cancel}>Отменить</Button>
        </div>
      )}
    </div>
  )
}
