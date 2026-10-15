import { useQueryClient } from '@tanstack/react-query'
import { PackageCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { useToast } from './Toast'
import { Button } from './ui'

/** Buyer confirms the number works (logged in) — completes the order on their side and opens the review form. */
export default function ReceivedCard({ orderId }: { orderId: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [sending, setSending] = useState(false)

  const confirm = async () => {
    if (sending) return
    setSending(true)
    try {
      await api.received(orderId)
      toast('Заказ завершён. Спасибо за покупку!', 'success')
      await qc.invalidateQueries({ queryKey: ['order'] })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="card p-4" aria-label="Завершить заказ">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">
        <PackageCheck className="h-4 w-4 text-primary" aria-hidden /> Вошли в аккаунт?
      </h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
        Если номер работает и вход выполнен — завершите заказ. После этого можно оставить отзыв.
      </p>
      <Button className="mt-3 w-full" variant="success" loading={sending} onClick={confirm}>
        <PackageCheck className="h-4 w-4" aria-hidden /> Получил номер — завершить заказ
      </Button>
    </section>
  )
}
