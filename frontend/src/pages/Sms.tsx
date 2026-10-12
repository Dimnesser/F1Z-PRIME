import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Clock3, Copy, History, MessageSquareText, RefreshCw, SearchX, Smartphone, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog, Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Badge, Button, Chips, EmptyState, ErrorState, PageTitle, SearchInput, Skeleton, StatusIndicator, type Tone } from '../components/ui'
import { api, ApiError, newIdempotencyKey, SMS_ACTIVE } from '../lib/api'
import { date, money } from '../lib/format'
import { useMe, useSmsActivations, useSmsPrices } from '../lib/queries'
import { useShop } from '../lib/shop'
import { haptic } from '../lib/telegram'
import type { SmsActivation, SmsItem } from '../lib/types'

/** Display labels for the statuses the engine exposes (display only — no logic depends on them here). */
const LABEL: Record<string, { text: string; tone: Tone }> = {
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
const label = (s: string) => LABEL[s] ?? { text: s, tone: 'gray' as Tone }

export default function Sms() {
  const qc = useQueryClient()
  const toast = useToast()
  const { topup } = useShop()
  const { data: me } = useMe()
  const prices = useSmsPrices()
  const activations = useSmsActivations()
  const [country, setCountry] = useState<string>('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState<SmsItem | null>(null)
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const all = activations.data ?? []
  const active = all.find((a) => SMS_ACTIVE.includes(a.status))
  const history = all.filter((a) => a !== active)
  const unavailable = prices.error instanceof ApiError && prices.error.status === 404
  const data = prices.data
  const countries = data?.countries ?? []
  const svcTitle = useMemo(() => Object.fromEntries((data?.services ?? []).map((s) => [s.code, s.title])), [data])
  const countryTitle = useMemo(() => Object.fromEntries(countries.map((c) => [c.code, c.title])), [countries])
  const current = country || countries[0]?.code
  const query = q.trim().toLowerCase()
  const items = (data?.items ?? [])
    .filter((i) => i.country === current)
    .filter((i) => !query || `${svcTitle[i.service] ?? ''} ${i.service}`.toLowerCase().includes(query))

  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast('Скопировано', 'success') }

  const buy = async (item: SmsItem) => {
    if (busy) return
    setBusy(true)
    haptic.tap('medium')
    try {
      await api.smsPurchase(item.country, item.service, newIdempotencyKey())
      await qc.invalidateQueries({ queryKey: ['sms-activations'] })
      await qc.invalidateQueries({ queryKey: ['me'] })
      toast('Номер куплен — ждём SMS', 'success')
      setPick(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось купить', 'error')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (cancelId === null) return
    setCancelling(true)
    try {
      await api.smsCancel(cancelId)
      await qc.invalidateQueries({ queryKey: ['sms-activations'] })
      await qc.invalidateQueries({ queryKey: ['me'] })
      toast('Активация отменена', 'success')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error')
    } finally {
      setCancelling(false)
      setCancelId(null)
    }
  }

  const notEnough = pick ? (me?.balance ?? 0) < pick.price : false

  return (
    <div className="space-y-5">
      <PageTitle
        title="Виртуальные номера"
        subtitle="Номер для получения одного SMS-кода при регистрации. Код придёт сюда автоматически."
        right={<div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/20"><Smartphone className="h-6 w-6" /></div>}
      />

      {active && (
        <ActivationCard
          a={active}
          countryTitle={countryTitle[active.country] ?? active.country}
          serviceTitle={svcTitle[active.service] ?? active.service}
          onCopy={copy}
          onCancel={() => setCancelId(active.id)}
          onRefresh={() => activations.refetch()}
          refreshing={activations.isFetching}
        />
      )}

      {unavailable || (data && !data.configured) ? (
        <EmptyState icon={<Smartphone className="h-7 w-7" />} title="Временно недоступно" text="Продажа номеров сейчас выключена. Загляните позже." />
      ) : prices.isLoading ? (
        <div className="space-y-2.5"><Skeleton className="h-12 rounded-2xl" />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px] rounded-[20px]" />)}</div>
      ) : prices.error ? (
        <ErrorState text={(prices.error as Error).message} onRetry={() => prices.refetch()} />
      ) : (
        <section aria-label="Купить номер" className="space-y-3">
          <h2 className="px-0.5 text-[17px] font-bold tracking-tight">Купить номер</h2>
          {countries.length > 1 && (
            <Chips value={current ?? ''} onChange={(v) => { setCountry(v); setQ('') }} options={countries.map((c) => ({ value: c.code, label: c.title }))} />
          )}
          <SearchInput value={q} onChange={setQ} placeholder="Сервис, например Telegram" />
          {items.length === 0 ? (
            <EmptyState compact icon={<SearchX className="h-7 w-7" />} title={query ? 'Сервис не найден' : 'Нет номеров'} text={query ? 'Попробуйте другое название' : 'Для этой страны сейчас нет доступных сервисов.'} />
          ) : (
            <div className="card hairline stagger overflow-hidden">
              {items.map((i) => {
                const soldOut = i.count <= 0
                return (
                  <div key={i.service} className="flex items-center gap-3 px-4 py-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ov/[0.05] text-[15px] font-bold uppercase text-primary-soft">
                      {(svcTitle[i.service] ?? i.service).slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{svcTitle[i.service] ?? i.service}</div>
                      <div className={clsx('num text-[12px]', soldOut ? 'text-danger' : 'text-muted')}>{soldOut ? 'Нет номеров' : `Доступно: ${i.count}`}</div>
                    </div>
                    <div className="num shrink-0 text-[15px] font-bold">{money(i.price)}</div>
                    <Button size="sm" disabled={busy || !!active || soldOut} onClick={() => setPick(i)}>Купить</Button>
                  </div>
                )
              })}
            </div>
          )}
          {active && <p className="px-1 text-center text-[12px] text-muted">Завершите текущую активацию, чтобы купить новый номер.</p>}
        </section>
      )}

      {history.length > 0 && (
        <section aria-label="История активаций">
          <h2 className="mb-3 flex items-center gap-2 px-0.5 text-[17px] font-bold tracking-tight"><History className="h-[18px] w-[18px] text-muted" /> История</h2>
          <div className="card hairline overflow-hidden">
            {history.slice(0, 20).map((a) => {
              const m = label(a.status)
              return (
                <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold">{svcTitle[a.service] ?? a.service}</span>
                      <span className="shrink-0 text-[12px] text-muted">{countryTitle[a.country] ?? a.country}</span>
                    </div>
                    <div className="num truncate font-mono text-[12.5px] text-muted">{a.phone_number ?? '—'}{a.code ? ` · код ${a.code}` : ''}</div>
                    {a.created_at && <div className="text-[11.5px] text-muted">{date(a.created_at)}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={m.tone}>{m.text}</Badge>
                    <span className={clsx('num text-[12.5px] font-semibold', a.refunded && 'text-success')}>
                      {a.refunded ? `↩ ${money(a.cost)}` : money(a.cost)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* purchase confirmation */}
      <Sheet open={pick !== null} onClose={() => setPick(null)} title="Подтверждение покупки">
        {pick && (
          <div className="space-y-4">
            <div className="card-soft hairline overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 text-[14px]"><span className="text-muted">Сервис</span><span className="font-semibold">{svcTitle[pick.service] ?? pick.service}</span></div>
              <div className="flex items-center justify-between px-4 py-3 text-[14px]"><span className="text-muted">Страна</span><span className="font-semibold">{countryTitle[pick.country] ?? pick.country}</span></div>
              <div className="flex items-center justify-between px-4 py-3 text-[14px]"><span className="text-muted">Списание с баланса</span><span className="num text-[18px] font-bold">{money(pick.price)}</span></div>
            </div>
            <div className="flex items-start gap-2.5 rounded-2xl bg-ov/[0.03] p-3 text-[12.5px] leading-relaxed text-muted">
              <MessageSquareText className="mt-px h-4 w-4 shrink-0 text-accent" />
              Номер принимает один SMS-код. Если код не придёт до окончания времени, активацию можно отменить — средства вернутся на баланс по правилам сервиса.
            </div>
            {notEnough ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between rounded-2xl bg-danger/10 px-4 py-3 text-[13px] text-danger">
                  <span>Недостаточно средств</span><span className="num font-semibold">баланс {money(me?.balance ?? 0)}</span>
                </div>
                <Button className="w-full" onClick={() => { setPick(null); topup() }}><Wallet className="h-5 w-5" /> Пополнить баланс</Button>
              </div>
            ) : (
              <Button className="w-full" loading={busy} onClick={() => buy(pick)}>Купить за <span className="num">{money(pick.price)}</span></Button>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={cancelId !== null}
        title="Отменить активацию?"
        text="Номер будет освобождён. Если SMS ещё не пришло, стоимость вернётся на баланс по правилам сервиса."
        confirmLabel="Отменить"
        cancelLabel="Ждать код"
        danger
        loading={cancelling}
        onConfirm={cancel}
        onClose={() => setCancelId(null)}
      />
    </div>
  )
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!until) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [until])
  if (!until) return null
  return Math.max(0, new Date(until).getTime() - now)
}

function ActivationCard({ a, countryTitle, serviceTitle, onCopy, onCancel, onRefresh, refreshing }: {
  a: SmsActivation; countryTitle: string; serviceTitle: string; onCopy: (t: string) => void; onCancel: () => void; onRefresh: () => void; refreshing: boolean
}) {
  const meta = label(a.status)
  const canCancel = ['WAITING', 'API_PENDING', 'RESERVED'].includes(a.status)
  const left = useCountdown(a.status === 'WAITING' ? a.expires_at : null)
  const total = a.created_at && a.expires_at ? new Date(a.expires_at).getTime() - new Date(a.created_at).getTime() : 0
  const pct = left !== null && total > 0 ? Math.min(100, (left / total) * 100) : 0
  const mm = left !== null ? String(Math.floor(left / 60000)).padStart(2, '0') : '--'
  const ss = left !== null ? String(Math.floor((left % 60000) / 1000)).padStart(2, '0') : '--'

  return (
    <section aria-label="Текущая активация" aria-live="polite" className="fade-in relative overflow-hidden rounded-[24px] border border-accent/30 bg-[linear-gradient(150deg,rgb(var(--accent)/0.12),rgb(var(--surface))_55%)] p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow">Текущая активация</div>
          <div className="mt-0.5 truncate text-[15px] font-semibold">{serviceTitle} · {countryTitle}</div>
        </div>
        <StatusIndicator tone={meta.tone} label={meta.text} live={['WAITING', 'API_PENDING', 'RESERVED', 'CANCEL_REQUESTED'].includes(a.status)} />
      </div>

      <button type="button" disabled={!a.phone_number} onClick={() => a.phone_number && onCopy(a.phone_number)}
        className="pressable mt-3 flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 text-left ring-1 ring-inset ring-line/70">
        <span className="num min-w-0 break-all font-mono text-[18px] font-bold tracking-wide">{a.phone_number ?? 'Получаем номер…'}</span>
        {a.phone_number && <Copy className="h-4 w-4 shrink-0 text-accent" aria-label="Скопировать номер" />}
      </button>

      {a.code ? (
        <button type="button" onClick={() => onCopy(a.code!)}
          className="pressable mt-2 flex min-h-[60px] w-full items-center justify-between gap-3 rounded-2xl bg-success/12 px-4 py-3 text-left ring-1 ring-inset ring-success/30">
          <span>
            <span className="block text-[11.5px] font-semibold text-success">Код из SMS</span>
            <span className="num font-mono text-[26px] font-bold tracking-[0.18em] text-success">{a.code}</span>
          </span>
          <Check className="h-6 w-6 shrink-0 text-success" />
        </button>
      ) : a.status === 'WAITING' && left !== null ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-1.5 text-muted"><Clock3 className="h-3.5 w-3.5" /> Ожидаем код</span>
            <span role="timer" className="num font-mono font-semibold">{mm}:{ss}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ov/[0.08]">
            <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      {(a.status === 'CANCELLED' || a.status === 'TIMEOUT') && a.refunded && (
        <p className="mt-2 text-[12.5px] font-medium text-success">Возврат {money(a.cost)} на баланс</p>
      )}
      {a.status === 'RECONCILIATION_REQUIRED' && (
        <p className="mt-2 text-[12.5px] leading-snug text-warning">Статус проверяется оператором. Баланс будет скорректирован автоматически.</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="md" variant="ghost" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={clsx('h-4 w-4', refreshing && 'animate-spin')} /> Обновить
        </Button>
        {canCancel ? (
          <Button size="md" variant="danger" onClick={onCancel}><X className="h-4 w-4" /> Отменить</Button>
        ) : (
          <div className="grid place-items-center text-[12px] text-muted">{money(a.cost)}</div>
        )}
      </div>
    </section>
  )
}
