import { Gem } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PremiumCard } from '../components/Cards'
import { Chips, EmptyState, ErrorState, PageTitle, Skeleton } from '../components/ui'
import { usePremium } from '../lib/queries'
import { useBack } from '../lib/useBack'

export default function Numbers() {
  useBack('/catalog')
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = usePremium()
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
        right={<div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-warning/12 text-warning ring-1 ring-inset ring-warning/20"><Gem className="h-6 w-6" /></div>}
      />
      {countries.length > 1 && (
        <Chips
          className="mb-4"
          value={country}
          onChange={setCountry}
          options={[{ value: 'all', label: 'Все' }, ...countries.map((c) => ({ value: c.code, label: <><span aria-hidden>{c.flag}</span> {c.name}</> }))]}
        />
      )}
      {isLoading ? (
        <div className="space-y-2.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[168px] rounded-[22px]" />)}</div>
      ) : error ? (
        <ErrorState text={(error as Error).message} onRetry={() => refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Gem className="h-7 w-7" />} title="Пока пусто" text="Новые красивые номера появятся совсем скоро" />
      ) : (
        <div className="stagger space-y-2.5">
          {list.map((n) => <PremiumCard key={n.id} n={n} wide onOpen={() => navigate(`/number/${n.id}`)} />)}
        </div>
      )}
    </div>
  )
}
