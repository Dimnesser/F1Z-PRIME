import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { CheckCircle2, Clock3, Gem, Minus, PartyPopper, Plus, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, newIdempotencyKey } from '../lib/api'
import { money } from '../lib/format'
import { useConfig, useMe } from '../lib/queries'
import { haptic, openInvoice } from '../lib/telegram'
import type { Order, PayMethod, Payment, PremiumNumber, Product } from '../lib/types'
import { ManualPayment } from './ManualPayment'
import { PayMethods } from './PayMethods'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Badge, Button } from './ui'

export type CheckoutItem =
  | { kind: 'product'; product: Product }
  | { kind: 'premium'; number: PremiumNumber }
  | { kind: 'order'; order: Order }

type Step = 'confirm' | 'pay' | 'manual' | 'review' | 'success'

export function CheckoutSheet({ item, onClose }: { item: CheckoutItem | null; onClose: () => void }) {
  const open = item !== null
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const { data: me } = useMe()
  const { data: config } = useConfig()
  const [step, setStep] = useState<Step>('confirm')
  const [qty, setQty] = useState(1)
  const [order, setOrder] = useState<Order | null>(null)
  const [busy, setBusy] = useState(false)
  const [paying, setPaying] = useState<PayMethod | null>(null)
  const [manual, setManual] = useState<{ payment: Payment; instructions: string } | null>(null)
  const key = useRef(newIdempotencyKey())

  useEffect(() => {
    if (open) {
      setStep(item?.kind === 'order' ? 'pay' : 'confirm')
      setQty(1)
      setOrder(item?.kind === 'order' ? item.order : null)
      setManual(null)
      key.current = newIdempotencyKey()
    }
  }, [open, item])

  if (!item) return <Sheet open={false} onClose={onClose}>{null}</Sheet>

  const title = item.kind === 'product' ? item.product.title : item.kind === 'premium' ? item.number.display_mask : item.order.item_title
  const flag = item.kind === 'product' ? item.product.country?.flag : item.kind === 'premium' ? item.number.country?.flag : undefined
  const price = item.kind === 'product' ? item.product.price : item.kind === 'premium' ? item.number.price : item.order.unit_price
  const maxQty = item.kind === 'product' ? Math.min(10, item.product.stock) : 1
  const total = order?.total ?? price * qty
  const uahPerStar = Number(config?.settings.uah_per_star ?? '0.85') || 0.85

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['me'] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['countries'] })
    qc.invalidateQueries({ queryKey: ['premium'] })
  }

  const createOrder = async () => {
    setBusy(true)
    try {
      const o = await api.createOrder({
        product_id: item.kind === 'product' ? item.product.id : undefined,
        premium_number_id: item.kind === 'premium' ? item.number.id : undefined,
        quantity: qty,
        idempotency_key: key.current,
      })
      setOrder(o)
      setStep('pay')
      haptic.success()
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const waitPaid = async (orderId: number) => {
    for (let i = 0; i < 12; i++) {
      const o = await api.order(orderId)
      if (o.status !== 'pending') {
        setOrder(o)
        return true
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    return false
  }

  const pay = async (method: PayMethod) => {
    if (!order) return
    setPaying(method)
    try {
      const res = await api.pay(order.id, method)
      if (method === 'stars' && res.invoice_link) {
        const status = await openInvoice(res.invoice_link)
        if (status === 'paid') {
          const ok = await waitPaid(order.id)
          if (ok) {
            setStep('success')
            haptic.success()
          } else {
            toast('Оплата получена, заказ скоро обновится', 'info')
            setStep('review')
          }
        } else if (status === 'failed') toast('Оплата не прошла', 'error')
        else if (status === 'cancelled') toast('Оплата отменена', 'info')
      } else if (method === 'manual') {
        setManual({ payment: res.payment, instructions: res.instructions ?? '' })
        setStep('manual')
      } else if (res.order) {
        setOrder(res.order)
        setStep('success')
        haptic.success()
      }
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setPaying(null)
    }
  }

  const cancel = async () => {
    if (!order) return onClose()
    try {
      await api.cancel(order.id)
      toast('Заказ отменён', 'info')
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    onClose()
  }

  const sheetTitle = { confirm: 'Подтверждение', pay: 'Способ оплаты', manual: 'Оплата переводом', review: 'Платёж на проверке', success: 'Готово!' }[step]

  return (
    <Sheet open={open} onClose={onClose} title={sheetTitle}>
      <div className="mb-4 flex items-center gap-3.5 rounded-2xl bg-card p-3.5 ring-1 ring-white/[0.06]">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-3xl ring-1 ring-white/10">
          {flag ?? <Gem className="h-6 w-6 text-primary-soft" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={item.kind === 'premium' ? 'font-mono text-[16px] font-bold' : 'text-[15px] font-bold'}>{title}</div>
          <div className="text-[12.5px] text-muted">
            {item.kind === 'product' && `${item.product.country?.dial_code ?? ''} · ${money(price)} / шт`}
            {item.kind === 'premium' && 'Красивый номер · 1 шт'}
            {item.kind === 'order' && `${item.order.quantity} шт · ${money(price)} / шт`}
          </div>
        </div>
        {order && <Badge tone="amber">#{order.id}</Badge>}
      </div>

      {step === 'confirm' && (
        <motion.div className="fade-in space-y-4">
          {item.kind === 'product' && (
            <div className="flex items-center justify-between rounded-2xl bg-card p-3.5 ring-1 ring-white/[0.06]">
              <span className="text-sm font-semibold text-muted">Количество</span>
              <div className="flex items-center gap-3">
                <button className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.07] pressable disabled:opacity-40" disabled={qty <= 1} onClick={() => { setQty(qty - 1); haptic.select() }}>
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center font-display text-lg font-bold">{qty}</span>
                <button className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.07] pressable disabled:opacity-40" disabled={qty >= maxQty} onClick={() => { setQty(qty + 1); haptic.select() }}>
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
          <div className="flex items-end justify-between px-1">
            <span className="text-sm text-muted">Итого к оплате</span>
            <span className="font-display text-[28px] font-bold text-gradient">{money(total)}</span>
          </div>
          <div className="flex items-start gap-2.5 rounded-2xl bg-white/[0.03] p-3 text-[12.5px] text-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            Товар резервируется за вами на 30 минут после создания заказа. Цена фиксируется сервером.
          </div>
          <Button className="w-full" loading={busy} onClick={createOrder} disabled={maxQty < 1}>
            Создать заказ · {money(total)}
          </Button>
        </motion.div>
      )}

      {step === 'pay' && order && (
        <motion.div className="fade-in space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm text-muted">К оплате</span>
            <span className="font-display text-2xl font-bold">{money(order.total)}</span>
          </div>
          {order.expires_at && <Countdown until={order.expires_at} />}
          <PayMethods
            methods={config?.payment_methods ?? ['balance']}
            total={order.total}
            balance={me?.balance}
            uahPerStar={uahPerStar}
            loading={paying}
            onPick={pay}
          />
          <Button variant="ghost" className="w-full" size="md" onClick={cancel}>Отменить заказ</Button>
        </motion.div>
      )}

      {step === 'manual' && manual && (
        <ManualPayment payment={manual.payment} instructions={manual.instructions} onSubmitted={() => setStep('review')} />
      )}

      {step === 'review' && (
        <div className="space-y-4 py-2 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-warning/15 text-warning"><Clock3 className="h-8 w-8" /></div>
          <p className="text-sm text-muted">Мы проверим поступление средств и уведомим вас в Telegram. Статус заказа обновится автоматически.</p>
          <Button className="w-full" onClick={() => { onClose(); navigate(`/orders/${order?.id}`) }}>Перейти к заказу</Button>
        </div>
      )}

      {step === 'success' && order && (
        <motion.div className="fade-in space-y-4 py-2 text-center">
          <div className="relative mx-auto grid h-20 w-20 place-items-center">
            <div className="absolute inset-0 hidden rounded-full bg-success/20" />
            <div className="relative grid h-20 w-20 place-items-center rounded-full bg-success/15 text-success ring-1 ring-success/30">
              <CheckCircle2 className="h-10 w-10" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-center gap-2 font-display text-xl font-bold">Оплата прошла <PartyPopper className="h-5 w-5 text-warning" /></div>
            <p className="mt-1 text-sm text-muted">Заказ #{order.id} · {order.status === 'completed' ? 'выполнен' : 'оплачен, ожидает выдачи'}</p>
          </div>
          {order.payment_method === 'test' && <Badge tone="amber">ТЕСТОВЫЙ ПЛАТЁЖ · DEV_MODE</Badge>}
          {order.delivery_data && (
            <div className="rounded-2xl border border-success/25 bg-success/[0.06] p-4 text-left">
              <div className="text-[11px] font-bold uppercase tracking-wider text-success">Выдача</div>
              <div className="mt-1 whitespace-pre-line font-mono text-[15px] font-bold">{order.delivery_data}</div>
            </div>
          )}
          <Button className="w-full" onClick={() => { onClose(); navigate(`/orders/${order.id}`) }}>Открыть заказ</Button>
        </motion.div>
      )}
    </Sheet>
  )
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, new Date(until).getTime() - now)
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl bg-warning/[0.08] py-2.5 text-[13px] font-semibold text-warning">
      <Clock3 className="h-4 w-4" /> Резерв: {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </div>
  )
}
