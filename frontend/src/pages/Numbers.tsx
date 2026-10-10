import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Gem } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PremiumCard } from '../components/Cards'
import { EmptyState, PageTitle, Skeleton, stagger } from '../components/ui'
import { usePremium } from '../lib/queries'
import { haptic } from '../lib/telegram'

export default function Numbers() {
  const navigate = useNavigate()
  const { data, isLoading } = usePremium()
  const [country, setCountry] = useState<string>('all')

  const countries = useMemo(() => {
    const m = new Map<string, { code: string; flag: string; name: string }>()
    data?.forEach((n) => n.country && m.set(n.country.code, n.country))
    return [...m.values()]
  }, [data])

  const list = (data ?? []).filter((n) => country === 'all' || n.country?.code === country)

  return (
    <div>
      <PageTitle
        title="Красивые номера"
        subtitle="Эксклюзивные комбинации цифр. Полный номер открывается после покупки."
        right={<div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand shadow-glow"><Gem className="h-6 w-6 text-white" /></div>}
      />
      {countries.length > 1 && (
        <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 no-scrollbar">
          {[{ code: 'all', flag: '🌐', name: 'Все' }, ...countries].map((c) => (
            <button
              key={c.code}
              onClick={() => { setCountry(c.code); haptic.select() }}
              className={clsx(
                'pressable flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold ring-1',
                country === c.code ? 'bg-ink text-bg ring-ink' : 'bg-card text-muted ring-white/[0.07]',
              )}
            >
              <span>{c.flag}</span> {c.name}
            </button>
          ))}
        </div>
      )}
      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[200px] rounded-3xl" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Gem className="h-7 w-7" />} title="Пока пусто" text="Новые красивые номера появятся совсем скоро" />
      ) : (
        <motion.div variants={stagger.container} initial="hidden" animate="show" className="space-y-3">
          {list.map((n) => <PremiumCard key={n.id} n={n} wide onOpen={() => navigate(`/number/${n.id}`)} />)}
        </motion.div>
      )}
    </div>
  )
}
