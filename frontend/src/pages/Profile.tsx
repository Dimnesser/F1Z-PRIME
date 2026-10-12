import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronRight, Copy, Headphones, MoonStar, ReceiptText, ShieldCheck, ShoppingBag, Wallet } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { useStoreLinks } from '../components/StoreInfo'
import { useToast } from '../components/Toast'
import { Badge, ErrorState, ListRow, Skeleton, StatCard, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { money, shortDate } from '../lib/format'
import { useConfig, useMe } from '../lib/queries'
import { openAdminPanel, openExternal } from '../lib/telegram'
import { useTheme, type ThemePref } from '../lib/theme'

export default function Profile() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: me, isLoading, error, refetch } = useMe()
  const { data: config } = useConfig()
  const links = useStoreLinks()
  const theme = useTheme()
  // shown only when the server confirms owner/admin for this Telegram account
  const { data: access } = useQuery({ queryKey: ['admin-access'], queryFn: api.adminAccess, staleTime: 60_000, retry: false })

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-52 rounded-[24px]" /><Skeleton className="h-24 rounded-[20px]" /><Skeleton className="h-40 rounded-[20px]" /></div>
  if (error || !me) return <ErrorState text={(error as Error | null)?.message} onRetry={() => refetch()} />

  const name = [me.first_name, me.last_name].filter(Boolean).join(' ') || 'Пользователь'

  return (
    <div className="space-y-5">
      <section className="fade-in card relative overflow-hidden px-5 pb-5 pt-6 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(var(--primary)/0.22),transparent)]" />
        <div className="relative mx-auto w-fit"><Avatar me={me} size={84} /></div>
        <h1 className="relative mt-3 truncate text-[21px] font-bold tracking-tight">{name}</h1>
        {me.username && <div className="relative text-[14px] text-muted">@{me.username}</div>}
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(String(me.telegram_id)); toast('ID скопирован', 'success') }}
          className="pressable relative mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-ov/[0.06] px-3.5 font-mono text-[12.5px] font-semibold"
        >
          <span className="num">ID {me.telegram_id}</span> <Copy className="h-3.5 w-3.5 text-muted" aria-label="Скопировать ID" />
        </button>
        {config?.dev_mode && <div className="relative mt-3"><Badge tone="amber">DEV_MODE · тестовый пользователь</Badge></div>}
      </section>

      <section aria-label="Статистика" className="grid grid-cols-3 gap-2">
        <StatCard icon={<ShoppingBag className="h-4 w-4" />} label="Покупок" value={me.orders_count} />
        <StatCard icon={<Wallet className="h-4 w-4" />} tone="accent" label="Потрачено" value={money(me.total_spent)} />
        <StatCard icon={<CalendarDays className="h-4 w-4" />} tone="success" label="С нами с" value={shortDate(me.created_at).replace(' г.', '')} />
      </section>

      {access?.allowed && (
        <button
          type="button"
          onClick={openAdminPanel}
          className="fade-in pressable flex w-full items-center gap-3.5 rounded-[20px] border border-primary/30 bg-primary/[0.08] px-4 py-3.5 text-left"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary-soft"><ShieldCheck className="h-[22px] w-[22px]" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Админ-панель</span>
            <span className="block truncate text-[12px] text-muted">{access.role === 'owner' ? 'Владелец' : 'Администратор'} · заказы, товары, финансы</span>
          </span>
          <ChevronRight className="h-5 w-5 text-primary-soft" />
        </button>
      )}

      <section aria-label="Разделы" className="card hairline overflow-hidden">
        <ListRow icon={<ReceiptText className="h-[18px] w-[18px]" />} title="Мои заказы" subtitle="Статусы и выданные товары" onClick={() => navigate('/orders')} />
        <ListRow icon={<Wallet className="h-[18px] w-[18px]" />} title="Баланс и операции" subtitle={money(me.balance)} onClick={() => navigate('/balance')} />
        <ListRow icon={<Headphones className="h-[18px] w-[18px]" />} title="Поддержка" subtitle="Обращения и ответы" onClick={() => navigate('/support')} />
        {links.filter((l) => l.label !== 'Поддержка').map((l) => (
          <ListRow key={l.label} icon={<l.icon className="h-[18px] w-[18px]" />} title={l.label} onClick={() => openExternal(l.url)} />
        ))}
      </section>

      <section aria-label="Настройки интерфейса" className="card p-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-ov/[0.05] text-primary-soft"><MoonStar className="h-[18px] w-[18px]" /></span>
          <div>
            <div className="text-[15px] font-semibold">Оформление</div>
            <div className="text-[12.5px] text-muted">{theme.pref === 'auto' ? 'Как в Telegram' : theme.pref === 'dark' ? 'Всегда тёмная тема' : 'Всегда светлая тема'}</div>
          </div>
        </div>
        <Tabs<ThemePref>
          value={theme.pref}
          onChange={theme.setPref}
          tabs={[{ value: 'auto', label: 'Авто' }, { value: 'dark', label: 'Тёмная' }, { value: 'light', label: 'Светлая' }]}
        />
      </section>

      <p className="pb-2 text-center text-[11.5px] text-muted">{config?.settings.shop_name ?? 'F1Z PRIME'} · Telegram Mini App</p>
    </div>
  )
}
