import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Eye, Gem, Lock, Sparkles } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, EmptyState, IconButton, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { money } from '../lib/format'
import { useShop } from '../lib/shop'
import { useBack } from '../lib/useBack'

export default function NumberPage() {
  useBack('/numbers')
  const { id } = useParams()
  const navigate = useNavigate()
  const { checkout } = useShop()
  const { data: n, isLoading, error } = useQuery({ queryKey: ['premium', 'one', id], queryFn: () => api.premiumOne(Number(id)) })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-11 w-11 rounded-[14px]" /><Skeleton className="h-80 rounded-[24px]" /></div>
  if (error || !n) return <EmptyState icon={<Gem className="h-7 w-7" />} title="Номер недоступен" text="Возможно, его уже купили" action={<Button size="md" onClick={() => navigate('/numbers')}>Все номера</Button>} />

  const available = n.status === 'available'
  return (
    <div className="space-y-3">
      <IconButton label="Назад" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></IconButton>
      <section className="fade-in rounded-[24px] bg-gradient-to-br from-primary/60 via-primary/10 to-accent/40 p-px shadow-card">
        <div className="relative overflow-hidden rounded-[23px] bg-surface p-6">
          <div aria-hidden className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,rgb(var(--primary)/0.25),transparent)]" />
          <div className="relative flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ov/[0.07] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]">
              <Gem className="h-3.5 w-3.5 text-primary-soft" /> {n.title}
            </span>
            <span className="text-4xl leading-none">{n.country?.flag ?? '🌐'}</span>
          </div>
          <div className="num relative mt-8 text-center font-mono text-[28px] font-bold tracking-wider">{n.display_mask}</div>
          <div className="relative mt-2 text-center text-[13px] text-muted">{n.country?.name} · {n.country?.dial_code}</div>
          <div className="relative mt-8 flex items-end justify-between">
            <div>
              <div className="eyebrow">Стоимость</div>
              <div className="num mt-1 text-[28px] font-bold leading-none tracking-tight">{money(n.price)}</div>
            </div>
            <Badge tone={available ? 'green' : 'gray'} dot>{available ? 'В наличии' : 'Недоступен'}</Badge>
          </div>
        </div>
      </section>

      <section className="card hairline overflow-hidden">
        {[
          { icon: Lock, tint: 'bg-primary/12 text-primary-soft', t: 'Часть цифр скрыта маской. Полный номер появится в заказе сразу после подтверждения оплаты.' },
          { icon: Eye, tint: 'bg-accent/12 text-accent', t: 'Номер бронируется за вами на 30 минут после создания заказа — его не сможет купить никто другой.' },
          ...(n.description ? [{ icon: Sparkles, tint: 'bg-warning/12 text-warning', t: n.description }] : []),
        ].map(({ icon: Icon, tint, t }) => (
          <div key={t} className="flex items-start gap-3 p-4">
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tint}`}><Icon className="h-4 w-4" /></div>
            <p className="text-[13.5px] leading-relaxed text-ink/85">{t}</p>
          </div>
        ))}
      </section>

      <div className="sticky-cta sticky z-30 pt-2">
        <div className="rounded-[20px] border border-line/80 bg-surface/90 p-2 shadow-pop backdrop-blur-xl">
          <Button className="w-full" disabled={!available} onClick={() => checkout({ kind: 'premium', number: n })}>
            {available ? <>Купить за <span className="num">{money(n.price)}</span></> : 'Номер недоступен'}
          </Button>
        </div>
      </div>
    </div>
  )
}
