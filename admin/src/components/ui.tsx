import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Info, Loader2, Search, X } from 'lucide-react'
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from 'react'

// ------------------------------------------------------------------ buttons

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
export function Btn({
  variant = 'primary', size = 'md', loading, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-[15px]',
        variant === 'primary' && 'bg-primary text-white shadow-glow hover:bg-primary-deep',
        variant === 'secondary' && 'bg-white/[0.07] text-ink hover:bg-white/[0.11]',
        variant === 'ghost' && 'text-muted hover:bg-white/[0.06] hover:text-ink',
        variant === 'outline' && 'border border-white/[0.1] text-ink hover:bg-white/[0.05]',
        variant === 'danger' && 'bg-danger/15 text-danger hover:bg-danger/25',
        variant === 'success' && 'bg-success/15 text-success hover:bg-success/25',
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function IconBtn({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-white/[0.06] hover:text-ink disabled:opacity-40', className)}
    >
      {children}
    </button>
  )
}

// ------------------------------------------------------------------- badges

const TONES = {
  violet: 'bg-primary/15 text-primary-soft',
  cyan: 'bg-secondary/15 text-secondary-soft',
  green: 'bg-success/15 text-success',
  amber: 'bg-warning/15 text-warning',
  red: 'bg-danger/15 text-danger',
  gray: 'bg-white/[0.07] text-muted',
}
export type Tone = keyof typeof TONES

export function Badge({ tone = 'violet', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-bold', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Ожидает оплаты', tone: 'amber' },
  awaiting_payment: { label: 'Платёж на проверке', tone: 'amber' },
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
export const TX_TYPE: Record<string, { label: string; tone: Tone }> = {
  topup: { label: 'Пополнение', tone: 'green' },
  purchase: { label: 'Покупка', tone: 'violet' },
  refund: { label: 'Возврат', tone: 'cyan' },
  admin_adjust: { label: 'Корректировка', tone: 'amber' },
}

export function OrderBadge({ status, inReview }: { status: string; inReview?: boolean }) {
  const s = inReview && status === 'pending' ? ORDER_STATUS.awaiting_payment : ORDER_STATUS[status] ?? { label: status, tone: 'gray' as Tone }
  return <Badge tone={s.tone} dot>{s.label}</Badge>
}

// ------------------------------------------------------------------- layout

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{children}</div>}
    </div>
  )
}

export function Card({ title, action, children, className, pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx('card min-w-0', pad && 'p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className={clsx('mb-4 flex items-center justify-between gap-3', !pad && 'px-4 pt-4 sm:px-5 sm:pt-5')}>
          {title && <h2 className="font-display text-[15px] font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block min-w-0', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx('relative overflow-hidden rounded-xl bg-white/[0.05]', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  )
}

export function Empty({ icon: Icon = Inbox, title = 'Нет данных', text, action }: { icon?: typeof Inbox; title?: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.05] text-muted"><Icon className="h-5 w-5" /></div>
      <div className="mt-3 text-sm font-semibold">{title}</div>
      {text && <div className="mt-1 max-w-xs text-sm text-muted">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> {text}</span>
      {onRetry && <Btn size="sm" variant="danger" onClick={onRetry}>Повторить</Btn>}
    </div>
  )
}

// ------------------------------------------------------------------- inputs

export function SearchInput({ value, onChange, placeholder = 'Поиск', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={clsx('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input className="input pl-10 pr-9" type="search" enterKeyHint="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" aria-label="Очистить" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-ink" onClick={() => onChange('')}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export function Chips<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={clsx('no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={clsx('chip', value === o.value && 'chip-active')}>
          {o.label}
          {o.count !== undefined && <span className="tabular text-[11px] text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; icon?: typeof Inbox }[] }) {
  return (
    <div className="no-scrollbar -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-white/[0.06] px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={clsx('-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition',
            value === t.value ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.icon && <t.icon className="h-4 w-4" />}{t.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-primary' : 'bg-white/[0.12]')}
    >
      <span className={clsx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200', checked ? 'left-6' : 'left-1')} />
    </button>
  )
}

// ------------------------------------------------------------------- modal

const modalStack: object[] = []

export function Modal({
  open, onClose, title, subtitle, children, footer, size = 'md',
}: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const token = {}
    modalStack.push(token)
    const onKey = (e: KeyboardEvent) => {
      // nested dialogs: Escape closes only the top-most one
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === token) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      modalStack.splice(modalStack.indexOf(token), 1)
      if (modalStack.length === 0) document.body.style.overflow = ''
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="overlay-in absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'pop-in relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-surface shadow-pop sm:max-h-[88vh] sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-sm', size === 'md' && 'sm:max-w-lg', size === 'lg' && 'sm:max-w-2xl', size === 'xl' && 'sm:max-w-4xl',
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" />
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-3 sm:pt-5">
          <div className="min-w-0">
            <h3 className="font-display text-[17px] font-semibold leading-snug">{title}</h3>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          <IconBtn label="Закрыть" className="-mr-2 -mt-1 h-9 w-9" onClick={onClose}><X className="h-5 w-5" /></IconBtn>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && <div className="pb-safe shrink-0 border-t border-white/[0.06] bg-surface px-5 py-3"><div className="flex flex-wrap justify-end gap-2">{footer}</div></div>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ confirm

interface ConfirmOptions {
  title: string
  text?: ReactNode
  confirmLabel?: string
  danger?: boolean
  /** ask for a free-text value (e.g. a reason); resolves to the text */
  input?: { label: string; placeholder?: string; required?: boolean; multiline?: boolean }
}
type ConfirmFn = (o: ConfirmOptions) => Promise<string | false>
const ConfirmCtx = createContext<ConfirmFn>(async () => false)
/** `await confirm({...})` → false when cancelled, otherwise the entered text ('' if no input). */
export const useConfirm = () => useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: string | false) => void }) | null>(null)
  const [text, setText] = useState('')
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => {
    setText('')
    setState({ ...o, resolve })
  }), [])
  const close = (v: string | false) => {
    state?.resolve(v)
    setState(null)
  }
  const blocked = Boolean(state?.input?.required && !text.trim())
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={state !== null}
        onClose={() => close(false)}
        size="sm"
        title={<span className="flex items-center gap-2">{state?.danger && <AlertTriangle className="h-5 w-5 text-danger" />}{state?.title}</span>}
        footer={<>
          <Btn variant="secondary" onClick={() => close(false)}>Отмена</Btn>
          <Btn variant={state?.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(text.trim())}>{state?.confirmLabel ?? 'Подтвердить'}</Btn>
        </>}
      >
        {state?.text && <div className="text-sm leading-relaxed text-muted">{state.text}</div>}
        {state?.input && (
          <Field label={state.input.label} className="mt-4">
            {state.input.multiline
              ? <textarea className="input min-h-[90px]" autoFocus value={text} placeholder={state.input.placeholder} onChange={(e) => setText(e.target.value)} />
              : <input className="input" autoFocus value={text} placeholder={state.input.placeholder} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) close(text.trim()) }} />}
          </Field>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  )
}

// ------------------------------------------------------------------- toasts

type ToastKind = 'success' | 'error' | 'info'
const ToastCtx = createContext<(t: string, k?: ToastKind) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; text: string; kind: ToastKind }[]>([])
  const nextId = useRef(1)
  const push = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = nextId.current++
    setItems((s) => [...s.slice(-2), { id, text, kind }])
    window.setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[100] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:left-auto lg:right-6 lg:items-end">
        {items.map((t) => (
          <div key={t.id} role="status" className="toast-in pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-2xl border border-white/10 bg-elevated px-4 py-3 text-sm font-medium shadow-pop">
            {t.kind === 'success' && <CheckCircle2 className="mt-px h-[18px] w-[18px] shrink-0 text-success" />}
            {t.kind === 'error' && <AlertTriangle className="mt-px h-[18px] w-[18px] shrink-0 text-danger" />}
            {t.kind === 'info' && <Info className="mt-px h-[18px] w-[18px] shrink-0 text-secondary" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ------------------------------------------------------------- data tables

export interface Column<T> {
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
  align?: 'right'
}

/** Table on wide screens, stacked cards on phones (no horizontal page scroll). */
export function DataTable<T>({
  rows, columns, card, rowKey, onRowClick, loading, emptyText = 'Ничего не найдено', selected, onToggle, onToggleAll,
}: {
  rows: T[] | null | undefined
  columns: Column<T>[]
  card: (row: T) => ReactNode
  rowKey: (row: T) => number | string
  onRowClick?: (row: T) => void
  loading?: boolean
  emptyText?: string
  selected?: Set<number | string>
  onToggle?: (row: T) => void
  onToggleAll?: (all: boolean) => void
}) {
  const selectable = Boolean(selected && onToggle)
  const allChecked = Boolean(rows?.length && selected && rows.every((r) => selected.has(rowKey(r))))
  if (loading) {
    return <div className="card space-y-2 p-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
  }
  if (!rows?.length) return <div className="card"><Empty title={emptyText} /></div>
  return (
    <>
      <div className="card hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-white/[0.06] bg-white/[0.015]">
              <tr>
                {selectable && (
                  <th className="w-10 pl-4"><input type="checkbox" className="h-4 w-4 accent-primary" checked={allChecked} onChange={(e) => onToggleAll?.(e.target.checked)} aria-label="Выбрать все" /></th>
                )}
                {columns.map((c, i) => <th key={i} className={clsx('th', c.align === 'right' && 'text-right', c.className)}>{c.header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {rows.map((r) => {
                const key = rowKey(r)
                return (
                  <tr key={key} onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={clsx('transition', onRowClick && 'cursor-pointer hover:bg-white/[0.025]', selected?.has(key) && 'bg-primary/[0.06]')}>
                    {selectable && (
                      <td className="w-10 pl-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected!.has(key)} onChange={() => onToggle!(r)} aria-label="Выбрать" />
                      </td>
                    )}
                    {columns.map((c, i) => <td key={i} className={clsx('td', c.align === 'right' && 'text-right', c.className)}>{c.cell(r)}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.map((r) => {
          const key = rowKey(r)
          return (
            <div key={key} className={clsx('card flex items-stretch gap-3 p-3.5', selected?.has(key) && 'ring-1 ring-primary/50')}>
              {selectable && (
                <label className="-my-3.5 -ml-3.5 flex items-center pl-3.5 pr-1">
                  <input type="checkbox" className="h-5 w-5 accent-primary" checked={selected!.has(key)} onChange={() => onToggle!(r)} aria-label="Выбрать" />
                </label>
              )}
              <div className={clsx('min-w-0 flex-1', onRowClick && 'cursor-pointer')} onClick={onRowClick ? () => onRowClick(r) : undefined}>{card(r)}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (total === 0) return null
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
      <span className="tabular">{(page - 1) * size + 1}–{Math.min(page * size, total)} из {total}</span>
      <div className="flex items-center gap-1">
        <IconBtn label="Назад" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-5 w-5" /></IconBtn>
        <span className="tabular min-w-[56px] text-center">{page} / {pages}</span>
        <IconBtn label="Вперёд" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="h-5 w-5" /></IconBtn>
      </div>
    </div>
  )
}

// -------------------------------------------------------------------- users

export function Avatar({ u, size = 36 }: { u: { first_name: string | null; username: string | null; telegram_id?: number }; size?: number }) {
  const letter = (u.first_name || u.username || '?').trim().slice(0, 1).toUpperCase()
  const hue = ((u.telegram_id ?? 0) * 47) % 360
  return (
    <div className="grid shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 70% 45%))` }}>
      {letter}
    </div>
  )
}

export function UserCell({ u, sub }: { u: { first_name: string | null; last_name?: string | null; username: string | null; telegram_id: number }; sub?: ReactNode }) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? `@${u.username}` : 'Без имени')
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar u={u} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="truncate text-xs text-muted">{sub ?? (u.username ? `@${u.username} · ${u.telegram_id}` : u.telegram_id)}</div>
      </div>
    </div>
  )
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.03] px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold">{children}</div>
    </div>
  )
}
