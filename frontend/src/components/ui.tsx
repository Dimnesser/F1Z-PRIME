import clsx from 'clsx'
import { motion, type HTMLMotionProps } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { haptic } from '../lib/telegram'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass'

export function Button({
  variant = 'primary', loading, className, children, onClick, disabled, size = 'lg', ...rest
}: HTMLMotionProps<'button'> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <motion.button
      whileTap={{ scale: disabled || loading ? 1 : 0.96 }}
      disabled={disabled || loading}
      onClick={(e) => {
        haptic.tap('light')
        onClick?.(e)
      }}
      className={clsx(
        'relative inline-flex select-none items-center justify-center gap-2 overflow-hidden font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'lg' && 'h-14 rounded-2xl px-6 text-[15px]',
        size === 'md' && 'h-11 rounded-xl px-4 text-sm',
        size === 'sm' && 'h-9 rounded-xl px-3 text-[13px]',
        variant === 'primary' && 'bg-brand text-white shadow-glow',
        variant === 'secondary' && 'bg-white text-bg',
        variant === 'ghost' && 'bg-white/[0.06] text-ink hover:bg-white/10',
        variant === 'glass' && 'glass text-ink',
        variant === 'danger' && 'bg-danger/15 text-danger',
        className,
      )}
      {...rest}
    >
      {variant === 'primary' && (
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-60" />
      )}
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (children as ReactNode)}
    </motion.button>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx('relative overflow-hidden rounded-2xl bg-white/[0.05]', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  )
}

const TONES = {
  violet: 'bg-primary/15 text-primary-soft ring-primary/25',
  cyan: 'bg-secondary/15 text-secondary-soft ring-secondary/25',
  green: 'bg-success/15 text-success ring-success/25',
  amber: 'bg-warning/15 text-warning ring-warning/25',
  red: 'bg-danger/15 text-danger ring-danger/25',
  gray: 'bg-white/[0.06] text-muted ring-white/10',
}

export function Badge({ tone = 'violet', children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1', TONES[tone], className)}>
      {children}
    </span>
  )
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-3 flex items-end justify-between px-1">
      <h2 className="font-display text-[17px] font-semibold tracking-tight">{title}</h2>
      {action && (
        <button onClick={onAction} className="text-[13px] font-semibold text-primary-soft pressable">
          {action}
        </button>
      )}
    </div>
  )
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card flex flex-col items-center px-6 py-10 text-center"
    >
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-brand-soft text-primary-soft ring-1 ring-white/10">
        {icon}
      </div>
      <div className="font-display text-base font-semibold">{title}</div>
      {text && <p className="mt-1.5 max-w-[260px] text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  )
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3 px-1 pt-2">
      <div>
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.05 } } },
  item: { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 30 } } },
}
