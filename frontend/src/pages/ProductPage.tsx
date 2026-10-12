import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BadgeCheck, Clock, MessageSquareText, Package, ShieldCheck, UserCheck, Zap } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { StockLabel } from '../components/Cards'
import { GuaranteeCard } from '../components/Guarantee'
import { Button, EmptyState, ErrorState, IconButton, Skeleton, Stepper } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { money, stars, usd } from '../lib/format'
import { useShop } from '../lib/shop'
import { useBack } from '../lib/useBack'

export default function ProductPage() {
  useBack('/catalog')
  const { id } = useParams()
  const navigate = useNavigate()
  const { checkout } = useShop()
  const [qty, setQty] = useState(1)
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: ['product', id], queryFn: () => api.product(Number(id)) })

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-11 w-11 rounded-[14px]" />
        <Skeleton className="h-[260px] rounded-[24px]" />
        <Skeleton className="h-24 rounded-[20px]" />
      </div>
    )
  }
  if (error instanceof ApiError && error.status !== 404 && error.status !== 0) {
    return <ErrorState text={error.message} onRetry={() => refetch()} />
  }
  if (error || !p) {
    return <EmptyState icon={<Package className="h-7 w-7" />} title="Товар не найден" text="Возможно, он снят с продажи" action={<Button size="md" onClick={() => navigate('/catalog')}>В каталог</Button>} />
  }

  const inStock = p.stock > 0
  const maxQty = Math.max(1, Math.min(10, p.stock, p.max_per_order ?? 10))
  const total = p.price * qty

  return (
    <div className="space-y-3">
      <IconButton label="Назад" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></IconButton>

      <section className="fade-in card relative overflow-hidden p-5">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,rgb(var(--primary)/0.22),transparent)]" />
        <div className="relative flex items-start gap-4">
          <div className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-[22px] bg-ov/[0.05] text-[42px] ring-1 ring-inset ring-line/70">
            {p.country?.flag ?? <Package className="h-8 w-8 text-primary-soft" />}
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="text-[21px] font-bold leading-tight tracking-tight">{p.title}</h1>
            {p.country && <div className="num mt-1 text-[13px] text-muted">Код страны {p.country.dial_code}</div>}
            <div className="mt-2"><StockLabel stock={p.stock} /></div>
          </div>
        </div>

        <div className="relative mt-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Цена за шт.</div>
            <div className="num mt-1 text-[28px] font-bold leading-none tracking-tight">{money(p.price)}</div>
            <div className="num mt-1.5 text-[12.5px] text-muted">
              {p.old_price ? <><s>{money(p.old_price)}</s> · акция </> : null}
              {usd(p.price_usd)}{p.price_usd && p.price_stars && p.stars_enabled ? ' · ' : ''}{p.stars_enabled ? stars(p.price_stars) : ''}
            </div>
          </div>
          {inStock && maxQty > 1 && <Stepper value={qty} max={maxQty} onChange={setQty} />}
        </div>

        <div className={`relative mt-4 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] font-medium ${p.instant ? 'bg-success/10 text-success' : 'bg-ov/[0.05] text-muted'}`}>
          {p.instant ? <><Zap className="h-4 w-4 shrink-0" /> Мгновенная выдача после оплаты</> : <><UserCheck className="h-4 w-4 shrink-0" /> Выдача оператором после подтверждения оплаты</>}
        </div>
      </section>

      {p.description && (
        <section className="card p-4">
          <h2 className="eyebrow mb-2">Описание</h2>
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink/90">{p.description}</p>
        </section>
      )}

      {(p.tags.length > 0 || Object.keys(p.attributes).length > 0) && (
        <section className="card overflow-hidden">
          {p.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-4 pb-3">
              {p.tags.map((t) => <span key={t} className="rounded-full bg-primary/12 px-2.5 py-1 text-[12px] font-medium text-primary-soft">#{t}</span>)}
            </div>
          )}
          {Object.keys(p.attributes).length > 0 && (
            <div className="hairline">
              {Object.entries(p.attributes).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
                  <span className="text-muted">{k}</span><span className="text-right font-semibold">{v}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <GuaranteeCard category={p.category} />

      <section className="card hairline overflow-hidden">
        {[
          { icon: Clock, t: 'Резерв 30 минут', d: 'Товар закрепляется за вами на время оплаты' },
          { icon: ShieldCheck, t: 'Проверенная оплата', d: p.stars_enabled ? 'Telegram Stars, баланс или перевод с проверкой' : 'Баланс или перевод с проверкой (Stars недоступны)' },
          { icon: BadgeCheck, t: 'Выдача в заказе', d: 'Данные появятся в карточке заказа в разделе «Заказы»' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="flex items-center gap-3 px-4 py-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ov/[0.05] text-primary-soft"><Icon className="h-[18px] w-[18px]" /></div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">{t}</div>
              <div className="text-[12px] leading-snug text-muted">{d}</div>
            </div>
          </div>
        ))}
      </section>

      {!inStock && (
        <Button variant="ghost" size="md" className="w-full" onClick={() => navigate('/support')}>
          <MessageSquareText className="h-4 w-4" /> Спросить о поступлении
        </Button>
      )}

      <div className="sticky-cta sticky z-30 pt-2">
        <div className="rounded-[20px] border border-line/80 bg-surface/90 p-2 shadow-pop backdrop-blur-xl">
          <Button className="w-full" disabled={!inStock} onClick={() => checkout({ kind: 'product', product: p, qty })}>
            {inStock ? <>Купить{qty > 1 ? ` ${qty} шт` : ''} · <span className="num">{money(total)}</span></> : 'Нет в наличии'}
          </Button>
        </div>
      </div>
    </div>
  )
}
