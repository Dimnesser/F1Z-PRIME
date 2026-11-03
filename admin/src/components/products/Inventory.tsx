import clsx from 'clsx'
import { Download, KeyRound, Lock, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge, Btn, Card, Chips, ErrorBox, Field, Modal, Pager, Skeleton, useConfirm, useToast } from '../ui'
import { api, download, dt, errMsg, qs } from '../../lib/api'
import { useCan } from '../../lib/session'
import { useApi } from '../../lib/useApi'
import { FULFILLMENT, UNIT_STATUS, type FulfillmentMode } from './shared'

type UnitStatus = 'available' | 'reserved' | 'sold' | 'void'
const STATUSES: UnitStatus[] = ['available', 'reserved', 'sold', 'void']
type Counts = Record<UnitStatus, number>

interface Unit { id: number; label: string; status: UnitStatus; order_id: number | null; batch: string | null; created_at: string; sold_at: string | null }
interface UnitsPage { items: Unit[]; total: number; counts: Counts; uses_inventory: boolean; stock: number }
export interface InventorySummaryRow extends Counts { product_id: number; title: string; stock: number; fulfillment_mode: FulfillmentMode }

/** Overview of all key/code products. Rendered only when such products exist. */
export function InventorySummary({ rows, onOpen }: { rows: InventorySummaryRow[]; onOpen: (r: { id: number; title: string }) => void }) {
  const total = rows.reduce((a, r) => a + r.available, 0)
  const empty = rows.filter((r) => r.available === 0).length
  return (
    <Card className="mb-4" title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary-soft" /> Ключи и коды</span>}
      action={<span className="text-xs text-muted">свободно {total}{empty ? ` · закончились у ${empty}` : ''}</span>}>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-3">
        {rows.map((r) => (
          <button key={r.product_id} type="button" onClick={() => onOpen({ id: r.product_id, title: r.title })}
            className="w-[240px] shrink-0 rounded-xl bg-white/[0.03] p-3 text-left transition hover:bg-white/[0.06] sm:w-auto">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">{r.title}</span>
              <Badge tone={FULFILLMENT[r.fulfillment_mode]?.tone ?? 'gray'}>{FULFILLMENT[r.fulfillment_mode]?.short ?? r.fulfillment_mode}</Badge>
            </div>
            <div className="mt-2 flex items-baseline gap-3 text-xs text-muted">
              <span className={clsx('tabular text-lg font-bold', r.available === 0 ? 'text-danger' : r.available <= 5 ? 'text-warning' : 'text-success')}>{r.available}</span>
              <span>свободно</span>
              <span className="ml-auto tabular">резерв {r.reserved} · продано {r.sold}{r.void ? ` · списано ${r.void}` : ''}</span>
            </div>
          </button>
        ))}
      </div>
    </Card>
  )
}

const SIZE = 50

/** Encrypted deliverable units of one product: counts, masked list, upload, void, export. */
export function InventoryPanel({ product, onClose, onChanged }: { product: { id: number; title: string }; onClose: () => void; onChanged: () => void }) {
  const canStock = useCan('products.stock')
  const canExport = useCan('products.import')
  const [status, setStatus] = useState<'' | UnitStatus>('')
  const [page, setPage] = useState(1)
  const { data, loading, error, reload } = useApi<UnitsPage>(`/products/${product.id}/inventory${qs({ status, page, size: SIZE })}`)
  const [upload, setUpload] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  const voidUnit = async (u: Unit) => {
    const ok = await confirm({ title: `Списать единицу ${u.label}?`, danger: true, confirmLabel: 'Списать', text: 'Единица больше не будет выдана покупателям, остаток уменьшится на 1. Отменить нельзя.' })
    if (ok === false) return
    try {
      await api(`/products/${product.id}/inventory/${u.id}/void`, { method: 'POST' })
      toast('Единица списана')
      void reload(true)
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={`Ключи: ${product.title}`} subtitle={data ? `Свободно ${data.counts.available} · в остатке ${data.stock} шт` : undefined}
      footer={<>
        {canExport && (
          <Btn variant="secondary" className="mr-auto" onClick={() => download(`/products/${product.id}/inventory/export.csv`, `inventory-${product.id}.csv`).catch((e) => toast(errMsg(e), 'error'))}>
            <Download className="h-4 w-4" /> Экспорт меток CSV
          </Btn>
        )}
        {canStock && <Btn disabled={data?.uses_inventory === false} onClick={() => setUpload(true)}><Upload className="h-4 w-4" /> Загрузить</Btn>}
      </>}>
      <div className="flex gap-2.5 rounded-xl bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-muted">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary-soft" />
        <span>Значения хранятся зашифрованными — сотрудники видят только маску. Покупатель видит ключ в карточке заказа после выдачи. Экспорт содержит только маски и статусы.</span>
      </div>
      {data && !data.uses_inventory && (
        <div className="mt-3 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">У товара выключена «Выдача из загруженных единиц» — загрузка недоступна, пока режим не включён.</div>
      )}
      <Chips className="mt-4" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[
        { value: '' as const, label: 'Все', count: data ? STATUSES.reduce((a, s) => a + data.counts[s], 0) : undefined },
        ...STATUSES.map((s) => ({ value: s, label: UNIT_STATUS[s].label, count: data?.counts[s] })),
      ]} />
      {error && <div className="mt-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <div className="mt-3 space-y-1.5">
        {loading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
        {data && data.items.length === 0 && <div className="py-8 text-center text-sm text-muted">{status ? 'Нет единиц с этим статусом' : 'Единиц пока нет — загрузите ключи или коды'}</div>}
        {data?.items.map((u) => (
          <div key={u.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-mono text-sm">{u.label}</span>
                <Badge tone={UNIT_STATUS[u.status]?.tone ?? 'gray'}>{UNIT_STATUS[u.status]?.label ?? u.status}</Badge>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted">
                #{u.id} · {dt(u.created_at)}{u.batch ? ` · партия «${u.batch}»` : ''}{u.order_id ? ` · заказ #${u.order_id}` : ''}{u.sold_at ? ` · выдан ${dt(u.sold_at)}` : ''}
              </div>
            </div>
            {canStock && u.status === 'available' && <Btn size="sm" variant="danger" onClick={() => voidUnit(u)}>Списать</Btn>}
          </div>
        ))}
      </div>
      {data && <Pager page={page} total={data.total} size={SIZE} onPage={setPage} />}
      {upload && <UploadDialog productId={product.id} onClose={() => setUpload(false)} onDone={() => { void reload(true); onChanged() }} />}
    </Modal>
  )
}

function UploadDialog({ productId, onClose, onDone }: { productId: number; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [batch, setBatch] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: number; duplicates: number; invalid: number; stock: number } | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length

  const run = async () => {
    setBusy(true)
    try {
      const r = await api<NonNullable<typeof result>>(`/products/${productId}/inventory`, { method: 'POST', body: { units: text, batch: batch.trim() || null } })
      setResult(r)
      setText('') // don't keep secrets in memory/UI longer than needed
      toast(`Добавлено единиц: ${r.added}`)
      onDone()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Загрузка ключей и кодов"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>{result ? 'Готово' : 'Отмена'}</Btn>
        <Btn disabled={!lines} loading={busy} onClick={run}>Загрузить {lines ? `(${lines})` : ''}</Btn>
      </>}>
      <p className="text-sm text-muted">Одна единица на строку. Пустые строки пропускаются, повторы (в том числе уже загруженные ранее) не добавляются. До 5000 за раз.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn variant="secondary" onClick={() => file.current?.click()}><Upload className="h-4 w-4" /> Файл .txt / .csv</Btn>
        <input ref={file} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (f.size > 2_000_000) { toast('Файл больше 2 МБ — разбейте на части', 'error'); return }
          const body = (await f.text()).replace(/^﻿/, '')
          setText((t) => (t.trim() ? `${t.replace(/\s+$/, '')}\n${body}` : body))
          setResult(null)
        }} />
      </div>
      <textarea className="input mt-3 min-h-[180px] font-mono text-xs" spellCheck={false} autoComplete="off" value={text}
        onChange={(e) => { setText(e.target.value); setResult(null) }} placeholder={'XXXX-YYYY-ZZZZ\nAAAA-BBBB-CCCC'} />
      <Field label="Партия (необязательно)" hint="Например, поставщик или дата закупки — видна в списке единиц" className="mt-3">
        <input className="input" maxLength={64} value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Поставщик A, 11.10" />
      </Field>
      {result && (
        <div className={clsx('mt-3 rounded-xl p-3 text-sm', result.added ? 'bg-success/10' : 'bg-warning/10')}>
          <div className="font-semibold">Добавлено: {result.added} · дубликатов: {result.duplicates} · некорректных: {result.invalid}</div>
          <div className="mt-0.5 text-muted">Остаток товара теперь {result.stock} шт.</div>
        </div>
      )}
    </Modal>
  )
}
