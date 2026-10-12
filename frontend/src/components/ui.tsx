import clsx from 'clsx'
import { AlertTriangle, ChevronRight, Loader2, RotateCw, Search, X } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { haptic } from '../lib/telegram'

// ------------------------------------------------------------------ buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'success'
type Size = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'primary', size = 'lg', loading, className, children, onClick, disabled, type = 'button', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(e) => {
        haptic.tap('light')
        onClick?.(e)
      }}
      className={clsx(
        'pressable relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold disabled:cursor-not-allowed disabled:opacity-45',
        size === 'lg' && 'h-[52px] rounded-2xl px-6 text-[15px]',
        size === 'md' && 'h-11 rounded-[14px] px-4 text-[14px]',
        size === 'sm' && 'h-9 rounded-xl px-3 text-[13px]',
        variant === 'primary' && 'bg-primary text-primary-ink shadow-glow hover:brightness-110',
        variant === 'secondary' && 'bg-ink text-bg hover:opacity-90',
        variant === 'ghost' && 'bg-ov/[0.06] text-ink hover:bg-ov/10',
        variant === 'outline' && 'border border-line bg-transparent text-ink hover:bg-ov/[0.04]',
        variant === 'danger' && 'bg-danger/12 text-danger hover:bg-danger/20',
        variant === 'success' && 'bg-success/12 text-success hover:bg-success/20',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Загрузка" /> : children}
    </button>
  )
}

export function IconButton({
  label, className, children, onClick, variant = 'ghost', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: 'ghost' | 'plain' | 'primary' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        haptic.select()
        onClick?.(e)
      }}
      className={clsx(
        'pressable grid h-11 w-11 shrink-0 place-items-center rounded-[14px] disabled:opacity-40',
        variant === 'ghost' && 'bg-ov/[0.06] text-ink hover:bg-ov/10',
        variant === 'plain' && 'text-muted hover:text-ink',
        variant === 'primary' && 'bg-primary text-primary-ink shadow-glow',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

// -------------------------------------------------------------------- cards

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('card', className)} {...rest}>{children}</div>
}

/** Row inside a list card: icon · title/subtitle · trailing content, optionally clickable. */
export function ListRow({
  icon, title, subtitle, trailing, onClick, chevron = Boolean(onClick), className,
}: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; onClick?: () => void; chevron?: boolean; className?: string }) {
  const body = (
    <>
      {icon && <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ov/[0.05] text-primary-soft">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[12.5px] text-muted">{subtitle}</div>}
      </div>
      {trailing}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-muted" />}
    </>
  )
  const cls = clsx('flex w-full items-center gap-3 px-4 py-3.5 text-left', className)
  return onClick ? (
    <button type="button" onClick={() => { haptic.select(); onClick() }} className={clsx(cls, 'pressable active:bg-ov/[0.03]')}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function StatCard({ icon, label, value, hint, tone = 'primary' }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone?: 'primary' | 'accent' | 'success' | 'warning' }) {
  const tint = { primary: 'text-primary-soft bg-primary/12', accent: 'text-accent bg-accent/12', success: 'text-success bg-success/12', warning: 'text-warning bg-warning/12' }[tone]
  return (
    <div className="card min-w-0 p-3.5">
      <div className={clsx('grid h-8 w-8 place-items-center rounded-[10px]', tint)}>{icon}</div>
      <div className="mt-3 text-[11.5px] font-medium text-muted">{label}</div>
      <div className="num mt-0.5 truncate text-[15px] font-bold leading-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted">{hint}</div>}
    </div>
  )
}

// ------------------------------------------------------------------- badges

const TONES = {
  violet: 'bg-primary/12 text-primary-soft',
  cyan: 'bg-accent/12 text-accent',
  green: 'bg-success/12 text-success',
  amber: 'bg-warning/12 text-warning',
  red: 'bg-danger/12 text-danger',
  gray: 'bg-ov/[0.07] text-muted',
}
export type Tone = keyof typeof TONES

export function Badge({ tone = 'violet', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/** Small colored dot + label; `live` pulses for in-progress states. */
export function StatusIndicator({ tone, label, live }: { tone: Tone; label: ReactNode; live?: boolean }) {
  const color = { violet: 'bg-primary', cyan: 'bg-accent', green: 'bg-success', amber: 'bg-warning', red: 'bg-danger', gray: 'bg-muted' }[tone]
  const text = { violet: 'text-primary-soft', cyan: 'text-accent', green: 'text-success', amber: 'text-warning', red: 'text-danger', gray: 'text-muted' }[tone]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-[12px] font-semibold', text)} role="status">
      <span className={clsx('h-2 w-2 rounded-full', color, live && 'live-dot')} />
      {label}
    </span>
  )
}

// ------------------------------------------------------------------ layout

export function SectionHeader({ title, action, onAction, className }: { title: ReactNode; action?: string; onAction?: () => void; className?: string }) {
  return (
    <div className={clsx('mb-3 flex items-center justify-between gap-3 px-0.5', className)}>
      <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
      {action && (
        <button type="button" onClick={onAction} className="pressable -mr-2 flex h-9 items-center gap-0.5 rounded-lg px-2 text-[13px] font-semibold text-primary-soft">
          {action} <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export function PageTitle({ title, subtitle, right, eyebrow }: { title: string; subtitle?: ReactNode; right?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3 px-0.5 pt-1">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-[26px] font-bold leading-[1.15] tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[13.5px] leading-snug text-muted">{subtitle}</p>}
      </div>
      {right}
    </header>
  )
}

// ------------------------------------------------------------------ inputs

export function SearchInput({ value, onChange, placeholder = 'Поиск', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={clsx('relative', className)} role="search">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted" />
      <input
        className="input pl-11 pr-11"
        type="search"
        enterKeyHint="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" aria-label="Очистить" onClick={() => onChange('')} className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl text-muted hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/** Horizontally scrolling filter chips. */
export function Chips<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string
}) {
  return (
    <div className={clsx('no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4', className)} role="toolbar">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => { haptic.select(); onChange(o.value) }}
          className="chip pressable"
        >
          {o.label}
          {o.count !== undefined && <span className="num text-[11.5px] opacity-60">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Segmented control (2–4 equal tabs). */
export function Tabs<T extends string>({ value, onChange, tabs, className }: {
  value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; className?: string
}) {
  const idx = Math.max(0, tabs.findIndex((t) => t.value === value))
  return (
    <div role="tablist" className={clsx('relative grid rounded-2xl bg-ov/[0.05] p-1 ring-1 ring-inset ring-line/60', className)} style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="absolute bottom-1 top-1 rounded-xl bg-surface shadow-card ring-1 ring-line/70 transition-transform duration-300 ease-out"
        style={{ left: 4, width: `calc((100% - 8px) / ${tabs.length})`, transform: `translateX(${idx * 100}%)` }}
      />
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => { haptic.select(); onChange(t.value) }}
          className={clsx('relative z-[1] flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-[13px] font-semibold transition-colors', value === t.value ? 'text-ink' : 'text-muted')}
        >
          <span className="truncate">{t.label}</span>
          {!!t.count && <span className="num rounded-full bg-primary/15 px-1.5 text-[10.5px] font-bold text-primary-soft">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Stepper({ value, min = 1, max, onChange }: { value: number; min?: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-ov/[0.05] p-1 ring-1 ring-inset ring-line/60">
      <button type="button" aria-label="Меньше" className="pressable grid h-10 w-10 place-items-center rounded-xl text-lg font-semibold disabled:opacity-35" disabled={value <= min} onClick={() => { haptic.select(); onChange(value - 1) }}>−</button>
      <span className="num w-8 text-center text-[17px] font-bold" aria-live="polite">{value}</span>
      <button type="button" aria-label="Больше" className="pressable grid h-10 w-10 place-items-center rounded-xl text-lg font-semibold disabled:opacity-35" disabled={value >= max} onClick={() => { haptic.select(); onChange(value + 1) }}>+</button>
    </div>
  )
}

// ----------------------------------------------------------------- feedback

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={clsx('relative overflow-hidden rounded-2xl bg-ov/[0.055]', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-ov/[0.06] to-transparent" />
    </div>
  )
}

export function EmptyState({ icon, title, text, action, compact }: { icon: ReactNode; title: string; text?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={clsx('fade-in card flex flex-col items-center text-center', compact ? 'px-5 py-7' : 'px-6 py-10')}>
      <div className="relative mb-4 grid h-14 w-14 place-items-center rounded-[18px] bg-brand-soft text-primary-soft ring-1 ring-inset ring-primary/20">
        {icon}
      </div>
      <div className="text-[16px] font-bold">{title}</div>
      {text && <p className="mt-1.5 max-w-[270px] text-[13.5px] leading-snug text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Не удалось загрузить', text, onRetry }: { title?: string; text?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="fade-in card flex flex-col items-center px-6 py-8 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-danger/12 text-danger"><AlertTriangle className="h-6 w-6" /></div>
      <div className="text-[15px] font-bold">{title}</div>
      {text && <p className="mt-1 max-w-[270px] text-[13px] text-muted">{text}</p>}
      {onRetry && (
        <Button size="sm" variant="ghost" className="mt-4" onClick={onRetry}><RotateCw className="h-4 w-4" /> Повторить</Button>
      )}
    </div>
  )
}

/** Key–value line used in summaries (order details, receipts). */
export function KV({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
      <span className="text-muted">{k}</span>
      <span className={clsx('min-w-0 truncate text-right', strong ? 'font-bold' : 'font-semibold')}>{v}</span>
    </div>
  )
}
