import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, Copy, Headphones, KeyRound, PackageCheck, Receipt } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { Badge, Button, EmptyState, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { date, METHOD_LABEL, money, ORDER_STAGE, PAYMENT_STATUS } from '../lib/format'
import { useShop } from '../lib/shop'
import { useBack } from '../lib/useBack'
import type { OrderStage } from '../lib/types'

const STEPS = ['Создан', 'Оплачен', 'Выдача', 'Получен']
const STAGE_STEP: Record<OrderStage, number> = {
  pending_payment: 0, payment_review: 0, paid: 1, fulfillment_pending: 2, processing: 2, manual_review: 2, failed: 2,
  delivered: 3, cancelled: -1, refunded: -1,
}

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
  const [supportOpen, setSupportOpen] = useState(false)
  const [sending, setSending] = useState('')
  const { data: categories } = useQuery({ queryKey: ['support-categories'], queryFn: api.supportCategories, enabled: supportOpen, staleTime: 3600_000 })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-56 rounded-3xl" /></div>
  if (error || !o) return <EmptyState icon={<Receipt className="h-7 w-7" />} title="Заказ не найден" />

  const stage = ORDER_STAGE[o.stage] ?? ORDER_STAGE.pending_payment
  const stepIdx = STAGE_STEP[o.stage] ?? 0
  const failed = stepIdx < 0
  const copy = (text: string) => { navigator.clipboard?.writeText(text); toast('Скопировано', 'success') }

  const askSupport = async (category: string) => {
    setSending(category)
    try {
      const t = await api.orderSupport(o.id, category)
      qc.invalidateQueries({ queryKey: ['order', id] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
      navigate(`/support/${t.id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSending('')
    }
  }

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
            <span className="font-display text-sm font-semibold text-muted">Заказ {o.public_id ?? `#${o.id}`}</span>
            {o.stage ? <Badge tone={stage.tone}>{stage.label}</Badge> : <StatusBadge status={o.status} />}
          </div>
          <div className="mt-2 text-lg font-bold">{o.item_title}</div>
          <div className="mt-1 font-display text-3xl font-bold text-gradient">{money(o.total)}</div>
          {o.discount > 0 && <div className="mt-1 text-[12.5px] font-semibold text-success">Промокод {o.promo_code}: −{money(o.discount)}</div>}
        </div>
        {!failed && (
          <div className="flex items-center justify-between px-5 py-4">
            {STEPS.map((label, i) => {
              const done = stepIdx >= i
              return (
                <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className={clsx('grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold', done ? 'bg-brand text-white' : 'bg-white/[0.06] text-muted')}>
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                  </div>
                  <span className={clsx('text-[10.5px] font-semibold', done ? 'text-ink' : 'text-muted')}>{label}</span>
                </div>
              )
            })}
          </div>
        )}
        <p className={clsx('px-5 pb-4 text-[12.5px]', o.stage === 'failed' ? 'text-danger' : 'text-muted')}>{stage.hint}</p>
      </motion.div>

      {o.delivered_items.length > 0 && (
        <div className="rounded-3xl border border-success/25 bg-success/[0.06] p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-success"><KeyRound className="h-4 w-4" /> Ключи и коды</div>
          <div className="mt-2 space-y-2">
            {o.delivered_items.map((v, i) => (
              <button key={i} onClick={() => copy(v)} className="flex w-full items-center justify-between gap-3 rounded-2xl bg-black/20 px-3.5 py-3 text-left pressable">
                <span className="min-w-0 break-all font-mono text-[14.5px] font-bold">{v}</span>
                <Copy className="h-4 w-4 shrink-0 text-success" />
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-muted">Не передавайте эти данные посторонним.</p>
        </div>
      )}

      {o.delivery_data && (
        <div className="rounded-3xl border border-success/25 bg-success/[0.06] p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-success"><PackageCheck className="h-4 w-4" /> Ваш товар</div>
          <div className="mt-2 whitespace-pre-line break-words font-mono text-[15px] font-bold">{o.delivery_data}</div>
          <button
            onClick={() => copy(o.delivery_data ?? '')}
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

      {o.stage !== 'pending_payment' && (
        <div className="card p-4">
          {o.support_ticket_id ? (
            <Button variant="ghost" className="w-full" size="md" onClick={() => navigate(`/support/${o.support_ticket_id}`)}>
              <Headphones className="h-4 w-4" /> Открыть обращение по заказу
            </Button>
          ) : !supportOpen ? (
            <button onClick={() => setSupportOpen(true)} className="flex w-full items-center justify-center gap-2 text-[14px] font-semibold text-primary-soft pressable">
              <Headphones className="h-4 w-4" /> Проблема с заказом?
            </button>
          ) : (
            <div>
              <div className="mb-2.5 text-[13px] font-bold text-muted">Что случилось? Обращение создастся сразу и будет привязано к заказу.</div>
              <div className="grid grid-cols-2 gap-2">
                {(categories ?? []).filter((c) => c.key !== 'general').map((c) => (
                  <button key={c.key} disabled={!!sending} onClick={() => askSupport(c.key)}
                    className="min-h-[48px] rounded-2xl bg-white/[0.05] px-3 py-2.5 text-left text-[13px] font-semibold ring-1 ring-white/[0.06] pressable disabled:opacity-50">
                    {sending === c.key ? 'Отправляем…' : c.label}
                  </button>
                ))}
                {!categories && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-2xl" />)}
              </div>
            </div>
          )}
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
