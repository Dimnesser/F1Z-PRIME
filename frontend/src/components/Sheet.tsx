import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui'

/** Bottom sheet (BottomSheet / Modal on phones). CSS-only animation, drag the handle down to close,
 *  Escape closes, body scroll is locked while open. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const [drag, setDrag] = useState(0)
  const start = useRef<number | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => {
      panel.current?.focus({ preventScroll: true })
    }, 50)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
      setDrag(0)
    }
  }, [open])

  if (!open) return null

  const onDown = (e: React.PointerEvent) => {
    start.current = e.clientY
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (start.current === null) return
    setDrag(Math.max(0, e.clientY - start.current))
  }
  const onUp = () => {
    if (start.current === null) return
    start.current = null
    if (drag > 110) onClose()
    else setDrag(0)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="overlay-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className="sheet-in relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[28px] border-t border-line/80 bg-surface shadow-pop outline-none"
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: start.current === null ? 'transform 200ms var(--ease-out)' : 'none' }}
      >
        <div className="shrink-0 touch-none px-5 pb-2 pt-2.5" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-ov/20" />
          <div className="flex min-h-[40px] items-center justify-between gap-3">
            <h3 id={titleId} className="min-w-0 truncate text-[18px] font-bold tracking-tight">{title}</h3>
            <button type="button" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} className="pressable grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ov/[0.06] text-muted" aria-label="Закрыть">
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5" style={footer ? undefined : { paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}>
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-line/60 px-5 pt-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}>{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Confirmation for destructive / irreversible actions (cancel order, cancel activation). */
export function ConfirmDialog({
  open, title, text, confirmLabel = 'Подтвердить', cancelLabel = 'Назад', danger, loading, onConfirm, onClose,
}: {
  open: boolean; title: string; text?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean; loading?: boolean
  onConfirm: () => void; onClose: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {text && <div className="text-[14px] leading-relaxed text-muted">{text}</div>}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <Button variant="ghost" size="md" onClick={onClose}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'primary'} size="md" loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Sheet>
  )
}
