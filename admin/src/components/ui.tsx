import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

export function Btn({ variant = 'primary', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'success'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand text-white shadow-glow hover:brightness-110',
        variant === 'ghost' && 'bg-white/[0.06] text-ink hover:bg-white/10',
        variant === 'danger' && 'bg-danger/15 text-danger hover:bg-danger/25',
        variant === 'success' && 'bg-success/15 text-success hover:bg-success/25',
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
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
export type Tone = keyof typeof TONES

export function Badge({ tone = 'violet', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1', TONES[tone])}>{children}</span>
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className={clsx('relative max-h-[90vh] w-full overflow-y-auto rounded-3xl border border-white/10 bg-surface p-6 shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')}
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{title}</h3>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.06] text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={clsx('block', className)}><span className="label">{label}</span>{children}</label>
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx('relative overflow-hidden rounded-xl bg-white/[0.05]', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  )
}

export function Table({ head, children, loading, empty }: { head: ReactNode[]; children: ReactNode; loading?: boolean; empty?: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-white/[0.06] bg-white/[0.02]"><tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-white/[0.05]">{!loading && children}</tbody>
        </table>
      </div>
      {loading && <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
      {!loading && empty && <div className="p-10 text-center text-sm text-muted">Нет данных</div>}
    </div>
  )
}

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted">
      <span>Всего: {total}</span>
      <div className="flex items-center gap-2">
        <Btn variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>←</Btn>
        <span>{page} / {pages}</span>
        <Btn variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>→</Btn>
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={clsx('relative h-6 w-11 rounded-full transition', checked ? 'bg-primary' : 'bg-white/10')}>
      <motion.span layout className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

type ToastKind = 'success' | 'error'
const ToastCtx = createContext<(t: string, k?: ToastKind) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; text: string; kind: ToastKind }[]>([])
  const push = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random()
    setItems((s) => [...s.slice(-3), { id, text, kind }])
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
              className="glass flex items-center gap-2.5 rounded-2xl bg-surface/90 px-4 py-3 text-sm font-medium shadow-2xl">
              {t.kind === 'success' ? <CheckCircle2 className="h-5 w-5 text-success" /> : <AlertTriangle className="h-5 w-5 text-danger" />}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Ожидает оплаты', tone: 'amber' },
  paid: { label: 'Оплачен', tone: 'cyan' },
  processing: { label: 'В обработке', tone: 'violet' },
  completed: { label: 'Выполнен', tone: 'green' },
  cancelled: { label: 'Отменён', tone: 'gray' },
  expired: { label: 'Истёк', tone: 'gray' },
  refunded: { label: 'Возврат', tone: 'red' },
}
export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Ожидает', tone: 'gray' },
  awaiting_confirmation: { label: 'На проверке', tone: 'amber' },
  confirmed: { label: 'Подтверждён', tone: 'green' },
  rejected: { label: 'Отклонён', tone: 'red' },
  cancelled: { label: 'Отменён', tone: 'gray' },
}
export const METHOD: Record<string, string> = { balance: 'Баланс', stars: '⭐ Stars', manual: 'Перевод', test: '🧪 Тест' }

export function UserCell({ u }: { u: { first_name: string | null; username: string | null; telegram_id: number } }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold ring-1 ring-white/10">{(u.first_name || u.username || '?').slice(0, 1).toUpperCase()}</div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">{u.first_name || '—'}</div>
        <div className="text-[11.5px] text-muted">{u.username ? `@${u.username}` : u.telegram_id}</div>
      </div>
    </div>
  )
}
