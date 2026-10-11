import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, BadgeCheck, Clock, MessageSquareText, Package, ShieldCheck } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, EmptyState, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { money } from '../lib/format'
import { useShop } from '../lib/shop'
import { useBack } from '../lib/useBack'

export default function ProductPage() {
  useBack('/catalog')
  const { id } = useParams()
  const navigate = useNavigate()
  const { checkout } = useShop()
  const { data: p, isLoading, error } = useQuery({ queryKey: ['product', id], queryFn: () => api.product(Number(id)) })

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-64 rounded-[32px]" /><Skeleton className="h-32 rounded-3xl" /></div>
  if (error || !p) return <EmptyState icon={<Package className="h-7 w-7" />} title="Товар не найден" text="Возможно, он снят с продажи" action={<Button size="md" onClick={() => navigate('/catalog')}>В каталог</Button>} />

  const inStock = p.stock > 0
  return (
    <div className="space-y-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-muted pressable">
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>
      <motion.div className="fade-in relative overflow-hidden rounded-[32px] bg-brand-soft p-6 text-center ring-1 ring-white/10">
        <div className="pointer-events-none absolute left-1/2 top-6 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.60),transparent)]" />
        <div className="relative mx-auto grid h-28 w-28 place-items-center rounded-[32px] bg-white/[0.06] text-[64px] ring-1 ring-white/15">
          {p.country?.flag ?? '📦'}
        </div>
        <h1 className="relative mt-5 font-display text-2xl font-bold">{p.title}</h1>
        {p.country && (
          <div className="relative mt-2 inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-1 text-[13px] font-semibold">
            Код страны <span className="font-mono text-secondary">{p.country.dial_code}</span>
          </div>
        )}
        <div className="relative mt-5 grid grid-cols-2 gap-3 text-left">
          <div className="rounded-2xl bg-bg/50 p-3.5 ring-1 ring-white/[0.06]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Цена</div>
            <div className="mt-0.5 font-display text-xl font-bold text-gradient">{money(p.price)}</div>
            {p.old_price ? <div className="text-[12px] font-semibold text-muted"><s>{money(p.old_price)}</s> · акция</div> : null}
          </div>
          <div className="rounded-2xl bg-bg/50 p-3.5 ring-1 ring-white/[0.06]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">В наличии</div>
            <div className={`mt-0.5 font-display text-xl font-bold ${inStock ? 'text-success' : 'text-danger'}`}>{inStock ? `${p.stock} шт` : 'нет'}</div>
          </div>
        </div>
      </motion.div>

      {(p.tags.length > 0 || Object.keys(p.attributes).length > 0) && (
        <div className="card p-4">
          {p.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.tags.map((t) => <span key={t} className="rounded-full bg-primary/15 px-2.5 py-1 text-[12px] font-semibold text-primary-soft">#{t}</span>)}
            </div>
          )}
          {Object.keys(p.attributes).length > 0 && (
            <div className={p.tags.length ? 'mt-3 divide-y divide-white/[0.06]' : 'divide-y divide-white/[0.06]'}>
              {Object.entries(p.attributes).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                  <span className="text-muted">{k}</span><span className="text-right font-semibold">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {p.description && (
        <div className="card p-4">
          <div className="mb-1.5 text-[13px] font-bold text-muted">Описание</div>
          <p className="text-[14px] leading-relaxed text-ink/90">{p.description}</p>
        </div>
      )}

      <div className="card divide-y divide-white/[0.06]">
        {[
          { icon: Clock, t: 'Резерв 30 минут', d: 'Товар закрепляется за вами на время оплаты' },
          { icon: ShieldCheck, t: 'Проверенная оплата', d: 'Telegram Stars, баланс или перевод с проверкой' },
          { icon: BadgeCheck, t: 'Выдача в заказе', d: 'Данные появятся в разделе «Покупки» и в чате бота' },
          { icon: MessageSquareText, t: 'Поддержка', d: 'Поможем, если что-то пошло не так' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="flex items-center gap-3 p-3.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-primary-soft"><Icon className="h-[18px] w-[18px]" /></div>
            <div>
              <div className="text-[14px] font-semibold">{t}</div>
              <div className="text-[12px] text-muted">{d}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="sticky z-30" style={{ bottom: 'calc(var(--safe-bottom) + 92px)' }}>
        <Button className="w-full" disabled={!inStock} onClick={() => checkout({ kind: 'product', product: p })}>
          {inStock ? `Купить за ${money(p.price)}` : 'Нет в наличии'}
        </Button>
      </div>
    </div>
  )
}
