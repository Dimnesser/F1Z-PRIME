import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Gem, Globe2, Headphones, LayoutGrid, MessageSquareText, Package, Smartphone, Sparkles, UserRound, Zap } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { BalanceCard, PremiumCard, ProductCard } from '../components/Cards'
import { Logo } from '../components/Logo'
import { OrderStageBadge } from '../components/StatusBadge'
import { MaintenanceNotice } from '../components/StoreInfo'
import { SectionHeader, Skeleton, StatusIndicator } from '../components/ui'
import { api, SMS_ACTIVE } from '../lib/api'
import { date, money, plural } from '../lib/format'
import { useCategories, useConfig, useMe, useOrders, usePremium, useSmsActivations } from '../lib/queries'
import { useShop } from '../lib/shop'
import { haptic } from '../lib/telegram'
import type { Category } from '../lib/types'

const CAT_ICON: Record<string, typeof Globe2> = { globe: Globe2, gem: Gem, sparkles: Sparkles, zap: Zap, 'user-round': UserRound }
const ACTIVE_STATUSES = ['pending', 'paid', 'processing']

function greeting() {
  const h = new Date().getHours()
  if (h < 6) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}

export function categoryLink(c: Pick<Category, 'slug'>) {
  if (c.slug === 'premium') return '/numbers'
  if (c.slug === 'numbers') return '/catalog'
  return `/catalog?cat=${encodeURIComponent(c.slug)}`
}

export default function Home() {
  const navigate = useNavigate()
  const { topup } = useShop()
  const { data: me, isLoading: meLoading } = useMe()
  const { data: config } = useConfig()
  const { data: categories, isLoading: catLoading } = useCategories()
  const { data: premium } = usePremium()
  const { data: orders } = useOrders()
  const { data: activations } = useSmsActivations()
  const { data: popular, isLoading: popLoading } = useQuery({ queryKey: ['popular'], queryFn: () => api.products({ popular: true }) })
  const s = config?.settings

  const activeOrders = (orders ?? []).filter((o) => ACTIVE_STATUSES.includes(o.status)).slice(0, 3)
  const recent = (orders ?? []).filter((o) => o.status === 'completed').slice(0, 3)
  const activeSms = (activations ?? []).find((a) => SMS_ACTIVE.includes(a.status))
  const name = me?.first_name || me?.username || 'гость'

  const go = (to: string) => {
    haptic.select()
    navigate(to)
  }

  return (
    <div className="space-y-7">
      <header className="flex items-center justify-between">
        <Logo />
        <Link to="/profile" aria-label="Профиль" className="pressable rounded-full">
          <Avatar me={me} size={40} />
        </Link>
      </header>

      <div className="-mt-2 space-y-4">
        <div className="px-0.5">
          <div className="text-[13.5px] text-muted">{greeting()},</div>
          {meLoading ? <Skeleton className="mt-1 h-7 w-40" /> : <h1 className="truncate text-[24px] font-bold tracking-[-0.02em]">{name}</h1>}
        </div>
        <MaintenanceNotice />
        <BalanceCard
          balance={me?.balance}
          loading={meLoading}
          onTopup={topup}
          footer={me && (
            <div className="flex items-center gap-4 text-[12.5px] text-muted">
              <span><span className="num font-semibold text-ink">{me.orders_count}</span> {plural(me.orders_count, ['покупка', 'покупки', 'покупок'])}</span>
              <span className="h-3 w-px bg-line" />
              <span>потрачено <span className="num font-semibold text-ink">{money(me.total_spent)}</span></span>
            </div>
          )}
        />
      </div>

      {/* what can be bought — one tap away */}
      <nav aria-label="Быстрые действия" className="grid grid-cols-4 gap-2">
        {[
          { to: '/catalog', label: 'Каталог', icon: LayoutGrid, tint: 'text-primary-soft bg-primary/12' },
          { to: '/sms', label: 'SMS-номер', icon: Smartphone, tint: 'text-accent bg-accent/12' },
          { to: '/numbers', label: 'Красивые', icon: Gem, tint: 'text-warning bg-warning/12' },
          { to: '/support', label: 'Поддержка', icon: Headphones, tint: 'text-success bg-success/12' },
        ].map(({ to, label, icon: Icon, tint }) => (
          <button key={to} type="button" onClick={() => go(to)} className="pressable flex min-w-0 flex-col items-center gap-2 rounded-2xl py-2">
            <span className={`grid h-14 w-14 place-items-center rounded-[18px] ring-1 ring-inset ring-line/60 ${tint}`}><Icon className="h-6 w-6" /></span>
            <span className="max-w-full truncate text-[12px] font-semibold">{label}</span>
          </button>
        ))}
      </nav>

      {(activeSms || activeOrders.length > 0) && (
        <section aria-label="Активные заказы">
          <SectionHeader title="Активные" action="Все заказы" onAction={() => go('/orders')} />
          <div className="card hairline overflow-hidden">
            {activeSms && (
              <button type="button" onClick={() => go('/sms')} className="pressable flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><MessageSquareText className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold">SMS-активация · {activeSms.service}</span>
                  <span className="num block truncate font-mono text-[12.5px] text-muted">{activeSms.phone_number ?? 'номер выдаётся…'}</span>
                </span>
                <StatusIndicator tone={activeSms.code ? 'green' : 'cyan'} label={activeSms.code ? 'Код получен' : 'Ждём SMS'} live={!activeSms.code} />
              </button>
            )}
            {activeOrders.map((o) => (
              <button key={o.id} type="button" onClick={() => go(`/orders/${o.id}`)} className="pressable flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary-soft"><Package className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold">{o.item_title}</span>
                  <span className="num block text-[12.5px] text-muted">{o.public_id ?? `#${o.id}`} · {money(o.total)}</span>
                </span>
                <OrderStageBadge order={o} />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* store banner from the admin settings */}
      <button
        type="button"
        onClick={() => go('/catalog')}
        className="pressable relative block w-full overflow-hidden rounded-[24px] border border-line/80 bg-surface p-5 text-left shadow-card"
      >
        {s?.banner_image_url?.startsWith('https://') && (
          <>
            <img src={s.banner_image_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            <div className="absolute inset-0 bg-gradient-to-r from-bg/95 via-bg/70 to-bg/10" />
          </>
        )}
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,rgb(var(--accent)/0.18),transparent)]" />
        <img src="/brand.jpg" alt="" className="absolute right-4 top-4 h-14 w-14 rounded-2xl object-cover ring-1 ring-line" />
        <span className="eyebrow relative">{s?.shop_name ?? 'F1Z PRIME'}</span>
        <h2 className="relative mt-2 max-w-[230px] text-[20px] font-bold leading-[1.2] tracking-tight">{s?.banner_title ?? 'Премиальные цифровые товары'}</h2>
        {s?.banner_subtitle && <p className="relative mt-1.5 max-w-[270px] text-[13px] leading-snug text-muted">{s.banner_subtitle}</p>}
        <span className="relative mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-primary-soft">
          Открыть каталог <ArrowRight className="h-4 w-4" />
        </span>
      </button>

      <section aria-label="Категории">
        <SectionHeader title="Категории" action="Каталог" onAction={() => go('/catalog')} />
        <div className="grid grid-cols-2 gap-2.5">
          {catLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-[20px]" />)}
          {categories?.map((c) => {
            const Icon = CAT_ICON[c.icon] ?? Sparkles
            return (
              <button key={c.slug} type="button" onClick={() => go(categoryLink(c))} className="card pressable flex min-w-0 flex-col p-4 text-left">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary-soft"><Icon className="h-5 w-5" /></span>
                <span className="mt-3 line-clamp-2 text-[14px] font-semibold leading-tight">{c.title}</span>
                <span className="mt-1 text-[12px] text-muted">{c.stock > 0 ? `${c.stock} в наличии` : 'нет в наличии'}</span>
              </button>
            )
          })}
          <button type="button" onClick={() => go('/sms')} className="card pressable flex min-w-0 flex-col p-4 text-left">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/12 text-accent"><Smartphone className="h-5 w-5" /></span>
            <span className="mt-3 text-[14px] font-semibold leading-tight">Виртуальные номера</span>
            <span className="mt-1 text-[12px] text-muted">SMS-код для регистрации</span>
          </button>
        </div>
      </section>

      {(popLoading || (popular && popular.length > 0)) && (
        <section aria-label="Популярное">
          <SectionHeader title="Популярное" action="Все" onAction={() => go('/catalog')} />
          <div className="no-scrollbar -mx-4 flex snap-x gap-2.5 overflow-x-auto scroll-px-4 px-4 pb-1">
            {popLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[178px] w-[156px] shrink-0 rounded-[20px]" />)}
            {popular?.map((p) => <ProductCard key={p.id} p={p} className="w-[156px] shrink-0 snap-start" onOpen={() => navigate(`/product/${p.id}`)} />)}
          </div>
        </section>
      )}

      {premium && premium.length > 0 && (
        <section aria-label="Красивые номера">
          <SectionHeader title="Красивые номера" action="Все" onAction={() => go('/numbers')} />
          <div className="no-scrollbar -mx-4 flex snap-x gap-2.5 overflow-x-auto scroll-px-4 px-4 pb-1">
            {premium.slice(0, 6).map((n) => <div key={n.id} className="snap-start"><PremiumCard n={n} onOpen={() => navigate(`/number/${n.id}`)} /></div>)}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-label="Последние покупки">
          <SectionHeader title="Последние покупки" action="История" onAction={() => go('/orders')} />
          <div className="card hairline overflow-hidden">
            {recent.map((o) => (
              <button key={o.id} type="button" onClick={() => go(`/orders/${o.id}`)} className="pressable flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold">{o.item_title}</span>
                  <span className="block text-[12px] text-muted">{date(o.created_at)}</span>
                </span>
                <span className="num text-[14px] font-bold">{money(o.total)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <button type="button" onClick={() => go('/support')} className="card pressable flex w-full items-center gap-3.5 p-4 text-left">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-success/12 text-success"><Headphones className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Нужна помощь?</span>
          <span className="block truncate text-[12.5px] text-muted">{s?.support_contact ? `Поддержка: ${s.support_contact}` : 'Ответим прямо в Telegram'}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
      </button>
    </div>
  )
}
