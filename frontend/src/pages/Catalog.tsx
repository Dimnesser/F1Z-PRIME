import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Search, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CountryCard, ProductMini } from '../components/Cards'
import { CountryRequestButton } from '../components/CountryRequest'
import { GuaranteeCard } from '../components/Guarantee'
import { EmptyState, PageTitle, SectionHeader, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { useCategories, useCountries } from '../lib/queries'
import { useShop } from '../lib/shop'
import { haptic } from '../lib/telegram'

const SORTS = [
  { id: 'default', label: 'Все' },
  { id: 'stock', label: 'В наличии' },
  { id: 'cheap', label: 'Дешевле' },
  { id: 'expensive', label: 'Дороже' },
] as const

export default function Catalog() {
  const navigate = useNavigate()
  const { checkout } = useShop()
  const { data: countries, isLoading } = useCountries()
  const { data: digital } = useQuery({ queryKey: ['products', 'other'], queryFn: () => api.products() })
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('default')

  const list = useMemo(() => {
    let l = (countries ?? []).filter((c) => `${c.name} ${c.dial_code} ${c.code}`.toLowerCase().includes(q.toLowerCase()))
    if (sort === 'stock') l = l.filter((c) => c.stock > 0)
    if (sort === 'cheap') l = [...l].sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
    if (sort === 'expensive') l = [...l].sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
    return l
  }, [countries, q, sort])

  const { data: categories } = useCategories()
  const others = (digital ?? []).filter((p) => p.category !== 'numbers')
  // one section per category (e.g. «Рандом аккаунты 2015–2019», digital goods), titles from the shop settings
  const groups = [...new Set(others.map((p) => p.category))].map((slug) => ({
    slug, title: categories?.find((c) => c.slug === slug)?.title ?? slug, items: others.filter((p) => p.category === slug),
  }))

  const buy = async (productId: number) => {
    try {
      checkout({ kind: 'product', product: await api.product(productId) })
    } catch (e) {
      haptic.error()
      console.error(e)
    }
  }

  return (
    <div>
      <PageTitle title="Страны номеров" subtitle="Цены в гривнах, долларах и Telegram Stars. Выдача после подтверждения оплаты." />
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted" />
        <input className="input pl-11" placeholder="Страна или код, например +48" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        {SORTS.map((s) => (
          <button
            key={s.id}
            onClick={() => { setSort(s.id); haptic.select() }}
            className={clsx(
              'pressable shrink-0 rounded-full px-4 py-2 text-[13px] font-bold ring-1 transition',
              sort === s.id ? 'bg-ink text-bg ring-ink' : 'bg-card text-muted ring-white/[0.07]',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[88px] rounded-3xl" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={<SearchX className="h-7 w-7" />} title="Ничего не найдено" text="Попробуйте изменить запрос или фильтр" />
      ) : (
        <motion.div className="stagger space-y-3">
          {list.map((c) => (
            <CountryCard
              key={c.id}
              c={c}
              onOpen={() => c.product_id && navigate(`/product/${c.product_id}`)}
              onBuy={() => c.product_id && buy(c.product_id)}
            />
          ))}
        </motion.div>
      )}
      {!isLoading && <CountryRequestButton />}
      <div className="mt-3"><GuaranteeCard category="numbers" /></div>

      {groups.map((g) => (
        <section key={g.slug} className="mt-7">
          <SectionHeader title={g.title} />
          <motion.div className="stagger -mx-4 flex gap-3 overflow-x-auto px-4 no-scrollbar">
            {g.items.map((p) => <ProductMini key={p.id} p={p} onOpen={() => navigate(`/product/${p.id}`)} />)}
          </motion.div>
        </section>
      ))}
    </div>
  )
}
