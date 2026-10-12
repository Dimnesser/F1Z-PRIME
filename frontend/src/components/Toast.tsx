import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { haptic } from '../lib/telegram'

type Kind = 'success' | 'error' | 'info'
interface ToastItem { id: number; kind: Kind; text: string }

const ToastCtx = createContext<(text: string, kind?: Kind) => void>(() => {})

export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const push = useCallback((text: string, kind: Kind = 'info') => {
    const id = next.current++
    if (kind === 'success') haptic.success()
    if (kind === 'error') haptic.error()
    setItems((s) => [...s.slice(-2), { id, kind, text }])
    window.setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === 'error' ? 4500 : 3000)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-line bg-elevated/95 px-4 py-3 text-[14px] font-medium shadow-pop backdrop-blur-xl"
          >
            {t.kind === 'success' && <CheckCircle2 className="mt-px h-5 w-5 shrink-0 text-success" />}
            {t.kind === 'error' && <AlertTriangle className="mt-px h-5 w-5 shrink-0 text-danger" />}
            {t.kind === 'info' && <Info className="mt-px h-5 w-5 shrink-0 text-accent" />}
            <span className="min-w-0">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
