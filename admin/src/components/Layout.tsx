import clsx from 'clsx'
import {
  ArrowLeft, Bell, ChevronRight, Boxes, ChevronsLeft, Store, CreditCard, Gem, Globe2, Headphones, LayoutDashboard, LogOut, MoreHorizontal, Phone, Settings,
  ServerCog, ShieldCheck, ShoppingCart, Smartphone, Sparkles, TicketPercent, Users, Workflow, X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { hasPerm, useMe } from '../lib/session'
import { backToShop, inTelegram } from '../lib/telegram'
import type { Counters } from '../lib/types'

type BadgeKey = 'tickets' | 'review' | 'incidents' | 'approvals' | 'inbox'
type Group = 'main' | 'sales' | 'catalog' | 'service' | 'system'
export const GROUP_LABEL: Record<Group, string> = { main: 'Главное', sales: 'Продажи', catalog: 'Каталог', service: 'Клиенты', system: 'Управление' }
const GROUP_ORDER: Group[] = ['main', 'sales', 'catalog', 'service', 'system']
/** `perms`: any of them shows the item (the server enforces the same permissions on every request) */
export const NAV: { to: string; label: string; icon: typeof Users; perms?: string[]; badge?: BadgeKey; group: Group }[] = [
  { to: '/', label: 'Обзор', icon: LayoutDashboard, perms: ['analytics.view'], group: 'main' },
  { to: '/orders', label: 'Заказы', icon: ShoppingCart, perms: ['orders.view'], group: 'sales' },
  { to: '/users', label: 'Пользователи', icon: Users, perms: ['users.view'], group: 'sales' },
  { to: '/products', label: 'Товары', icon: Boxes, perms: ['products.view'], group: 'catalog' },
  { to: '/phones', label: 'База номеров', icon: Phone, perms: ['products.view'], group: 'catalog' },
  { to: '/sms', label: 'SMS-активации', icon: Smartphone, perms: ['orders.view'], group: 'catalog' },
  { to: '/promo', label: 'Промокоды', icon: TicketPercent, perms: ['promo.manage'], group: 'sales' },
  { to: '/premium', label: 'Красивые номера', icon: Gem, perms: ['products.edit'], group: 'catalog' },
  { to: '/countries', label: 'Страны', icon: Globe2, perms: ['products.edit'], group: 'catalog' },
  { to: '/finance', label: 'Финансы', icon: CreditCard, perms: ['payments.view', 'finance.view'], badge: 'review', group: 'sales' },
  { to: '/support', label: 'Поддержка', icon: Headphones, perms: ['support.view'], badge: 'tickets', group: 'service' },
  { to: '/automation', label: 'Автоматизация', icon: Workflow, perms: ['system.view'], badge: 'incidents', group: 'system' },
  { to: '/rules', label: 'Правила', icon: Sparkles, perms: ['system.view'], group: 'system' },
  { to: '/team', label: 'Команда', icon: ShieldCheck, perms: ['staff.manage', 'staff.roles', 'refunds.approve'], badge: 'approvals', group: 'system' },
  { to: '/system', label: 'Система', icon: ServerCog, perms: ['system.view'], group: 'system' },
  { to: '/inbox', label: 'Уведомления', icon: Bell, badge: 'inbox', group: 'service' },
  { to: '/settings', label: 'Настройки', icon: Settings, group: 'system' },
]
const MOBILE_MAIN = ['/', '/orders', '/products', '/support']
const COLLAPSE_KEY = 'f1z_admin_sidebar'

export function Layout({ children, onLogout, counters }: { children: ReactNode; onLogout: () => void; counters: Counters }) {
  const me = useMe()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })
  const [more, setMore] = useState(false)
  const items = NAV.filter((n) => !n.perms || hasPerm(me, ...n.perms))
  const mainMobile = items.filter((n) => MOBILE_MAIN.includes(n.to)).slice(0, 4)
  const rest = items.filter((n) => !mainMobile.includes(n))
  const current = items.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)))

  useEffect(() => {
    setMore(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* private mode */ }
      return !c
    })
  }
  const count = (b?: BadgeKey) => (b ? counters[b] ?? 0 : 0)

  return (
    <div className="flex min-h-screen">
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-xl focus:bg-card focus:px-3 focus:py-2">К содержимому</a>
      {/* desktop sidebar */}
      <aside aria-label="Разделы" className={clsx('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line/70 bg-sidebar transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-[248px]')}>
        <div className={clsx('flex h-16 items-center gap-3 px-5', collapsed && 'justify-center px-0')}>
          <img src="/admin/brand.jpg" alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-line" />
          {!collapsed && (
            <div className="min-w-0 leading-none">
              <div className="font-brand text-[14px] font-bold">F1Z <span className="text-primary-soft">PRIME</span></div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">control center</div>
            </div>
          )}
        </div>
        <nav className="no-scrollbar flex-1 overflow-y-auto px-3 pb-3">
          {GROUP_ORDER.map((g) => {
            const list = items.filter((n) => n.group === g)
            if (!list.length) return null
            return (
              <div key={g} className="mt-3 first:mt-1">
                {collapsed ? <div className="mx-auto my-2 h-px w-6 bg-line" /> : <div className="eyebrow px-3 pb-1.5 pt-2 text-[10.5px]">{GROUP_LABEL[g]}</div>}
                <div className="space-y-0.5">
                  {list.map(({ to, label, icon: Icon, badge }) => (
                    <NavLink key={to} to={to} end={to === '/'} title={collapsed ? label : undefined}
                      className={({ isActive }) => clsx('relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium transition',
                        collapsed && 'justify-center px-0', isActive ? 'bg-primary/[0.13] text-ink' : 'text-muted hover:bg-white/[0.04] hover:text-ink')}>
                      {({ isActive }) => (<>
                        {isActive && <span className="absolute left-0 top-2.5 h-5 w-[3px] rounded-r-full bg-primary" />}
                        <Icon className={clsx('h-[18px] w-[18px] shrink-0', isActive && 'text-primary-soft')} />
                        {!collapsed && <span className="flex-1 truncate">{label}</span>}
                        {count(badge) > 0 && (collapsed
                          ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-warning" />
                          : <span className="tabular rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning">{count(badge)}</span>)}
                      </>)}
                    </NavLink>
                  ))}
                </div>
              </div>
            )
          })}
        </nav>
        <div className="border-t border-line/70 p-3">
          <div className={clsx('flex gap-1', collapsed && 'flex-col items-center')}>
            {inTelegram ? (
              <button type="button" onClick={backToShop} title="В магазин" className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-muted hover:bg-white/[0.05] hover:text-ink">
                <Store className="h-4 w-4" />{!collapsed && 'В магазин'}
              </button>
            ) : (
              <button type="button" onClick={onLogout} title="Выйти" className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-muted hover:bg-danger/10 hover:text-danger">
                <LogOut className="h-4 w-4" />{!collapsed && 'Выйти'}
              </button>
            )}
            <button type="button" onClick={toggle} title={collapsed ? 'Развернуть' : 'Свернуть'} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-white/[0.05] hover:text-ink">
              <ChevronsLeft className={clsx('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {/* desktop top bar: breadcrumbs, notifications, account */}
        <header className="sticky top-0 z-30 hidden h-16 items-center justify-between gap-4 border-b border-line/70 bg-bg/80 px-8 backdrop-blur-xl lg:flex">
          <nav aria-label="Навигационная цепочка" className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="text-muted">F1Z PRIME</span>
            {current && <>
              <ChevronRight className="h-3.5 w-3.5 text-muted/60" />
              <span className="text-muted">{GROUP_LABEL[current.group]}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted/60" />
              <span className="truncate font-semibold text-ink" aria-current="page">{current.label}</span>
            </>}
          </nav>
          <div className="flex items-center gap-2">
            <NavLink to="/inbox" aria-label="Уведомления" className="relative grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-white/[0.05] hover:text-ink">
              <Bell className="h-[18px] w-[18px]" />
              {counters.inbox > 0 && <span className="tabular absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9.5px] font-bold text-white">{counters.inbox}</span>}
            </NavLink>
            <div className="flex items-center gap-2.5 rounded-xl border border-line/70 bg-card py-1.5 pl-1.5 pr-3">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/20 text-xs font-bold text-primary-soft">{me.username.slice(0, 1).toUpperCase()}</div>
              <div className="leading-tight">
                <div className="max-w-[140px] truncate text-[13px] font-semibold">{me.username}</div>
                <div className="text-[11px] text-muted">{me.role_label}</div>
              </div>
            </div>
          </div>
        </header>
        {/* mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line/70 bg-bg/85 px-4 backdrop-blur-xl lg:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            {inTelegram ? (
              <button type="button" onClick={backToShop} className="-ml-1 flex h-10 items-center gap-1.5 rounded-xl bg-white/[0.06] pl-2.5 pr-3.5 text-[13.5px] font-semibold active:scale-[0.97]">
                <ArrowLeft className="h-4 w-4" /> Магазин
              </button>
            ) : (
              <img src="/admin/brand.jpg" alt="" className="h-8 w-8 rounded-lg object-cover" />
            )}
            <span className="truncate text-[15px] font-semibold">{current?.label ?? 'Админ-панель'}</span>
          </div>
          <div className="flex items-center gap-2">
            <NavLink to="/inbox" aria-label="Уведомления" className="relative grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06]">
              <Bell className="h-[18px] w-[18px]" />
              {counters.inbox > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9.5px] font-bold text-white">{counters.inbox}</span>}
            </NavLink>
          </div>
        </header>
        <div id="content" className="mx-auto w-full max-w-[1440px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">{children}</div>
      </main>

      {/* mobile bottom navigation */}
      <nav aria-label="Основная навигация" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-sidebar/95 backdrop-blur-xl lg:hidden">
        <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${mainMobile.length + (rest.length ? 1 : 0)}, minmax(0, 1fr))` }}>
          {mainMobile.map(({ to, label, icon: Icon, badge }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => clsx('relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold', isActive ? 'text-ink' : 'text-muted')}>
              {({ isActive }) => (<>
                <span className={clsx('grid h-7 w-12 place-items-center rounded-full transition', isActive && 'bg-primary/15 text-primary-soft')}><Icon className="h-[20px] w-[20px]" /></span>
                <span className="max-w-full truncate px-1">{label}</span>
                {count(badge) > 0 && <span className="absolute right-[calc(50%-22px)] top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[9.5px] font-bold text-black">{count(badge)}</span>}
              </>)}
            </NavLink>
          ))}
          {rest.length > 0 && (
            <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className={clsx('flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold', rest.some((r) => location.pathname.startsWith(r.to)) ? 'text-ink' : 'text-muted')}>
              <span className={clsx('grid h-7 w-12 place-items-center rounded-full', rest.some((r) => location.pathname.startsWith(r.to)) && 'bg-primary/15 text-primary-soft')}><MoreHorizontal className="h-[20px] w-[20px]" /></span>Ещё
            </button>
          )}
        </div>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Все разделы">
          <div className="overlay-in absolute inset-0 bg-black/70" onClick={() => setMore(false)} />
          <div className="pop-in pb-safe absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-card p-4">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold">{me.username}</div>
                <div className="text-xs text-muted">{me.role_label}</div>
              </div>
              <button type="button" aria-label="Закрыть" onClick={() => setMore(false)} className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06]"><X className="h-5 w-5" /></button>
            </div>
            {GROUP_ORDER.map((g) => {
              const list = rest.filter((n) => n.group === g)
              if (!list.length) return null
              return (
                <div key={g} className="mb-3">
                  <div className="eyebrow mb-2 px-1">{GROUP_LABEL[g]}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {list.map(({ to, label, icon: Icon, badge }) => (
                      <NavLink key={to} to={to} className={({ isActive }) => clsx('relative flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-2xl p-2.5 text-center text-[12px] font-semibold', isActive ? 'bg-primary/15 text-ink' : 'bg-white/[0.04] text-muted')}>
                        <Icon className="h-[22px] w-[22px]" />{label}
                        {count(badge) > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-warning" />}
                      </NavLink>
                    ))}
                  </div>
                </div>
              )
            })}
            {inTelegram ? (
              <button type="button" onClick={backToShop} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-secondary/10 text-[13px] font-semibold text-secondary">
                <Store className="h-5 w-5" />В магазин
              </button>
            ) : (
              <button type="button" onClick={onLogout} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-danger/10 text-[13px] font-semibold text-danger">
                <LogOut className="h-5 w-5" />Выйти
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
