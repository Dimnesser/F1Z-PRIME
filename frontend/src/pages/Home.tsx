import { ChevronRight, Gem, Headphones, MessageSquareText, Plus, ReceiptText, Smartphone, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { BalanceCard, CountryTile, Group, PremiumCard } from '../components/Cards'
import { OrderStageBadge } from '../components/StatusBadge'
import { MaintenanceNotice } from '../components/StoreInfo'
import { SectionHeader, Skeleton, StatusIndicator } from '../components/ui'
import { SMS_ACTIVE } from '../lib/api'
import { money } from '../lib/format'
import { useCategories, useConfig, useCountries, useMe, useOrders, usePremium, useSmsActivations } from '../lib/queries'
import { useShop } from '../lib/shop'
import { haptic } from '../lib/telegram'
import type { Category } from '../lib/types'

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

function RowLink({ icon, tint, title, subtitle, onClick, trailing }: { icon: React.ReactNode; tint: string; title: string; subtitle?: string; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="pressable flex w-full items-center gap-3.5 px-4 py-3 text-left active:bg-ov/[0.03]">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] ${tint}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-medium">{title}</span>
        {subtitle && <span className="block truncate text-[13px] text-muted">{subtitle}</span>}
      </span>
      {trailing}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted/70" />
    </button>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { topup } = useShop()
  const { data: me, isLoading: meLoading } = useMe()
  const { data: config } = useConfig()
  const { data: categories } = useCategories()
  const { data: countries, isLoading: cLoading } = useCountries()
  const { data: premium } = usePremium()
  const { data: orders } = useOrders()
  const { data: activations } = useSmsActivations()
  const s = config?.settings

  const activeOrders = (orders ?? []).filter((o) => ACTIVE_STATUSES.includes(o.status)).slice(0, 3)
  const activeSms = (activations ?? []).find((a) => SMS_ACTIVE.includes(a.status))
  const rail = (countries ?? []).filter((c) => c.product_id !== null).sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0)).slice(0, 10)
  const extra = (categories ?? []).filter((c) => c.slug !== 'numbers' && c.slug !== 'premium')
  const name = me?.first_name || me?.username || 'гость'
  const holder = [me?.first_name, me?.last_name].filter(Boolean).join(' ') || (me?.username ? `@${me.username}` : '')

  const go = (to: string) => {
    haptic.select()
    navigate(to)
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <header className="flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <div className="text-[14px] text-muted">{greeting()}</div>
            {meLoading ? <Skeleton className="mt-1 h-7 w-36" /> : <h1 className="truncate text-[26px] font-bold leading-tight tracking-[-0.02em]">{name}</h1>}
          </div>
          <Link to="/profile" aria-label="Профиль" className="pressable rounded-full">
            <Avatar me={me} size={44} />
          </Link>
        </header>

        <MaintenanceNotice />

        <BalanceCard balance={me?.balance} loading={meLoading} holder={holder} id={me?.telegram_id} />

        <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-2">
          <button type="button" onClick={() => { haptic.tap('medium'); topup() }} className="pressable flex h-[52px] items-center justify-center gap-2 rounded-[16px] bg-primary text-[15px] font-semibold text-primary-ink shadow-glow">
            <Plus className="h-[18px] w-[18px] max-[359px]:hidden" strokeWidth={2.5} /> Пополнить
          </button>
          <button type="button" onClick={() => go('/sms')} className="pressable flex h-[52px] items-center justify-center gap-2 rounded-[16px] bg-surface text-[14.5px] font-medium">
            <Smartphone className="h-[18px] w-[18px] text-accent max-[359px]:hidden" /> SMS
          </button>
          <button type="button" onClick={() => go('/orders')} className="pressable flex h-[52px] items-center justify-center gap-2 rounded-[16px] bg-surface text-[14.5px] font-medium">
            <ReceiptText className="h-[18px] w-[18px] text-primary-soft max-[359px]:hidden" /> Заказы
          </button>
        </div>
      </div>

      {(activeSms || activeOrders.length > 0) && (
        <Group title="В процессе" action={<button type="button" onClick={() => go('/orders')} className="text-[14px] font-medium text-primary-soft">Все заказы</button>}>
          {activeSms && (
            <button type="button" onClick={() => go('/sms')} className="pressable flex w-full items-center gap-3.5 px-4 py-3 text-left">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-accent/12 text-accent"><MessageSquareText className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-medium">Номер для {activeSms.service}</span>
                <span className="num block truncate font-display text-[13px] text-muted">{activeSms.phone_number ?? 'выдаётся…'}</span>
              </span>
              <StatusIndicator tone={activeSms.code ? 'green' : 'cyan'} label={activeSms.code ? 'Код пришёл' : 'Ждём SMS'} live={!activeSms.code} />
            </button>
          )}
          {activeOrders.map((o) => (
            <button key={o.id} type="button" onClick={() => go(`/orders/${o.id}`)} className="pressable flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-medium">{o.item_title}</span>
                <span className="num block text-[13px] text-muted">{money(o.total)}</span>
              </span>
              <OrderStageBadge order={o} />
            </button>
          ))}
        </Group>
      )}

      <section aria-label="Номера по странам">
        <SectionHeader title="Номера по странам" action="Все страны" onAction={() => go('/catalog')} />
        <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1">
          {cLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[124px] w-[120px] shrink-0 rounded-[22px]" />)}
          {rail.map((c) => <CountryTile key={c.id} c={c} onOpen={() => c.product_id && navigate(`/product/${c.product_id}`)} />)}
        </div>
      </section>

      {(s?.banner_title || s?.banner_image_url) && (
        <button type="button" onClick={() => go('/catalog')} className="card pressable relative block w-full overflow-hidden text-left">
          {s.banner_image_url?.startsWith('https://') ? (
            <>
              <img src={s.banner_image_url} alt="" className="h-36 w-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 text-snow">
                <div className="text-[17px] font-semibold leading-tight">{s.banner_title}</div>
                {s.banner_subtitle && <div className="mt-1 line-clamp-2 text-[13px] text-snow/75">{s.banner_subtitle}</div>}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-4 p-4">
              <img src="/brand.jpg" alt="" className="h-14 w-14 shrink-0 rounded-[16px] object-cover" />
              <div className="min-w-0">
                <div className="text-[16px] font-semibold leading-snug">{s.banner_title}</div>
                {s.banner_subtitle && <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{s.banner_subtitle}</div>}
              </div>
            </div>
          )}
        </button>
      )}

      <Group title="Ещё в магазине">
        <RowLink icon={<Smartphone className="h-5 w-5" />} tint="bg-accent/12 text-accent" title="Номер для SMS-кода" subtitle="Код для регистрации придёт прямо сюда" onClick={() => go('/sms')} />
        <RowLink icon={<Gem className="h-5 w-5" />} tint="bg-warning/12 text-warning" title="Красивые номера" subtitle={premium?.length ? `${premium.length} в наличии` : 'Эксклюзивные комбинации'} onClick={() => go('/numbers')} />
        {extra.map((c) => (
          <RowLink key={c.slug} icon={<UserRound className="h-5 w-5" />} tint="bg-primary/12 text-primary-soft" title={c.title} subtitle={c.stock > 0 ? `${c.stock} в наличии` : 'Скоро появятся'} onClick={() => go(categoryLink(c))} />
        ))}
      </Group>

      {premium && premium.length > 0 && (
        <section aria-label="Красивые номера">
          <SectionHeader title="Красивые номера" action="Все" onAction={() => go('/numbers')} />
          <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1">
            {premium.slice(0, 6).map((n) => <PremiumCard key={n.id} n={n} onOpen={() => navigate(`/number/${n.id}`)} />)}
          </div>
        </section>
      )}

      <Group footer={s?.support_contact ? `Пишите ${s.support_contact} — ответим в Telegram.` : undefined}>
        <RowLink icon={<Headphones className="h-5 w-5" />} tint="bg-success/12 text-success" title="Поддержка" subtitle="Вопрос по заказу или оплате" onClick={() => go('/support')} />
      </Group>
    </div>
  )
}
