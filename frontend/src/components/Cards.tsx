import clsx from 'clsx'
import { ChevronRight, Gem, Package, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { money } from '../lib/format'
import { haptic } from '../lib/telegram'
import type { CountryCatalog, PremiumNumber, Product } from '../lib/types'
import { Flag } from './Flag'
import { Skeleton } from './ui'

/** SIM contact pad drawn in CSS (six contacts around a centre plate). */
function SimChip() {
  return (
    <span aria-hidden className="relative block h-[34px] w-[44px] overflow-hidden rounded-[8px] bg-[linear-gradient(135deg,#E9E6F7_0%,#B9B4D6_45%,#8C86B0_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_2px_6px_rgba(0,0,0,0.35)]">
      <span className="absolute inset-y-0 left-1/3 w-px bg-black/25" />
      <span className="absolute inset-y-0 left-2/3 w-px bg-black/25" />
      <span className="absolute inset-x-0 top-1/2 h-px bg-black/25" />
      <span className="absolute left-1/3 top-[30%] h-[40%] w-1/3 rounded-[3px] border border-black/25 bg-snow/20" />
    </span>
  )
}

/**
 * The balance shown as the store's own SIM card — the one bold element of the app.
 * It stays dark in the light theme on purpose: it is an object, not a surface.
 */
export function BalanceCard({ balance, loading, holder, id, compact }: { balance?: number; loading?: boolean; holder?: string; id?: number; compact?: boolean }) {
  return (
    <section
      aria-label="Баланс"
      className="relative overflow-hidden text-[#F4F6FF]"
      style={{
        borderRadius: 26,
        // SIM notch: the top-right corner is cut
        clipPath: 'polygon(0 0, calc(100% - 46px) 0, 100% 46px, 100% 100%, 0 100%)',
        background:
          'radial-gradient(120% 90% at 100% 0%, rgba(117,107,255,0.55) 0%, rgba(117,107,255,0) 55%),' +
          'radial-gradient(80% 70% at 0% 100%, rgba(52,213,197,0.22) 0%, rgba(52,213,197,0) 60%),' +
          'repeating-linear-gradient(115deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 9px),' +
          'linear-gradient(160deg, #1A2140 0%, #10142A 55%, #0B0F1E 100%)',
        boxShadow: '0 24px 48px -28px rgba(46,38,160,0.75)',
      }}
    >
      <div className={clsx('relative flex flex-col', compact ? 'gap-5 p-5' : 'min-h-[208px] justify-between gap-6 p-5 pb-4')}>
        <div className="flex items-center justify-between pr-10">
          <SimChip />
          <span className="font-brand text-[12px] font-bold tracking-tight text-snow/80">F1Z PRIME</span>
        </div>
        <div>
          <div className="text-[13px] text-snow/60">Баланс</div>
          {loading ? (
            <Skeleton className="mt-2 h-11 w-44 !bg-snow/10" />
          ) : (
            <div className="num mt-1 truncate font-display text-[42px] font-semibold leading-none tracking-[-0.01em]">{money(balance ?? 0)}</div>
          )}
        </div>
        {!compact && (
          <div className="flex items-end justify-between gap-3 text-snow/55">
            <span className="min-w-0 truncate text-[13px]">{holder}</span>
            {id !== undefined && <span className="num shrink-0 font-display text-[13px] tracking-[0.12em]">{String(id).replace(/(\d{3})(?=\d)/g, '$1 ')}</span>}
          </div>
        )}
      </div>
    </section>
  )
}

export function StockLabel({ stock }: { stock: number }) {
  if (stock <= 0) return <span className="whitespace-nowrap text-[12.5px] text-danger">нет в наличии</span>
  return <span className={clsx('whitespace-nowrap text-[12.5px]', stock <= 3 ? 'text-warning' : 'text-muted')}>{stock <= 3 ? `осталось ${stock}` : `${stock} шт.`}</span>
}

/** One country in a grouped list: the row opens the product; the price pill buys it straight away. */
export function CountryRow({ c, onBuy, onOpen }: { c: CountryCatalog; onBuy: () => void; onOpen: () => void }) {
  const inStock = c.stock > 0 && c.product_id !== null
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`${c.name}, подробнее`}>
        <Flag code={c.code} emoji={c.flag} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-medium">{c.name}</span>
          <span className="flex min-w-0 items-baseline gap-2 overflow-hidden">
            <span className="num font-display text-[12.5px] text-muted">{c.dial_code}</span>
            <StockLabel stock={inStock ? c.stock : 0} />
          </span>
        </span>
      </button>
      <button
        type="button"
        disabled={!inStock}
        aria-label={inStock ? `Купить ${c.name} за ${money(c.price)}` : `${c.name}: нет в наличии`}
        onClick={() => { haptic.tap('light'); onBuy() }}
        className="num pressable h-9 min-w-[86px] shrink-0 rounded-full bg-primary/15 px-3.5 text-[14px] font-semibold text-primary-soft disabled:bg-ov/[0.05] disabled:text-muted"
      >
        {money(c.price)}
      </button>
    </div>
  )
}

/** Compact country tile for the horizontal rail on Home. */
export function CountryTile({ c, onOpen }: { c: CountryCatalog; onOpen: () => void }) {
  const inStock = c.stock > 0
  return (
    <button type="button" onClick={() => { haptic.select(); onOpen() }} className={clsx('card pressable flex w-[120px] shrink-0 snap-start flex-col items-start p-3.5 text-left', !inStock && 'opacity-55')}>
      <Flag code={c.code} emoji={c.flag} size={36} />
      <span className="mt-3 w-full truncate text-[14px] font-medium">{c.name}</span>
      <span className="num mt-0.5 text-[15px] font-semibold">{money(c.price)}</span>
    </button>
  )
}

/** Grid tile for digital goods (non-number categories). */
export function ProductCard({ p, onOpen, className }: { p: Product; onOpen: () => void; className?: string }) {
  return (
    <button type="button" onClick={() => { haptic.select(); onOpen() }} className={clsx('card pressable flex min-w-0 flex-col p-4 text-left', className)}>
      <div className="flex items-start justify-between gap-2">
        {p.country ? <Flag code={p.country.code} emoji={p.country.flag} size={36} /> : (
          <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/12 text-primary-soft"><Package className="h-[18px] w-[18px]" /></span>
        )}
        {p.instant && p.stock > 0 && (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-success" title="Выдаётся автоматически сразу после оплаты">
            <Zap className="h-3.5 w-3.5" /> сразу
          </span>
        )}
      </div>
      <div className="mt-3 line-clamp-2 min-h-[40px] text-[14.5px] font-medium leading-[1.35]">{p.country?.name ?? p.title}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="num text-[16px] font-semibold">{money(p.price)}</span>
        {p.old_price ? <s className="num text-[12px] text-muted">{money(p.old_price)}</s> : null}
      </div>
      <StockLabel stock={p.stock} />
    </button>
  )
}

const TIER_ACCENT: Record<string, string> = {
  premium: '#A49DFF',
  gold: '#F5C76B',
  platinum: '#D9DEEA',
  vip: '#F08BD8',
}

/** Premium number: the digits are the product, so they get the display face and the space. */
export function PremiumCard({ n, onOpen, wide = false }: { n: PremiumNumber; onOpen: () => void; wide?: boolean }) {
  const accent = TIER_ACCENT[n.tier] ?? TIER_ACCENT.premium
  return (
    <button
      type="button"
      onClick={() => { haptic.select(); onOpen() }}
      className={clsx('card pressable relative shrink-0 snap-start overflow-hidden p-4 text-left', wide ? 'w-full' : 'w-[260px]')}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: accent }}>
          <Gem className="h-3.5 w-3.5" /> {n.tier === 'premium' ? 'Premium' : n.tier.charAt(0).toUpperCase() + n.tier.slice(1)}
        </span>
        <Flag code={n.country?.code} emoji={n.country?.flag} size={24} />
      </div>
      <div className={clsx('num mt-4 whitespace-nowrap font-display font-semibold tracking-[0.06em]', wide ? 'text-[26px]' : 'text-[21px]')}>{n.display_mask}</div>
      <div className="mt-4 flex items-center justify-between">
        <span className="num text-[16px] font-semibold">{money(n.price)}</span>
        <ChevronRight className="h-4 w-4 text-muted" />
      </div>
    </button>
  )
}

/** Inset group with an optional caption under it (Telegram settings style). */
export function Group({ title, action, footer, children, className }: { title?: ReactNode; action?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          {title && <h2 className="text-[19px] font-semibold tracking-[-0.01em]">{title}</h2>}
          {action}
        </div>
      )}
      <div className="card hairline overflow-hidden">{children}</div>
      {footer && <p className="mt-2 px-4 text-[12.5px] leading-snug text-muted">{footer}</p>}
    </section>
  )
}
