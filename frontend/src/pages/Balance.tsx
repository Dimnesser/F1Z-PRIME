import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDownLeft, ArrowUpRight, Info, Plus, ReceiptText, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BalanceCard } from '../components/Cards'
import { Chips, EmptyState, ErrorState, PageTitle, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { money, TX_LABEL } from '../lib/format'
import { useConfig, useMe } from '../lib/queries'
import { useShop } from '../lib/shop'
import type { Transaction } from '../lib/types'

type Filter = 'all' | 'in' | 'out' | 'refund'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'in', label: 'Пополнения' },
  { value: 'out', label: 'Покупки' },
  { value: 'refund', label: 'Возвраты' },
]

const TX_ICON = { topup: ArrowDownLeft, purchase: ArrowUpRight, refund: RotateCcw, admin_adjust: SlidersHorizontal }

const dayKey = (iso: string) => new Date(iso).toDateString()
function dayTitle(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

export default function Balance() {
  const navigate = useNavigate()
  const { topup } = useShop()
  const { data: me, isLoading: meLoading } = useMe()
  const { data: config } = useConfig()
  const txs = useQuery({ queryKey: ['transactions'], queryFn: api.transactions })
  const [filter, setFilter] = useState<Filter>('all')

  const list = useMemo(() => (txs.data ?? []).filter((t) => {
    if (filter === 'in') return t.type === 'topup' || (t.type === 'admin_adjust' && t.amount > 0)
    if (filter === 'out') return t.type === 'purchase'
    if (filter === 'refund') return t.type === 'refund'
    return true
  }), [txs.data, filter])

  const totals = useMemo(() => {
    let inc = 0, out = 0
    for (const t of txs.data ?? []) {
      if (t.amount > 0) inc += t.amount
      else out += -t.amount
    }
    return { inc, out }
  }, [txs.data])

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const t of list) {
      const k = dayKey(t.created_at)
      m.set(k, [...(m.get(k) ?? []), t])
    }
    return [...m.values()]
  }, [list])

  return (
    <div className="space-y-4">
      <PageTitle title="Баланс" />

      <BalanceCard balance={me?.balance} loading={meLoading} compact />
      <button type="button" onClick={topup} className="pressable flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] bg-primary text-[15px] font-semibold text-primary-ink shadow-glow">
        <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} /> Пополнить баланс
      </button>
      <div className="grid grid-cols-2 gap-2">
        <div className="card px-4 py-3">
          <div className="flex items-center gap-1.5 text-[13px] text-muted"><ArrowDownLeft className="h-4 w-4 text-success" /> Поступило</div>
          <div className="num mt-1 truncate text-[17px] font-semibold">{money(totals.inc)}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="flex items-center gap-1.5 text-[13px] text-muted"><ArrowUpRight className="h-4 w-4" /> Потрачено</div>
          <div className="num mt-1 truncate text-[17px] font-semibold">{money(totals.out)}</div>
        </div>
      </div>

      {config?.settings.min_topup && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-ov/[0.03] px-3.5 py-3 text-[12.5px] leading-snug text-muted">
          <Info className="mt-px h-4 w-4 shrink-0 text-accent" />
          Минимальное пополнение — {money(Number(config.settings.min_topup))}. Переводы на карту зачисляются после проверки администратором.
        </div>
      )}

      <section aria-label="История операций">
        <h2 className="mb-3 px-1 pt-3 text-[19px] font-semibold tracking-[-0.01em]">История операций</h2>
        <Chips value={filter} onChange={setFilter} options={FILTERS} className="mb-4" />
        {txs.isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-[18px]" />)}</div>
        ) : txs.error ? (
          <ErrorState text={(txs.error as Error).message} onRetry={() => txs.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            compact
            icon={<ReceiptText className="h-7 w-7" />}
            title={filter === 'all' ? 'Операций пока нет' : 'Нет операций этого типа'}
            text={filter === 'all' ? 'Пополните баланс, чтобы покупать в один тап' : undefined}
          />
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={dayKey(g[0].created_at)}>
                <div className="mb-1.5 px-4 text-[13px] text-muted">{dayTitle(g[0].created_at)}</div>
                <div className="card hairline overflow-hidden">
                  {g.map((t) => {
                    const plus = t.amount > 0
                    const Icon = TX_ICON[t.type] ?? SlidersHorizontal
                    const row = (
                      <>
                        <div className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', plus ? 'bg-success/12 text-success' : 'bg-ov/[0.06] text-ink')}>
                          <Icon className="h-[18px] w-[18px]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium">{TX_LABEL[t.type] ?? t.type}</div>
                          <div className="truncate text-[12.5px] text-muted">{time(t.created_at)}{t.description ? `, ${t.description}` : ''}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={clsx('num text-[14.5px] font-bold', plus && 'text-success')}>{plus ? '+' : '−'}{money(Math.abs(t.amount))}</div>
                          <div className="num text-[11px] text-muted">остаток {money(t.balance_after)}</div>
                        </div>
                      </>
                    )
                    return t.order_id ? (
                      <button key={t.id} type="button" onClick={() => navigate(`/orders/${t.order_id}`)} className="pressable flex w-full items-center gap-3 px-4 py-3 text-left">{row}</button>
                    ) : (
                      <div key={t.id} className="flex items-center gap-3 px-4 py-3">{row}</div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
