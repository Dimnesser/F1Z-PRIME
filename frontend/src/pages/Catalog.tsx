import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Gem, PackageOpen, SearchX, Smartphone } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CountryCard, ProductCard } from '../components/Cards'
import { CountryRequestButton } from '../components/CountryRequest'
import { GuaranteeCard } from '../components/Guarantee'
import { Chips, EmptyState, ErrorState, PageTitle, SearchInput, Skeleton } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { useCategories, useCountries } from '../lib/queries'
import { useShop } from '../lib/shop'
import { haptic } from '../lib/telegram'

type Sort = 'default' | 'stock' | 'cheap' | 'expensive'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'default', label: 'Все' },
  { value: 'stock', label: 'В наличии' },
  { value: 'cheap', label: 'Дешевле' },
  { value: 'expensive', label: 'Дороже' },
]

export default function Catalog() {
  const navigate = useNavigate()
  const toast = useToast()
  const { checkout } = useShop()
  const [params, setParams] = useSearchParams()
  const cat = params.get('cat') ?? 'numbers'
  const countries = useCountries()
  const products = useQuery({ queryKey: ['products', 'all'], queryFn: () => api.products() })
  const { data: categories } = useCategories()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('default')

  const sections = (categories ?? []).filter((c) => c.slug !== 'premium')
  const tabs = sections.length ? sections : [{ slug: 'numbers', title: 'Номера по странам', count: 0, stock: 0, icon: 'globe' }]
  const setCat = (slug: string) => setParams(slug === 'numbers' ? {} : { cat: slug }, { replace: true })

  const query = q.trim().toLowerCase()
  const countryList = useMemo(() => {
    let l = (countries.data ?? []).filter((c) => `${c.name} ${c.dial_code} ${c.code}`.toLowerCase().includes(query))
    if (sort === 'stock') l = l.filter((c) => c.stock > 0)
    if (sort === 'cheap') l = [...l].sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
    if (sort === 'expensive') l = [...l].sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
    return l
  }, [countries.data, query, sort])
  const productList = (products.data ?? []).filter(
    (p) => p.category === cat && `${p.title} ${p.description}`.toLowerCase().includes(query),
  )

  const buy = async (productId: number) => {
    try {
      checkout({ kind: 'product', product: await api.product(productId) })
    } catch (e) {
      haptic.error()
      toast((e as Error).message, 'error')
    }
  }

  const loading = cat === 'numbers' ? countries.isLoading : products.isLoading
  const error = cat === 'numbers' ? countries.error : products.error

  return (
    <div>
      <PageTitle title="Каталог" subtitle="Цены в гривнах, долларах и Telegram Stars. Выдача после подтверждения оплаты." />

      <SearchInput value={q} onChange={setQ} placeholder={cat === 'numbers' ? 'Страна или код, например +48' : 'Поиск товара'} />

      {/* other storefronts */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {[
          { to: '/sms', icon: Smartphone, title: 'SMS-номера', sub: 'Код для регистрации', tint: 'bg-accent/12 text-accent' },
          { to: '/numbers', icon: Gem, title: 'Красивые', sub: 'Эксклюзивные номера', tint: 'bg-warning/12 text-warning' },
        ].map(({ to, icon: Icon, title, sub, tint }) => (
          <button key={to} type="button" onClick={() => { haptic.select(); navigate(to) }} className="card pressable flex min-w-0 items-center gap-2.5 p-3 text-left">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tint}`}><Icon className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold leading-tight">{title}</span>
              <span className="block truncate text-[11.5px] text-muted max-[359px]:hidden">{sub}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted max-[359px]:hidden" />
          </button>
        ))}
      </div>

      {tabs.length > 1 && (
        <Chips
          className="mt-5"
          value={cat}
          onChange={setCat}
          options={tabs.map((c) => ({ value: c.slug, label: c.title, count: c.slug === 'numbers' ? undefined : c.count }))}
        />
      )}

      {cat === 'numbers' && (
        <Chips className="mt-3" value={sort} onChange={setSort} options={SORTS} />
      )}

      <div className="mt-4">
        {loading ? (
          <div className={cat === 'numbers' ? 'space-y-2.5' : 'grid grid-cols-2 gap-2.5'}>
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className={cat === 'numbers' ? 'h-[84px] rounded-[20px]' : 'h-[178px] rounded-[20px]'} />)}
          </div>
        ) : error ? (
          <ErrorState text={(error as Error).message} onRetry={() => (cat === 'numbers' ? countries.refetch() : products.refetch())} />
        ) : cat === 'numbers' ? (
          countryList.length === 0 ? (
            <EmptyState icon={<SearchX className="h-7 w-7" />} title="Ничего не найдено" text="Попробуйте изменить запрос или фильтр" />
          ) : (
            <div className="stagger space-y-2.5">
              {countryList.map((c) => (
                <CountryCard
                  key={c.id}
                  c={c}
                  onOpen={() => c.product_id && navigate(`/product/${c.product_id}`)}
                  onBuy={() => c.product_id && buy(c.product_id)}
                />
              ))}
            </div>
          )
        ) : productList.length === 0 ? (
          <EmptyState icon={<PackageOpen className="h-7 w-7" />} title={query ? 'Ничего не найдено' : 'Пока пусто'} text={query ? 'Попробуйте другой запрос' : 'Товары этой категории скоро появятся'} />
        ) : (
          <div className="stagger grid grid-cols-2 gap-2.5">
            {productList.map((p) => <ProductCard key={p.id} p={p} onOpen={() => navigate(`/product/${p.id}`)} />)}
          </div>
        )}
      </div>

      {cat === 'numbers' && !loading && (
        <div className="mt-3 space-y-3">
          <CountryRequestButton />
          <GuaranteeCard category="numbers" />
        </div>
      )}
      {cat !== 'numbers' && <div className="mt-3"><GuaranteeCard category={cat} /></div>}
    </div>
  )
}
