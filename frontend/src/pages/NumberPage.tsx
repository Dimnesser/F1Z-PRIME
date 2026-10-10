import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Eye, Gem, Lock, Sparkles } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, EmptyState, Skeleton } from '../components/ui'
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

  if (isLoading) return <Skeleton className="h-80 rounded-[32px]" />
  if (error || !n) return <EmptyState icon={<Gem className="h-7 w-7" />} title="Номер недоступен" action={<Button size="md" onClick={() => navigate('/numbers')}>Все номера</Button>} />

  const available = n.status === 'available'
  return (
    <div className="space-y-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-muted pressable">
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>
      <motion.div initial={{ opacity: 0, rotateX: 12, y: 20 }} animate={{ opacity: 1, rotateX: 0, y: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 22 }} className="rounded-[32px] bg-brand p-[1.5px] shadow-glow">
        <div className="relative overflow-hidden rounded-[31px] bg-[radial-gradient(120%_120%_at_100%_0%,#2b1a5c_0%,#13112a_50%,#0a1720_100%)] p-6">
          <div className="pointer-events-none absolute -left-10 -top-10 h-44 w-44 animate-spin-slow rounded-full bg-[conic-gradient(rgba(139,92,246,0.45),rgba(34,211,238,0.35),transparent)] blur-2xl" />
          <div className="relative flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em]">
              <Gem className="h-3.5 w-3.5" /> {n.title}
            </span>
            <span className="text-4xl">{n.country?.flag ?? '🌐'}</span>
          </div>
          <div className="relative mt-8 text-center font-mono text-[30px] font-bold tracking-wider text-white">{n.display_mask}</div>
          <div className="relative mt-2 text-center text-[13px] text-white/60">{n.country?.name} · {n.country?.dial_code}</div>
          <div className="relative mt-8 flex items-end justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Стоимость</div>
              <div className="font-display text-[28px] font-bold text-white">{money(n.price)}</div>
            </div>
            <Badge tone={available ? 'green' : 'gray'}>{available ? '📦 В наличии' : 'Недоступен'}</Badge>
          </div>
        </div>
      </motion.div>

      <div className="card space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary-soft"><Lock className="h-4 w-4" /></div>
          <p className="text-[13.5px] leading-relaxed text-ink/85">Часть цифр скрыта маской. Полный номер появится в заказе сразу после подтверждения оплаты.</p>
        </div>
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary/15 text-secondary"><Eye className="h-4 w-4" /></div>
          <p className="text-[13.5px] leading-relaxed text-ink/85">Номер бронируется за вами на 30 минут после создания заказа — его не сможет купить никто другой.</p>
        </div>
        {n.description && (
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warning/15 text-warning"><Sparkles className="h-4 w-4" /></div>
            <p className="text-[13.5px] leading-relaxed text-ink/85">{n.description}</p>
          </div>
        )}
      </div>

      <div className="sticky z-30" style={{ bottom: 'calc(var(--safe-bottom) + 92px)' }}>
        <Button className="w-full" disabled={!available} onClick={() => checkout({ kind: 'premium', number: n })}>
          Купить за {money(n.price)}
        </Button>
      </div>
    </div>
  )
}
