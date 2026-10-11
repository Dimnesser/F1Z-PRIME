import { useQueryClient } from '@tanstack/react-query'
import { Globe2, Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useConfig } from '../lib/queries'
import { haptic } from '../lib/telegram'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button } from './ui'

/** «Нет нужной страны?» — a support ticket for the operator. No payment is taken until the shop confirms. */
export function CountryRequestButton() {
  const { data } = useConfig()
  const [open, setOpen] = useState(false)
  if (data?.settings.country_requests_enabled === 'false') return null
  return (
    <>
      <button onClick={() => { setOpen(true); haptic.select() }}
        className="card mt-3 flex w-full items-center gap-3 p-4 text-left pressable">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary/15 text-secondary"><Globe2 className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold">Нет нужной страны?</div>
          <div className="text-[12.5px] text-muted">Оставьте запрос — оператор проверит наличие и цену</div>
        </div>
      </button>
      <CountryRequestSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function CountryRequestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [country, setCountry] = useState('')
  const [qty, setQty] = useState(1)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const valid = country.trim().length >= 2

  const send = async () => {
    setBusy(true)
    try {
      const t = await api.countryRequest(country.trim(), qty, comment.trim())
      haptic.success()
      qc.invalidateQueries({ queryKey: ['tickets'] })
      onClose()
      setCountry(''); setComment(''); setQty(1)
      navigate(`/support/${t.id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Заказать другую страну">
      <div className="space-y-3.5">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-muted">Страна</span>
          <input className="input" maxLength={60} placeholder="Например, Казахстан или +7 7xx" value={country} onChange={(e) => setCountry(e.target.value)} />
        </label>
        <div className="flex items-center justify-between rounded-2xl bg-card p-3.5 ring-1 ring-white/[0.06]">
          <span className="text-sm font-semibold text-muted">Количество</span>
          <div className="flex items-center gap-3">
            <button aria-label="Меньше" className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.07] pressable disabled:opacity-40" disabled={qty <= 1} onClick={() => setQty(qty - 1)}><Minus className="h-4 w-4" /></button>
            <span className="w-8 text-center font-display text-lg font-bold">{qty}</span>
            <button aria-label="Больше" className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.07] pressable disabled:opacity-40" disabled={qty >= 100} onClick={() => setQty(qty + 1)}><Plus className="h-4 w-4" /></button>
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-muted">Комментарий (необязательно)</span>
          <textarea className="input min-h-[84px] py-3" maxLength={1000} placeholder="Для какого сервиса, сроки" value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <p className="text-[12px] text-muted">Создастся обращение в поддержку. Оплата не списывается — оператор сообщит цену и наличие.</p>
        <Button className="w-full" loading={busy} disabled={!valid} onClick={send}>Отправить запрос</Button>
      </div>
    </Sheet>
  )
}
