import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Check, Copy, Headphones, KeyRound, PackageCheck, Phone, Receipt } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/Sheet'
import { OrderStageBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { Badge, Button, EmptyState, ErrorState, IconButton, KV, Skeleton } from '../components/ui'
import { api, ApiError } from '../lib/api'
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
  const { data: o, isLoading, error, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.order(Number(id)),
    refetchInterval: (q) => (q.state.data && ['pending', 'paid', 'processing'].includes(q.state.data.status) ? 8000 : false),
  })
  const [supportOpen, setSupportOpen] = useState(false)
  const [sending, setSending] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const { data: categories } = useQuery({ queryKey: ['support-categories'], queryFn: api.supportCategories, enabled: supportOpen, staleTime: 3600_000 })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-11 w-11 rounded-[14px]" /><Skeleton className="h-48 rounded-[24px]" /><Skeleton className="h-56 rounded-[20px]" /></div>
  if (error instanceof ApiError && error.status !== 404) return <ErrorState text={error.message} onRetry={() => refetch()} />
  if (error || !o) return <EmptyState icon={<Receipt className="h-7 w-7" />} title="Заказ не найден" action={<Button size="md" onClick={() => navigate('/orders')}>К заказам</Button>} />

  const stage = ORDER_STAGE[o.stage] ?? ORDER_STAGE.pending_payment
  const stepIdx = STAGE_STEP[o.stage] ?? 0
  const closed = stepIdx < 0
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
    setCancelling(true)
    try {
      await api.cancel(o.id)
      toast('Заказ отменён', 'info')
      qc.invalidateQueries()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setCancelling(false)
      setConfirmCancel(false)
    }
  }

  return (
    <div className="space-y-3">
      <IconButton label="Назад" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></IconButton>

      <section className="fade-in card overflow-hidden">
        <div className="p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="num font-display text-[13px] text-muted">Заказ {o.public_id ?? `#${o.id}`}</span>
            <OrderStageBadge order={o} />
          </div>
          <h1 className="mt-2 text-[19px] font-bold leading-snug tracking-tight">{o.item_title}</h1>
          <div className="num mt-2 text-[30px] font-bold leading-none tracking-tight">{money(o.total)}</div>
          {o.discount > 0 && <div className="mt-1.5 text-[12.5px] font-semibold text-success">Промокод {o.promo_code}: −{money(o.discount)}</div>}
        </div>
        {!closed && (
          <ol className="relative flex items-start justify-between border-t border-line/60 px-4 py-4" aria-label="Этапы заказа">
            {STEPS.map((label, i) => {
              const done = stepIdx >= i
              const current = stepIdx === i && o.stage !== 'delivered'
              return (
                <li key={label} className="relative flex flex-1 flex-col items-center gap-1.5" aria-current={current ? 'step' : undefined}>
                  {i > 0 && <span aria-hidden className={clsx('absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2', stepIdx >= i ? 'bg-primary' : 'bg-line')} />}
                  <span className={clsx('relative grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold transition-colors',
                    done ? 'bg-primary text-primary-ink' : 'bg-elevated text-muted ring-1 ring-inset ring-line', current && 'ring-4 ring-primary/20')}>
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={clsx('text-[11px] font-medium', done ? 'text-ink' : 'text-muted')}>{label}</span>
                </li>
              )
            })}
          </ol>
        )}
        <p className={clsx('border-t border-line/60 px-5 py-3 text-[12.5px] leading-snug', o.stage === 'failed' ? 'text-danger' : 'text-muted')}>{stage.hint}</p>
      </section>

      {o.delivered_items.length > 0 && (
        <section className="rounded-[20px] border border-success/25 bg-success/[0.06] p-4">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-success">
            {o.delivered_kind === 'phone' ? <><Phone className="h-4 w-4" /> Ваши номера</> : <><KeyRound className="h-4 w-4" /> Ключи и коды</>}
          </h2>
          <div className="mt-2.5 space-y-2">
            {o.delivered_items.map((v, i) => (
              <button key={i} type="button" onClick={() => copy(v)} className="pressable flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl bg-surface px-3.5 py-3 text-left ring-1 ring-inset ring-line/70">
                <span className="num min-w-0 break-all font-display text-[14.5px] font-bold">{v}</span>
                <Copy className="h-4 w-4 shrink-0 text-success" aria-label="Скопировать" />
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-muted">
            {o.delivered_kind === 'phone' ? 'Нажмите на номер, чтобы скопировать. Не передавайте его посторонним.' : 'Не передавайте эти данные посторонним.'}
          </p>
        </section>
      )}

      {o.delivery_data && (
        <section className="rounded-[20px] border border-success/25 bg-success/[0.06] p-4">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-success"><PackageCheck className="h-4 w-4" /> Ваш товар</h2>
          <div className="mt-2 whitespace-pre-line break-words font-display text-[15px] font-bold">{o.delivery_data}</div>
          <Button size="sm" variant="success" className="mt-3" onClick={() => copy(o.delivery_data ?? '')}>
            <Copy className="h-4 w-4" /> Скопировать
          </Button>
        </section>
      )}
      {o.delivery_note && !o.delivery_data && (
        <div className="card p-4 text-[13.5px] leading-relaxed text-ink/85">{o.delivery_note}</div>
      )}

      <section className="card hairline overflow-hidden" aria-label="Детали заказа">
        <KV k="Дата покупки" v={date(o.created_at)} />
        <KV k="Количество" v={`${o.quantity} шт`} />
        <KV k="Цена за шт." v={<span className="num">{money(o.unit_price)}</span>} />
        <KV k="Способ оплаты" v={o.payment_method ? METHOD_LABEL[o.payment_method] ?? o.payment_method : '—'} />
        <KV k="Оплачен" v={o.paid_at ? date(o.paid_at) : '—'} />
        {o.completed_at && <KV k="Выдан" v={date(o.completed_at)} />}
      </section>

      {o.payments.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="eyebrow px-4 pt-4">Платежи</h2>
          <div className="hairline">
            {o.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
                <span className="flex items-center gap-1.5">{METHOD_LABEL[p.method]} {p.is_test && <Badge tone="amber">TEST</Badge>}</span>
                <span className="text-muted">{PAYMENT_STATUS[p.status]}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {o.stage !== 'pending_payment' && (
        <section className="card p-4">
          {o.support_ticket_id ? (
            <Button variant="ghost" className="w-full" size="md" onClick={() => navigate(`/support/${o.support_ticket_id}`)}>
              <Headphones className="h-4 w-4" /> Открыть обращение по заказу
            </Button>
          ) : !supportOpen ? (
            <Button variant="ghost" className="w-full" size="md" onClick={() => setSupportOpen(true)}>
              <Headphones className="h-4 w-4" /> Проблема с заказом?
            </Button>
          ) : (
            <div>
              <div className="mb-2.5 text-[13px] leading-snug text-muted">Что случилось? Обращение создастся сразу и будет привязано к заказу.</div>
              <div className="grid grid-cols-2 gap-2">
                {(categories ?? []).filter((c) => c.key !== 'general').map((c) => (
                  <button key={c.key} type="button" disabled={!!sending} onClick={() => askSupport(c.key)}
                    className="pressable min-h-[48px] rounded-2xl bg-ov/[0.05] px-3 py-2.5 text-left text-[13px] font-semibold ring-1 ring-inset ring-line/70 disabled:opacity-50">
                    {sending === c.key ? 'Отправляем…' : c.label}
                  </button>
                ))}
                {!categories && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-2xl" />)}
              </div>
            </div>
          )}
        </section>
      )}

      {o.status === 'pending' && (
        <div className="sticky-cta sticky z-30 pt-2">
          <div className="grid grid-cols-[1fr_auto] gap-2 rounded-[20px] border border-line/80 bg-surface/90 p-2 shadow-pop backdrop-blur-xl">
            <Button onClick={() => checkout({ kind: 'order', order: o })}>Оплатить · <span className="num">{money(o.total)}</span></Button>
            <Button variant="danger" onClick={() => setConfirmCancel(true)}>Отменить</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Отменить заказ?"
        text="Резерв товара будет снят. Если оплата уже отправлена, не отменяйте заказ — дождитесь проверки."
        confirmLabel="Отменить заказ"
        cancelLabel="Не отменять"
        danger
        loading={cancelling}
        onConfirm={cancel}
        onClose={() => setConfirmCancel(false)}
      />
    </div>
  )
}
