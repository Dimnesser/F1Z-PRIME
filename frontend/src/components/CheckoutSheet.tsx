import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock3, Gem, ShieldCheck, TicketPercent, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, newIdempotencyKey } from '../lib/api'
import { money, stars, usd } from '../lib/format'
import { useConfig, useMe } from '../lib/queries'
import { haptic, openInvoice } from '../lib/telegram'
import type { Order, PayMethod, Payment, PremiumNumber, Product, PromoPreview } from '../lib/types'
import { GuaranteeCard } from './Guarantee'
import { ManualPayment } from './ManualPayment'
import { PayMethods } from './PayMethods'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Badge, Button, Stepper } from './ui'

export type CheckoutItem =
  | { kind: 'product'; product: Product; qty?: number }
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
  const [promoOpen, setPromoOpen] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const [promo, setPromo] = useState<PromoPreview | null>(null)
  const [promoBusy, setPromoBusy] = useState(false)
  const [promoError, setPromoError] = useState('')

  useEffect(() => {
    if (open) {
      setStep(item?.kind === 'order' ? 'pay' : 'confirm')
      setQty(item?.kind === 'product' ? Math.max(1, item.qty ?? 1) : 1)
      setOrder(item?.kind === 'order' ? item.order : null)
      setManual(null)
      setPromo(null)
      setPromoCode('')
      setPromoError('')
      setPromoOpen(false)
      key.current = newIdempotencyKey()
    }
  }, [open, item])

  if (!item) return <Sheet open={false} onClose={onClose}>{null}</Sheet>

  const title = item.kind === 'product' ? item.product.title : item.kind === 'premium' ? item.number.display_mask : item.order.item_title
  const flag = item.kind === 'product' ? item.product.country?.flag : item.kind === 'premium' ? item.number.country?.flag : undefined
  const price = item.kind === 'product' ? item.product.price : item.kind === 'premium' ? item.number.price : item.order.unit_price
  const maxQty = item.kind === 'product' ? Math.min(10, item.product.stock, item.product.max_per_order ?? 10) : 1
  // preview only — the server recalculates price and discount when the order is created
  const total = order?.total ?? (promo ? promo.total : price * qty)
  const oldPrice = item.kind === 'product' ? item.product.old_price : null

  const applyPromo = async () => {
    if (item.kind !== 'product' || !promoCode.trim()) return
    setPromoBusy(true)
    setPromoError('')
    try {
      setPromo(await api.checkPromo(promoCode.trim(), item.product.id, qty))
      haptic.success()
    } catch (e) {
      setPromo(null)
      setPromoError((e as Error).message)
      haptic.error()
    } finally {
      setPromoBusy(false)
    }
  }
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
        promo_code: promo?.code,
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
      <div className="mb-4 flex items-center gap-3.5 rounded-[20px] bg-ov/[0.04] p-3 ring-1 ring-inset ring-line/70">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ov/[0.05] text-[28px] ring-1 ring-inset ring-line/70">
          {flag ?? <Gem className="h-6 w-6 text-primary-soft" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={item.kind === 'premium' ? 'num truncate font-mono text-[16px] font-bold' : 'truncate text-[15px] font-semibold'}>{title}</div>
          <div className="num truncate text-[12.5px] text-muted">
            {item.kind === 'product' && <>{item.product.country?.dial_code ?? ''} · {money(price)} / шт{oldPrice ? <s className="ml-1.5 opacity-60">{money(oldPrice)}</s> : null}</>}
            {item.kind === 'premium' && 'Красивый номер · 1 шт'}
            {item.kind === 'order' && `${item.order.quantity} шт · ${money(price)} / шт`}
          </div>
        </div>
        {order && <Badge tone="amber">{order.public_id ?? `#${order.id}`}</Badge>}
      </div>

      {step === 'confirm' && (
        <div className="fade-in space-y-4">
          {item.kind === 'product' && (
            <div className="flex items-center justify-between rounded-[20px] bg-ov/[0.04] py-1.5 pl-4 pr-1.5 ring-1 ring-inset ring-line/70">
              <span className="text-[14px] font-medium text-muted">Количество</span>
              <Stepper value={qty} max={Math.max(1, maxQty)} onChange={(v) => { setQty(v); setPromo(null) }} />
            </div>
          )}
          {item.kind === 'product' && (promo ? (
            <div className="flex items-center justify-between rounded-2xl bg-success/[0.08] p-3 pl-4 ring-1 ring-inset ring-success/25">
              <div className="flex items-center gap-2 text-sm font-semibold text-success">
                <TicketPercent className="h-4 w-4" /> {promo.code}: −{money(promo.discount)}
              </div>
              <button type="button" aria-label="Убрать промокод" className="grid h-9 w-9 place-items-center rounded-xl bg-ov/[0.06] pressable" onClick={() => setPromo(null)}><X className="h-4 w-4" /></button>
            </div>
          ) : promoOpen ? (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} maxLength={32} autoCapitalize="characters"
                  placeholder="Промокод" aria-label="Промокод" className="input h-11 min-w-0 flex-1 rounded-[14px] font-mono uppercase" />
                <Button size="md" loading={promoBusy} disabled={!promoCode.trim()} onClick={applyPromo}>Применить</Button>
              </div>
              {promoError && <p className="px-1 text-[12.5px] text-danger">{promoError}</p>}
            </div>
          ) : (
            <button type="button" className="flex h-10 items-center gap-2 px-1 text-[13.5px] font-semibold text-primary-soft pressable" onClick={() => setPromoOpen(true)}>
              <TicketPercent className="h-4 w-4" /> Есть промокод?
            </button>
          ))}
          {item.kind === 'product' && (item.product.price_usd || (item.product.price_stars && item.product.stars_enabled)) && !promo && (
            <div className="flex items-center justify-between rounded-2xl bg-ov/[0.03] px-3.5 py-2.5 text-[12.5px] text-muted">
              <span>Цена в других валютах</span>
              <span className="num font-semibold text-ink/80">
                {item.product.price_usd ? usd(item.product.price_usd * qty) : ''}
                {item.product.price_usd && item.product.price_stars && item.product.stars_enabled ? ' · ' : ''}
                {item.product.stars_enabled && item.product.price_stars ? stars(item.product.price_stars * qty) : ''}
              </span>
            </div>
          )}
          {item.kind === 'product' && <GuaranteeCard category={item.product.category} compact />}
          <div className="flex items-end justify-between border-t border-line/60 px-1 pt-4">
            <span className="text-[14px] text-muted">Итого к оплате</span>
            <span className="num text-[28px] font-bold leading-none tracking-tight">{money(total)}</span>
          </div>
          <div className="flex items-start gap-2.5 rounded-2xl bg-ov/[0.03] p-3 text-[12px] leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            Товар резервируется за вами на 30 минут. Цена фиксируется сервером; сумма списывается только выбранным способом оплаты. Цена в долларах — справочная.
          </div>
          <Button className="w-full" loading={busy} onClick={createOrder} disabled={maxQty < 1}>
            Создать заказ · {money(total)}
          </Button>
        </div>
      )}

      {step === 'pay' && order && (
        <div className="fade-in space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-[14px] text-muted">К оплате</span>
            <span className="num text-[24px] font-bold tracking-tight">{money(order.total)}</span>
          </div>
          {order.expires_at && <Countdown until={order.expires_at} />}
          <PayMethods
            methods={config?.payment_methods ?? ['balance']}
            total={order.total}
            balance={me?.balance}
            uahPerStar={uahPerStar}
            starsTotal={order.stars_total}
            exclude={item.kind === 'product' && !item.product.stars_enabled ? ['stars'] : []}
            loading={paying}
            onPick={pay}
          />
          <Button variant="ghost" className="w-full" size="md" onClick={cancel}>Отменить заказ</Button>
        </div>
      )}

      {step === 'manual' && manual && (
        <ManualPayment payment={manual.payment} instructions={manual.instructions} onSubmitted={() => setStep('review')} />
      )}

      {step === 'review' && (
        <div className="space-y-4 py-2 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-warning/12 text-warning"><Clock3 className="h-8 w-8" /></div>
          <p className="text-sm text-muted">Мы проверим поступление средств и уведомим вас в Telegram. Статус заказа обновится автоматически.</p>
          <Button className="w-full" onClick={() => { onClose(); navigate(`/orders/${order?.id}`) }}>Перейти к заказу</Button>
        </div>
      )}

      {step === 'success' && order && (
        <div className="fade-in space-y-4 py-2 text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-success/12 text-success ring-1 ring-inset ring-success/30">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <div>
            <div className="text-[20px] font-bold tracking-tight">Оплата прошла</div>
            <p className="mt-1 text-sm text-muted">Заказ {order.public_id ?? `#${order.id}`} · {order.status === 'completed' ? 'выполнен — данные в карточке заказа' : 'оплачен, ожидает выдачи'}</p>
          </div>
          {order.payment_method === 'test' && <Badge tone="amber">ТЕСТОВЫЙ ПЛАТЁЖ · DEV_MODE</Badge>}
          {order.delivery_data && (
            <div className="rounded-2xl border border-success/25 bg-success/[0.06] p-4 text-left">
              <div className="eyebrow text-success">Выдача</div>
              <div className="mt-1 whitespace-pre-line font-mono text-[15px] font-bold">{order.delivery_data}</div>
            </div>
          )}
          <Button className="w-full" onClick={() => { onClose(); navigate(`/orders/${order.id}`) }}>Открыть заказ</Button>
        </div>
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
    <div role="timer" className="num flex items-center justify-center gap-2 rounded-2xl bg-warning/[0.08] py-2.5 text-[13px] font-semibold text-warning">
      <Clock3 className="h-4 w-4" /> Резерв: {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </div>
  )
}
