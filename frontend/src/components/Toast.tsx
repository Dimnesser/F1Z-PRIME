import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { haptic } from '../lib/telegram'

type Kind = 'success' | 'error' | 'info'
interface ToastItem { id: number; kind: Kind; text: string }

const ToastCtx = createContext<(text: string, kind?: Kind) => void>(() => {})

export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random()
    if (kind === 'success') haptic.success()
    if (kind === 'error') haptic.error()
    setItems((s) => [...s.slice(-2), { id, kind, text }])
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3200)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.95 }}
              className="glass pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-surface/80 px-4 py-3 text-sm font-medium shadow-2xl"
            >
              {t.kind === 'success' && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />}
              {t.kind === 'error' && <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />}
              {t.kind === 'info' && <Info className="h-5 w-5 shrink-0 text-secondary" />}
              <span>{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
