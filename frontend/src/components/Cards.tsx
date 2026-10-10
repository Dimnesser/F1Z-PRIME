import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ChevronRight, Gem, Package } from 'lucide-react'
import { money } from '../lib/format'
import type { CountryCatalog, PremiumNumber, Product } from '../lib/types'

export function CountryCard({ c, onBuy, onOpen }: { c: CountryCatalog; onBuy: () => void; onOpen: () => void }) {
  const inStock = c.stock > 0 && c.product_id !== null
  return (
    <motion.div className="card group relative overflow-hidden p-4" onClick={onOpen}>
      <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.22),transparent)]" />
      <div className="flex items-center gap-3.5">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/[0.05] text-[32px] ring-1 ring-white/10">
          {c.flag}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[16px] font-bold">{c.name}</span>
            <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted">{c.dial_code}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
            <Package className="h-3.5 w-3.5" />
            {inStock ? (
              <span>
                В наличии: <span className="font-semibold text-success">{c.stock}</span>
              </span>
            ) : (
              <span className="text-danger/90">Нет в наличии</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="font-display text-[17px] font-bold">{money(c.price)}</div>
          <button
            disabled={!inStock}
            onClick={(e) => {
              e.stopPropagation()
              onBuy()
            }}
            className={clsx(
              'pressable rounded-xl px-3.5 py-1.5 text-[12.5px] font-bold',
              inStock ? 'bg-brand text-white shadow-glow' : 'bg-white/[0.06] text-muted',
            )}
          >
            Купить
          </button>
        </div>
      </div>
    </motion.div>
  )
}

const TIER_STYLE: Record<string, string> = {
  premium: 'from-primary/40 via-primary/10 to-secondary/30',
  gold: 'from-amber-400/50 via-amber-200/10 to-orange-500/30',
  platinum: 'from-slate-200/50 via-white/10 to-secondary/40',
  vip: 'from-fuchsia-500/50 via-primary/10 to-rose-400/40',
}

export function PremiumCard({ n, onOpen, wide = false }: { n: PremiumNumber; onOpen: () => void; wide?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onOpen}
      className={clsx('relative shrink-0 overflow-hidden rounded-3xl bg-gradient-to-br p-[1.5px] text-left', TIER_STYLE[n.tier] ?? TIER_STYLE.premium, wide ? 'w-full' : 'w-[250px]')}
    >
      <div className="relative h-full rounded-[22px] bg-card/95 p-4">
        <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.44),transparent)]" />
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ink/90">
            <Gem className="h-3 w-3 text-primary-soft" /> {n.tier === 'premium' ? 'premium number' : n.tier}
          </span>
          <span className="text-2xl">{n.country?.flag ?? '🌐'}</span>
        </div>
        <div className={clsx('mt-4 whitespace-nowrap font-mono font-bold text-ink', wide ? 'text-[22px] tracking-wider' : 'text-[17px] tracking-wide')}>{n.display_mask}</div>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <div className="text-[11px] font-semibold text-muted">Цена</div>
            <div className="font-display text-lg font-bold text-gradient">{money(n.price)}</div>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-white/[0.07] px-3 py-1.5 text-[12px] font-bold">
            Подробнее <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" /> В наличии
        </div>
      </div>
    </motion.button>
  )
}

export function ProductMini({ p, onOpen }: { p: Product; onOpen: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onOpen}
      className="card relative w-[156px] shrink-0 overflow-hidden p-3.5 text-left"
    >
      <div className="pointer-events-none absolute -left-6 -top-6 h-20 w-20 rounded-full bg-[radial-gradient(closest-side,rgba(34,211,238,0.22),transparent)]" />
      <div className="text-[34px] leading-none">{p.country?.flag ?? '📦'}</div>
      <div className="mt-3 line-clamp-1 text-[14px] font-bold">{p.country?.name ?? p.title}</div>
      <div className="text-[11.5px] text-muted">{p.country?.dial_code ?? p.category}</div>
      <div className="mt-3 flex items-center justify-between">
        <span className="font-display text-[15px] font-bold">{money(p.price)}</span>
        <span className={clsx('text-[11px] font-bold', p.stock > 0 ? 'text-success' : 'text-danger')}>{p.stock > 0 ? `${p.stock} шт` : 'нет'}</span>
      </div>
    </motion.button>
  )
}
