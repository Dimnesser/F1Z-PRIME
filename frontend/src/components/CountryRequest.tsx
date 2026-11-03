import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Globe2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useConfig } from '../lib/queries'
import { haptic } from '../lib/telegram'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Stepper } from './ui'

/** «Нет нужной страны?» — a support ticket for the operator. No payment is taken until the shop confirms. */
export function CountryRequestButton() {
  const { data } = useConfig()
  const [open, setOpen] = useState(false)
  if (data?.settings.country_requests_enabled === 'false') return null
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); haptic.select() }}
        className="card flex w-full items-center gap-3 p-4 text-left pressable">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent"><Globe2 className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Нет нужной страны?</div>
          <div className="text-[12.5px] text-muted">Оставьте запрос — оператор проверит наличие и цену</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
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
        <div className="flex items-center justify-between rounded-[20px] bg-ov/[0.04] py-1.5 pl-4 pr-1.5 ring-1 ring-inset ring-line/70">
          <span className="text-[14px] font-medium text-muted">Количество</span>
          <Stepper value={qty} max={100} onChange={setQty} />
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
