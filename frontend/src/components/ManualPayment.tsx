import { Copy, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { money } from '../lib/format'
import type { Payment } from '../lib/types'
import { useToast } from './Toast'
import { Button } from './ui'

export function ManualPayment({ payment, instructions, onSubmitted }: { payment: Payment; instructions: string; onSubmitted: (p: Payment) => void }) {
  const toast = useToast()
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const ref = `F1Z-${payment.id}`

  const submit = async () => {
    setLoading(true)
    try {
      const p = await api.submitManual(payment.id, comment)
      toast('Платёж отправлен на проверку', 'success')
      onSubmitted(p)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-secondary/20 bg-secondary/[0.06] p-4">
        <div className="text-[12px] font-semibold uppercase tracking-wider text-secondary">Сумма к оплате</div>
        <div className="mt-1 font-display text-2xl font-bold">{money(payment.amount)}</div>
        <p className="mt-3 whitespace-pre-line text-[13.5px] leading-relaxed text-ink/85">{instructions}</p>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(ref)
            toast('Номер платежа скопирован', 'success')
          }}
          className="mt-3 flex w-full items-center justify-between rounded-xl bg-white/[0.06] px-3.5 py-2.5 text-sm pressable"
        >
          <span className="text-muted">Комментарий к переводу</span>
          <span className="flex items-center gap-1.5 font-mono font-bold">{ref} <Copy className="h-3.5 w-3.5 text-muted" /></span>
        </button>
      </div>
      <textarea
        className="input min-h-[84px] resize-none"
        placeholder="Последние 4 цифры карты, время перевода…"
        maxLength={500}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <Button className="w-full" loading={loading} onClick={submit}>
        <ShieldCheck className="h-5 w-5" /> Я оплатил — отправить на проверку
      </Button>
      <p className="text-center text-[12px] text-muted">Заказ будет оплачен только после фактической проверки поступления средств администратором.</p>
    </div>
  )
}
