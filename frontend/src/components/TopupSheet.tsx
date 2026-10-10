import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CheckCircle2, Clock3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { money } from '../lib/format'
import { useConfig } from '../lib/queries'
import { haptic, openInvoice } from '../lib/telegram'
import type { PayMethod, Payment } from '../lib/types'
import { ManualPayment } from './ManualPayment'
import { PayMethods } from './PayMethods'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button } from './ui'

const PRESETS = [100, 250, 500, 1000]

export function TopupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: config } = useConfig()
  const [amount, setAmount] = useState(250)
  const [loading, setLoading] = useState<PayMethod | null>(null)
  const [manual, setManual] = useState<{ payment: Payment; instructions: string } | null>(null)
  const [done, setDone] = useState<'paid' | 'review' | null>(null)
  const min = Number(config?.settings.min_topup ?? 50)
  const uahPerStar = Number(config?.settings.uah_per_star ?? '0.85') || 0.85

  useEffect(() => {
    if (open) {
      setManual(null)
      setDone(null)
    }
  }, [open])

  const go = async (method: PayMethod) => {
    if (amount < min) return toast(`Минимальная сумма — ${money(min)}`, 'error')
    setLoading(method)
    try {
      const res = await api.topup(amount, method)
      if (method === 'stars' && res.invoice_link) {
        const status = await openInvoice(res.invoice_link)
        if (status === 'paid') {
          setDone('paid')
          haptic.success()
          setTimeout(() => qc.invalidateQueries({ queryKey: ['me'] }), 1500)
        } else if (status === 'failed') toast('Оплата не прошла', 'error')
      } else if (method === 'manual') {
        setManual({ payment: res.payment, instructions: res.instructions ?? '' })
      } else if (res.payment.status === 'confirmed') {
        setDone('paid')
        haptic.success()
      }
      qc.invalidateQueries({ queryKey: ['me'] })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setLoading(null)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Пополнение баланса">
      {done ? (
        <div className="space-y-4 py-4 text-center">
          <div className={clsx('mx-auto grid h-16 w-16 place-items-center rounded-3xl', done === 'paid' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
            {done === 'paid' ? <CheckCircle2 className="h-8 w-8" /> : <Clock3 className="h-8 w-8" />}
          </div>
          <p className="text-sm text-muted">
            {done === 'paid' ? `Баланс пополнен на ${money(amount)}` : 'Платёж отправлен на проверку. Баланс пополнится после подтверждения.'}
          </p>
          <Button className="w-full" onClick={onClose}>Готово</Button>
        </div>
      ) : manual ? (
        <ManualPayment payment={manual.payment} instructions={manual.instructions} onSubmitted={() => setDone('review')} />
      ) : (
        <div className="space-y-4">
          <div className="rounded-3xl bg-brand-soft p-5 text-center ring-1 ring-white/10">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-muted">Сумма пополнения</div>
            <div className="mt-1 flex items-center justify-center gap-1">
              <input
                type="number"
                inputMode="numeric"
                value={amount || ''}
                onChange={(e) => setAmount(Math.max(0, Math.min(50000, Number(e.target.value))))}
                className="w-40 bg-transparent text-center font-display text-4xl font-bold outline-none"
              />
              <span className="font-display text-xl text-muted">грн</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => { setAmount(p); haptic.select() }}
                className={clsx('pressable rounded-xl py-2.5 text-sm font-bold ring-1', amount === p ? 'bg-primary/20 text-ink ring-primary/50' : 'bg-card text-muted ring-white/[0.06]')}
              >
                {p}
              </button>
            ))}
          </div>
          <PayMethods
            methods={config?.payment_methods ?? []}
            exclude={['balance']}
            total={amount}
            uahPerStar={uahPerStar}
            loading={loading}
            onPick={go}
          />
        </div>
      )}
    </Sheet>
  )
}
