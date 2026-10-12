import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Check, Copy, RefreshCw, Smartphone, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { EmptyState, PageTitle, Skeleton, Button, Badge } from '../components/ui'
import { useToast } from '../components/Toast'
import { api, ApiError, newIdempotencyKey, SMS_ACTIVE } from '../lib/api'
import { useSmsActivations, useSmsPrices } from '../lib/queries'
import { haptic } from '../lib/telegram'
import type { SmsActivation } from '../lib/types'

const LABEL: Record<string, { text: string; tone: 'violet' | 'cyan' | 'green' | 'amber' | 'red' | 'gray' }> = {
  RESERVED: { text: 'Резерв', tone: 'gray' },
  API_PENDING: { text: 'Запрос номера', tone: 'amber' },
  WAITING: { text: 'Ожидает SMS', tone: 'cyan' },
  COMPLETED: { text: 'Код получен', tone: 'green' },
  CANCEL_REQUESTED: { text: 'Отмена…', tone: 'amber' },
  CANCELLED: { text: 'Отменён', tone: 'gray' },
  TIMEOUT: { text: 'Истёк', tone: 'red' },
  FAILED: { text: 'Ошибка', tone: 'red' },
  RECONCILIATION_REQUIRED: { text: 'На проверке', tone: 'amber' },
}

export default function Sms() {
  const qc = useQueryClient()
  const toast = useToast()
  const prices = useSmsPrices()
  const activations = useSmsActivations()
  const [country, setCountry] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const active = (activations.data ?? []).find((a) => SMS_ACTIVE.includes(a.status))
  const unavailable = prices.error instanceof ApiError && prices.error.status === 404
  const data = prices.data
  const countries = data?.countries ?? []
  const svcTitle = useMemo(() => Object.fromEntries((data?.services ?? []).map((s) => [s.code, s.title])), [data])
  const current = country || countries[0]?.code
  const items = (data?.items ?? []).filter((i) => i.country === current)

  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast('Скопировано', 'success') }

  const buy = async (service: string) => {
    if (busy) return
    setBusy(true)
    haptic.tap('medium')
    try {
      await api.smsPurchase(current!, service, newIdempotencyKey())
      await qc.invalidateQueries({ queryKey: ['sms-activations'] })
      await qc.invalidateQueries({ queryKey: ['me'] })
      toast('Номер куплен', 'success')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось купить', 'error')
    } finally { setBusy(false) }
  }

  const cancel = async (id: number) => {
    try {
      await api.smsCancel(id)
      await qc.invalidateQueries({ queryKey: ['sms-activations'] })
      await qc.invalidateQueries({ queryKey: ['me'] })
      toast('Активация отменена', 'success')
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Ошибка', 'error') }
  }

  return (
    <div>
      <PageTitle
        title="Виртуальные номера"
        subtitle="Номер получает один SMS-код для регистрации. Код придёт сюда автоматически."
        right={<div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand shadow-glow"><Smartphone className="h-6 w-6 text-white" /></div>}
      />

      {active && <ActivationCard a={active} onCopy={copy} onCancel={cancel} onRefresh={() => activations.refetch()} />}

      {unavailable || (data && !data.configured) ? (
        <EmptyState icon={<Smartphone className="h-7 w-7" />} title="Временно недоступно"
          text="Продажа номеров сейчас выключена. Загляните позже." />
      ) : prices.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : (
        <>
          {countries.length > 1 && (
            <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
              {countries.map((c) => (
                <button key={c.code} onClick={() => { setCountry(c.code); haptic.select() }}
                  className={clsx('pressable flex shrink-0 items-center rounded-full px-3.5 py-2 text-[13px] font-bold ring-1',
                    current === c.code ? 'bg-ink text-bg ring-ink' : 'bg-card text-muted ring-white/[0.07]')}>
                  {c.title}
                </button>
              ))}
            </div>
          )}
          {items.length === 0 ? (
            <EmptyState icon={<Smartphone className="h-7 w-7" />} title="Нет номеров" text="Для этой страны сейчас нет доступных сервисов." />
          ) : (
            <motion.div className="stagger space-y-2.5">
              {items.map((i) => (
                <div key={i.service} className="flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-white/[0.06]">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{svcTitle[i.service] ?? i.service}</div>
                    <div className="text-[13px] text-muted">В наличии: {i.count}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg font-bold">{i.price.toFixed(2)} грн</div>
                  </div>
                  <Button size="md" disabled={busy || !!active} onClick={() => buy(i.service)}>Купить</Button>
                </div>
              ))}
              {active && <p className="px-1 pt-1 text-center text-[12px] text-muted">Завершите текущую активацию, чтобы купить новый номер.</p>}
            </motion.div>
          )}
        </>
      )}
    </div>
  )
}

function ActivationCard({ a, onCopy, onCancel, onRefresh }: {
  a: SmsActivation; onCopy: (t: string) => void; onCancel: (id: number) => void; onRefresh: () => void
}) {
  const meta = LABEL[a.status] ?? { text: a.status, tone: 'gray' as const }
  const canCancel = ['WAITING', 'API_PENDING', 'RESERVED'].includes(a.status)
  return (
    <div className="mb-5 rounded-3xl border border-brand/25 bg-brand/[0.06] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-brand">
          <Smartphone className="h-4 w-4" /> Текущая активация
        </div>
        <Badge tone={meta.tone}>{meta.text}</Badge>
      </div>
      <button onClick={() => a.phone_number && onCopy(a.phone_number)}
        className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl bg-black/20 px-3.5 py-3 text-left pressable">
        <span className="min-w-0 break-all font-mono text-[15px] font-bold">{a.phone_number ?? '—'}</span>
        <Copy className="h-4 w-4 shrink-0 text-brand" />
      </button>
      <div className="mt-2 text-[13px] text-muted">{a.country} · {a.service}</div>
      {a.code && (
        <button onClick={() => onCopy(a.code!)}
          className="mt-2 flex w-full items-center justify-between gap-3 rounded-2xl bg-success/15 px-3.5 py-3 text-left pressable">
          <span className="font-mono text-lg font-bold text-success">{a.code}</span>
          <Check className="h-5 w-5 shrink-0 text-success" />
        </button>
      )}
      {a.status === 'WAITING' && a.expires_at && (
        <p className="mt-2 text-[12px] text-muted">Ожидаем код · действует до {new Date(a.expires_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
      )}
      {(a.status === 'CANCELLED' || a.status === 'TIMEOUT') && a.refunded && (
        <p className="mt-2 text-[12px] text-success">💸 Возврат {a.cost.toFixed(2)} грн на баланс</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="ghost" onClick={onRefresh}><RefreshCw className="h-4 w-4" /> Обновить</Button>
        {canCancel && <Button size="sm" variant="danger" onClick={() => onCancel(a.id)}><X className="h-4 w-4" /> Отменить</Button>}
      </div>
    </div>
  )
}
