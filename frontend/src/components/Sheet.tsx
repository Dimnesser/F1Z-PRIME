import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const controls = useDragControls()
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[32px] border-t border-white/10 bg-surface no-scrollbar"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
            style={{ paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}
          >
            <div
              className="sticky top-0 z-10 touch-none bg-surface/95 px-5 pb-3 pt-3 backdrop-blur"
              onPointerDown={(e) => controls.start(e)}
            >
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/15" />
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">{title}</h3>
                <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-muted pressable" aria-label="Закрыть">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="px-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
