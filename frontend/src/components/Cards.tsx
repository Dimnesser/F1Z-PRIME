import clsx from 'clsx'
import { ArrowUpRight, Gem, Package, Plus, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { money, stars, usd } from '../lib/format'
import { haptic } from '../lib/telegram'
import type { CountryCatalog, PremiumNumber, Product } from '../lib/types'
import { Skeleton } from './ui'

/** Current balance with the top-up action — used on Home and the Balance screen. */
export function BalanceCard({ balance, loading, onTopup, footer }: { balance?: number; loading?: boolean; onTopup: () => void; footer?: ReactNode }) {
  return (
    <section aria-label="Баланс" className="relative overflow-hidden rounded-[24px] border border-primary/25 bg-[linear-gradient(140deg,rgb(var(--primary)/0.22)_0%,rgb(var(--surface))_48%,rgb(var(--accent)/0.10)_120%)] p-5 shadow-card">
      <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(closest-side,rgb(var(--primary)/0.35),transparent)]" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">Баланс</div>
          {loading ? (
            <Skeleton className="mt-2 h-9 w-36" />
          ) : (
            <div className="num mt-1 truncate text-[34px] font-bold leading-none tracking-[-0.03em]">{money(balance ?? 0)}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => { haptic.tap('medium'); onTopup() }}
          className="pressable flex h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-primary px-4 text-[14px] font-semibold text-primary-ink shadow-glow"
        >
          <Plus className="h-4 w-4" strokeWidth={2.6} /> Пополнить
        </button>
      </div>
      {footer && <div className="relative mt-4">{footer}</div>}
    </section>
  )
}

function Flag({ children, size = 'md' }: { children: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={clsx(
      'grid shrink-0 place-items-center rounded-2xl bg-ov/[0.05] ring-1 ring-inset ring-line/70',
      size === 'sm' && 'h-10 w-10 text-[22px]', size === 'md' && 'h-12 w-12 text-[28px]', size === 'lg' && 'h-14 w-14 text-[32px]',
    )}>
      {children}
    </div>
  )
}

export function StockLabel({ stock }: { stock: number }) {
  if (stock <= 0) return <span className="text-[12px] font-semibold text-danger">Нет в наличии</span>
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-[12px] font-semibold', stock <= 3 ? 'text-warning' : 'text-success')}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {stock <= 3 ? `Осталось ${stock}` : `${stock} шт`}
    </span>
  )
}

/** Country number in the catalog list. The whole row opens the product; «Купить» goes straight to checkout. */
export function CountryCard({ c, onBuy, onOpen }: { c: CountryCatalog; onBuy: () => void; onOpen: () => void }) {
  const inStock = c.stock > 0 && c.product_id !== null
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`${c.name}, подробнее`}>
        <Flag size="sm">{c.flag}</Flag>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] font-semibold leading-tight">{c.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="num font-mono text-[11.5px] text-muted">{c.dial_code}</span>
            <StockLabel stock={inStock ? c.stock : 0} />
          </div>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="num text-[16px] font-bold leading-none">{money(c.price)}</div>
        {(c.price_usd || (c.price_stars && c.stars_enabled)) && (
          <div className="num whitespace-nowrap text-[11px] text-muted">
            {usd(c.price_usd)}{c.price_usd && c.price_stars && c.stars_enabled ? ' · ' : ''}{c.stars_enabled ? stars(c.price_stars) : ''}
          </div>
        )}
        <button
          type="button"
          disabled={!inStock}
          onClick={() => { haptic.tap('light'); onBuy() }}
          className={clsx('pressable h-8 rounded-[10px] px-3.5 text-[12.5px] font-semibold disabled:cursor-not-allowed',
            inStock ? 'bg-primary text-primary-ink' : 'bg-ov/[0.06] text-muted')}
        >
          Купить
        </button>
      </div>
    </div>
  )
}

/** Grid tile for a product (popular goods, digital categories). */
export function ProductCard({ p, onOpen, className }: { p: Product; onOpen: () => void; className?: string }) {
  return (
    <button type="button" onClick={() => { haptic.select(); onOpen() }} className={clsx('card pressable flex min-w-0 flex-col p-3.5 text-left', className)}>
      <div className="flex items-start justify-between gap-2">
        <Flag size="sm">{p.country?.flag ?? <Package className="h-5 w-5 text-primary-soft" />}</Flag>
        {p.instant && p.stock > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-success/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-success" title="Мгновенная выдача">
            <Zap className="h-3 w-3" /> авто
          </span>
        )}
      </div>
      <div className="mt-3 line-clamp-2 min-h-[38px] text-[14px] font-semibold leading-[1.35]">{p.country?.name ?? p.title}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-muted">{p.country?.dial_code ?? (p.attributes?.['Тип'] || 'Цифровой товар')}</div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <span className="num min-w-0 truncate text-[15px] font-bold">
          {money(p.price)}
          {p.old_price ? <s className="ml-1 text-[11px] font-medium text-muted">{money(p.old_price)}</s> : null}
        </span>
      </div>
      <div className="mt-1"><StockLabel stock={p.stock} /></div>
    </button>
  )
}

const TIER_RING: Record<string, string> = {
  premium: 'from-primary/60 via-primary/10 to-accent/40',
  gold: 'from-amber-300/70 via-amber-200/10 to-orange-400/40',
  platinum: 'from-slate-200/70 via-white/10 to-accent/40',
  vip: 'from-fuchsia-400/60 via-primary/10 to-rose-400/40',
}

export function PremiumCard({ n, onOpen, wide = false }: { n: PremiumNumber; onOpen: () => void; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => { haptic.select(); onOpen() }}
      className={clsx('pressable relative shrink-0 overflow-hidden rounded-[22px] bg-gradient-to-br p-px text-left', TIER_RING[n.tier] ?? TIER_RING.premium, wide ? 'w-full' : 'w-[248px]')}
    >
      <div className="relative h-full rounded-[21px] bg-surface p-4">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-14 h-32 w-32 rounded-full bg-[radial-gradient(closest-side,rgb(var(--primary)/0.28),transparent)]" />
        <div className="relative flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ov/[0.06] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink/90">
            <Gem className="h-3 w-3 text-primary-soft" /> {n.tier === 'premium' ? 'premium' : n.tier}
          </span>
          <span className="text-[22px] leading-none">{n.country?.flag ?? '🌐'}</span>
        </div>
        <div className={clsx('num relative mt-4 whitespace-nowrap font-mono font-bold', wide ? 'text-[22px] tracking-wider' : 'text-[17px] tracking-wide')}>{n.display_mask}</div>
        <div className="relative mt-4 flex items-end justify-between">
          <div>
            <div className="text-[11px] text-muted">Цена</div>
            <div className="num text-[18px] font-bold">{money(n.price)}</div>
          </div>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ov/[0.07]"><ArrowUpRight className="h-4 w-4" /></span>
        </div>
      </div>
    </button>
  )
}
