import clsx from 'clsx'
import { ArrowRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Btn, ErrorBox, Field, Modal, Skeleton, useToast } from '../ui'
import { api, dt, errMsg, money } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { STOCK_REASON } from './shared'

type P = { id: number; title: string }

interface PriceRow { id: number; field: 'price' | 'sale_price' | string; old: number | null; new: number | null; actor: string; created_at: string }
interface StockRow { id: number; delta: number; stock_after: number; reason: string; note: string; actor: string; order_id: number | null; created_at: string }

function List<T>({ path, empty, render }: { path: string; empty: string; render: (r: T) => ReactNode }) {
  const { data, loading, error, reload } = useApi<T[]>(path)
  if (error) return <ErrorBox text={error} onRetry={() => reload()} />
  if (loading) return <div className="space-y-1.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
  if (!data?.length) return <div className="py-8 text-center text-sm text-muted">{empty}</div>
  return <div className="space-y-1.5">{data.map(render)}</div>
}

export function PriceHistoryDialog({ product, onClose }: { product: P; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="История цен" subtitle={product.title}>
      <List<PriceRow> path={`/products/${product.id}/price-history`} empty="Изменений цены пока не было" render={(r) => (
        <div key={r.id} className="rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <Badge tone={r.field === 'sale_price' ? 'amber' : 'violet'}>{r.field === 'sale_price' ? 'Акция' : 'Цена'}</Badge>
            <span className="tabular flex items-center gap-1.5 text-sm font-semibold">
              <span className="text-muted">{r.old === null ? '—' : money(r.old)}</span><ArrowRight className="h-3.5 w-3.5 text-muted" />
              <span>{r.new === null ? (r.field === 'sale_price' ? 'без акции' : '—') : money(r.new)}</span>
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">{dt(r.created_at)} · {r.actor}</div>
        </div>
      )} />
    </Modal>
  )
}

export function StockHistoryDialog({ product, onClose }: { product: P; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="История остатков" subtitle={product.title}>
      <List<StockRow> path={`/products/${product.id}/stock-history`} empty="Движений остатка пока не было" render={(m) => (
        <div key={m.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <span className={clsx('tabular w-14 shrink-0 text-right font-bold', m.delta > 0 ? 'text-success' : m.delta < 0 ? 'text-danger' : 'text-muted')}>
            {m.delta > 0 ? `+${m.delta}` : m.delta}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{STOCK_REASON[m.reason] ?? m.reason}{m.note ? <span className="font-normal text-muted"> · {m.note}</span> : null}</div>
            <div className="truncate text-xs text-muted">{dt(m.created_at)} · {m.actor}{m.order_id ? ` · заказ #${m.order_id}` : ''}</div>
          </div>
          <span className="tabular shrink-0 text-xs text-muted">= {m.stock_after}</span>
        </div>
      )} />
    </Modal>
  )
}

export function StockAdjustDialog({ product, onClose, onDone }: { product: P & { stock: number }; onClose: () => void; onDone: (stock: number) => void }) {
  const [stock, setStock] = useState(String(product.stock))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const changed = stock !== '' && Number(stock) !== product.stock
  const ok = changed && reason.trim().length >= 3
  const run = async () => {
    setBusy(true)
    try {
      const r = await api<{ stock: number }>(`/products/${product.id}/stock`, { method: 'POST', body: { stock: Number(stock), reason: reason.trim() } })
      toast(`Остаток: ${r.stock} шт`)
      onDone(r.stock)
      onClose()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="sm" title="Скорректировать остаток" subtitle={product.title}
      footer={<><Btn variant="secondary" onClick={onClose}>Отмена</Btn><Btn disabled={!ok} loading={busy} onClick={run}>Сохранить</Btn></>}>
      <div className="grid gap-4">
        <Field label="Новый остаток, шт" hint={`Сейчас ${product.stock} шт${changed ? ` · изменение ${Number(stock) - product.stock > 0 ? '+' : ''}${Number(stock) - product.stock}` : ''}`}>
          <input className="input tabular" inputMode="numeric" autoFocus value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, '').slice(0, 7))} />
        </Field>
        <Field label="Причина" hint="Обязательно, от 3 символов. Сохраняется в истории остатков.">
          <input className="input" maxLength={200} value={reason} placeholder="Поступление от поставщика, пересчёт…" onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ok && !busy) void run() }} />
        </Field>
      </div>
    </Modal>
  )
}
