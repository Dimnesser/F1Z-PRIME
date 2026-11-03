import clsx from 'clsx'
import {
  BadgeCheck, CheckCircle2, Copy, Download, FileUp, Globe2, History, Phone, Plus, ShieldQuestion,
  Trash2, Upload, UserRound, XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge, Btn, Card, Chips, DataTable, Empty, ErrorBox, Field, IconBtn, Modal, PageHead, Pager, SearchInput,
  Skeleton, Tabs, useConfirm, useToast, type Column, type Tone,
} from '../components/ui'
import { api, dt, download, errMsg, qs } from '../lib/api'
import { useCan } from '../lib/session'
import { useApi, useDebounced } from '../lib/useApi'

// ----------------------------------------------------------------- types matching /api/admin/phones*

type PhoneStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'DISABLED'
interface PhoneRow {
  id: number
  phone_e164: string
  country_iso2: string
  country_name: string
  flag: string
  status: PhoneStatus
  product_id: number | null
  reserved_order_id: number | null
  sold_order_id: number | null
  batch: string | null
  added_by: string | null
  note: string
  created_at: string
  sold_at: string | null
}
interface PhonePage { total: number; items: PhoneRow[] }
interface CountryRow { country_iso2: string; country_name: string; flag: string; available: number; reserved: number; sold: number; disabled: number }
interface Summary {
  totals: { total: number; available: number; reserved: number; sold: number; disabled: number }
  countries: CountryRow[]
  recent_added: PhoneRow[]
  recent_sold: PhoneRow[]
}
interface Detection { normalized: string | null; valid: boolean; country_iso2: string | null; country_name: string | null; flag: string; ambiguous: string[]; error: string | null }
interface AddResult { status: 'added' | 'duplicate' | 'invalid' | 'ambiguous'; id?: number; normalized?: string; country_iso2?: string; country_name?: string; flag?: string; error?: string; options?: string[] }
interface BulkResult { added: number; duplicates: number; invalid: number; ambiguous: number; errors: { input: string; error: string }[]; ambiguous_samples: { input: string; normalized: string; options: string[] }[]; touched_products: number[] }

const STATUS_META: Record<PhoneStatus, { label: string; tone: Tone }> = {
  AVAILABLE: { label: 'Свободен', tone: 'green' },
  RESERVED: { label: 'В резерве', tone: 'amber' },
  SOLD: { label: 'Продан', tone: 'violet' },
  DISABLED: { label: 'Отключён', tone: 'gray' },
}

type PhoneTab = 'overview' | 'add' | 'bulk' | 'all' | 'countries' | 'history' | 'verify'

export default function Phones() {
  const canStock = useCan('products.stock')
  const canVerify = useCan('orders.fulfill')
  const [tab, setTab] = useState<PhoneTab>('overview')
  // shared refresh signal so adding/importing numbers updates the overview + table
  const [rev, setRev] = useState(0)
  const bump = useCallback(() => setRev((v) => v + 1), [])

  const tabs = useMemo(() => {
    const t: { value: PhoneTab; label: string; icon?: typeof Phone }[] = [
      { value: 'overview', label: 'Обзор склада', icon: Phone },
    ]
    if (canStock) t.push({ value: 'add', label: 'Добавить номер', icon: Plus }, { value: 'bulk', label: 'Массовый импорт', icon: FileUp })
    t.push({ value: 'all', label: 'Все номера', icon: Globe2 }, { value: 'countries', label: 'Страны', icon: Globe2 }, { value: 'history', label: 'История продаж', icon: History })
    if (canVerify) t.push({ value: 'verify', label: 'Проверки', icon: ShieldQuestion })
    return t
  }, [canStock, canVerify])

  return (
    <div>
      <PageHead title="База номеров" subtitle="Склад телефонных номеров: автоопределение страны, остатки из реальных записей, автовыдача после оплаты. Хранятся только номера — без кодов Telegram и сессий." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'overview' && <Overview rev={rev} onGoTo={setTab} />}
      {tab === 'add' && canStock && <AddOne onAdded={bump} />}
      {tab === 'bulk' && canStock && <BulkImport onDone={bump} />}
      {tab === 'all' && <AllNumbers rev={rev} canStock={canStock} onChanged={bump} />}
      {tab === 'countries' && <Countries rev={rev} />}
      {tab === 'history' && <HistoryTab rev={rev} />}
      {tab === 'verify' && canVerify && <Verifications />}
    </div>
  )
}

// ----------------------------------------------------------------- overview

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className={clsx('mt-1 tabular text-2xl font-bold', tone)}>{value}</div>
    </div>
  )
}

function Overview({ rev, onGoTo }: { rev: number; onGoTo: (t: PhoneTab) => void }) {
  const { data, loading, error, reload } = useApi<Summary>(`/phones/summary${qs({ rev })}`)
  const toast = useToast()
  if (loading) return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  if (error) return <ErrorBox text={error} onRetry={() => reload()} />
  if (!data) return null
  const t = data.totals
  const empty = data.countries.filter((c) => c.available === 0).length
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Всего номеров" value={t.total} tone="text-ink" />
        <StatCard label="Свободно" value={t.available} tone={t.available === 0 ? 'text-danger' : 'text-success'} />
        <StatCard label="В резерве" value={t.reserved} tone="text-warning" />
        <StatCard label="Продано" value={t.sold} tone="text-primary-soft" />
      </div>
      <Card title={<span className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-primary-soft" /> Остатки по странам</span>}
        action={<span className="text-xs text-muted">стран: {data.countries.length}{empty ? ` · закончились у ${empty}` : ''}</span>}>
        {data.countries.length === 0
          ? <Empty title="Номеров пока нет" text="Добавьте номера вручную или импортом — страна определится автоматически." action={<Btn size="sm" onClick={() => onGoTo('add')}><Plus className="h-4 w-4" /> Добавить</Btn>} />
          : (
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-3">
              {data.countries.map((c) => (
                <div key={c.country_iso2} className="w-[240px] shrink-0 rounded-xl bg-white/[0.03] p-3 sm:w-auto">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.flag} {c.country_name}</span>
                    <span className="text-[11px] text-muted">{c.country_iso2}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-3 text-xs text-muted">
                    <span className={clsx('tabular text-lg font-bold', c.available === 0 ? 'text-danger' : c.available <= 5 ? 'text-warning' : 'text-success')}>{c.available}</span>
                    <span>свободно</span>
                    <span className="ml-auto tabular">резерв {c.reserved} · продано {c.sold}{c.disabled ? ` · откл. ${c.disabled}` : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Последние добавленные">
          <RecentList rows={data.recent_added} onCopy={(n) => { void navigator.clipboard?.writeText(n); toast('Скопировано') }} field="created_at" />
        </Card>
        <Card title="Последние продажи">
          <RecentList rows={data.recent_sold} onCopy={(n) => { void navigator.clipboard?.writeText(n); toast('Скопировано') }} field="sold_at" />
        </Card>
      </div>
    </div>
  )
}

function RecentList({ rows, onCopy, field }: { rows: PhoneRow[]; onCopy: (n: string) => void; field: 'created_at' | 'sold_at' }) {
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-muted">Пока пусто</div>
  return (
    <div className="space-y-1.5">
      {rows.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2">
          <span className="shrink-0">{p.flag}</span>
          <span className="truncate font-mono text-sm">{p.phone_e164}</span>
          <Badge tone={STATUS_META[p.status].tone} className="ml-1">{STATUS_META[p.status].label}</Badge>
          <span className="ml-auto whitespace-nowrap text-[11px] text-muted">{dt(p[field])}</span>
          <IconBtn label="Копировать" className="h-7 w-7" onClick={() => onCopy(p.phone_e164)}><Copy className="h-3.5 w-3.5" /></IconBtn>
        </div>
      ))}
    </div>
  )
}

// ----------------------------------------------------------------- add one (live detection preview)

function AddOne({ onAdded }: { onAdded: () => void }) {
  const [phone, setPhone] = useState('')
  const [override, setOverride] = useState('')
  const [note, setNote] = useState('')
  const [batch, setBatch] = useState('')
  const [det, setDet] = useState<Detection | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const debounced = useDebounced(phone, 350)
  const seq = useRef(0)

  useEffect(() => {
    const raw = debounced.trim()
    if (raw.length < 3) { setDet(null); return }
    const id = ++seq.current
    void api<Detection>('/phones/detect', { method: 'POST', body: { phone: raw, country: override || null } })
      .then((d) => { if (id === seq.current) setDet(d) })
      .catch(() => { if (id === seq.current) setDet(null) })
  }, [debounced, override])

  const ambiguous = det?.ambiguous?.length ? det.ambiguous : null
  const needsChoice = Boolean(ambiguous && !override)

  const submit = async () => {
    setBusy(true)
    try {
      const r = await api<AddResult>('/phones', { method: 'POST', body: { phone: phone.trim(), country: override || null, note: note.trim(), batch: batch.trim() || null } })
      if (r.status === 'added') {
        toast(`Добавлен ${r.flag ?? ''} ${r.normalized}`)
        setPhone(''); setOverride(''); setNote(''); setDet(null)
        onAdded()
      } else if (r.status === 'duplicate') {
        toast('Такой номер уже есть в базе', 'error')
      } else if (r.status === 'ambiguous') {
        toast('Укажите страну — код принадлежит нескольким странам', 'error')
      } else {
        toast(r.error || 'Некорректный номер', 'error')
      }
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Добавить один номер">
        <div className="space-y-3">
          <Field label="Номер телефона" hint="В любом формате — страна определится автоматически по международному коду">
            <input className="input font-mono" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 415 555 2671" />
          </Field>
          {needsChoice && (
            <Field label="Страна (код принадлежит нескольким странам — выберите)">
              <div className="flex flex-wrap gap-2">
                {ambiguous!.map((iso) => (
                  <button key={iso} type="button" onClick={() => setOverride(iso)}
                    className={clsx('chip', override === iso && 'chip-active')}>{iso}</button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Заметка (необязательно)">
            <input className="input" maxLength={255} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Поставщик, комментарий" />
          </Field>
          <Field label="Партия (необязательно)">
            <input className="input" maxLength={64} value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Закупка 11.10" />
          </Field>
          <Btn disabled={!phone.trim() || needsChoice || det?.valid === false} loading={busy} onClick={submit}>
            <Plus className="h-4 w-4" /> Добавить номер
          </Btn>
        </div>
      </Card>
      <Card title="Предпросмотр">
        {!det && <div className="py-8 text-center text-sm text-muted">Начните вводить номер — здесь появится определённая страна.</div>}
        {det && (
          <div className="space-y-3">
            {det.valid
              ? (
                <div className="rounded-xl bg-success/10 p-4">
                  <div className="text-3xl">{override ? '' : det.flag}</div>
                  <div className="mt-1 font-mono text-lg font-semibold">{det.normalized}</div>
                  <div className="mt-1 text-sm text-muted">
                    {override ? `Страна вручную: ${override}` : `${det.flag} ${det.country_name ?? '—'} (${det.country_iso2 ?? '—'})`}
                  </div>
                </div>
              )
              : (
                <div className="rounded-xl bg-danger/10 p-4 text-sm text-danger">
                  {det.error || 'Номер не распознан как телефонный'}
                </div>
              )}
            {ambiguous && (
              <div className="rounded-xl bg-warning/10 p-3 text-sm text-warning">
                Код принадлежит нескольким странам: {ambiguous.join(', ')}. Выберите страну — система не угадывает.
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

// ----------------------------------------------------------------- bulk import (drag-and-drop + preview)

function BulkImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [override, setOverride] = useState('')
  const [batch, setBatch] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length

  const ingest = async (f: File) => {
    if (f.size > 2_000_000) { toast('Файл больше 2 МБ — разбейте на части', 'error'); return }
    const body = (await f.text()).replace(/^﻿/, '')
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, '')}\n${body}` : body))
    setResult(null)
  }

  const run = async () => {
    setBusy(true)
    try {
      const r = await api<BulkResult>('/phones/bulk', { method: 'POST', body: { text, country: override || null, batch: batch.trim() || null } })
      setResult(r)
      toast(`Добавлено: ${r.added}`)
      if (r.added) { setText(''); onDone() }
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Массовый импорт">
        <p className="text-sm text-muted">Один номер в строке. Для TXT/CSV берётся первый столбец. Дубликаты (в файле и в базе) и некорректные номера отбрасываются автоматически. До 5000 за раз.</p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void ingest(f) }}
          className={clsx('mt-3 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition',
            drag ? 'border-primary bg-primary/10 text-ink' : 'border-white/15 text-muted')}>
          <Upload className="h-6 w-6" />
          <span>Перетащите файл .txt / .csv сюда</span>
          <Btn size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" /> Выбрать файл</Btn>
          <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await ingest(f) }} />
        </div>
        <textarea className="input mt-3 min-h-[160px] font-mono text-xs" spellCheck={false} autoComplete="off" value={text}
          onChange={(e) => { setText(e.target.value); setResult(null) }} placeholder={'+14155552671\n+380671234567\n+48512345678'} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Страна для всех (необязательно)" hint="Задайте, если коды неоднозначны (+1, +7, +44)">
            <input className="input" maxLength={2} value={override} onChange={(e) => setOverride(e.target.value.toUpperCase())} placeholder="US / KZ / GB" />
          </Field>
          <Field label="Партия (необязательно)">
            <input className="input" maxLength={64} value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Закупка 11.10" />
          </Field>
        </div>
        <Btn className="mt-3" disabled={!lines} loading={busy} onClick={run}><Upload className="h-4 w-4" /> Импортировать {lines ? `(${lines})` : ''}</Btn>
      </Card>
      <Card title="Результат импорта">
        {!result && <div className="py-8 text-center text-sm text-muted">Загрузите номера — здесь появится отчёт: добавлено / дубликаты / некорректные / неоднозначные.</div>}
        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="Добавлено" value={result.added} tone="text-success" />
              <Mini label="Дубликаты" value={result.duplicates} tone="text-muted" />
              <Mini label="Некорректные" value={result.invalid} tone="text-danger" />
              <Mini label="Неоднозначные" value={result.ambiguous} tone="text-warning" />
            </div>
            {result.ambiguous > 0 && (
              <div className="rounded-xl bg-warning/10 p-3 text-xs text-warning">
                {result.ambiguous} номер(ов) с неоднозначным кодом страны не добавлены. Укажите «Страну для всех» и повторите импорт этих номеров.
                {result.ambiguous_samples.length > 0 && (
                  <ul className="mt-2 space-y-0.5 font-mono">
                    {result.ambiguous_samples.slice(0, 8).map((s, i) => <li key={i}>{s.normalized} → {s.options.join('/')}</li>)}
                  </ul>
                )}
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-xl bg-white/[0.03] p-3 text-xs text-muted">
                <div className="font-semibold text-ink">Примеры некорректных:</div>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {result.errors.slice(0, 8).map((e, i) => <li key={i}>{e.input} — {e.error}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3 text-center">
      <div className={clsx('tabular text-xl font-bold', tone)}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  )
}

// ----------------------------------------------------------------- all numbers (list + filter + edit/delete)

const SIZE = 50

function AllNumbers({ rev, canStock, onChanged }: { rev: number; canStock: boolean; onChanged: () => void }) {
  const canExport = useCan('products.import')
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [status, setStatus] = useState<'' | PhoneStatus>('')
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search, 300)
  const { data, loading, error, reload } = useApi<PhonePage>(`/phones${qs({ search: debounced, country, status, page, size: SIZE, rev })}`)
  const summary = useApi<Summary>(`/phones/summary${qs({ rev })}`)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => { setPage(1) }, [debounced, country, status])

  const remove = async (p: PhoneRow) => {
    const ok = await confirm({ title: `Удалить ${p.phone_e164}?`, danger: true, confirmLabel: 'Удалить', text: 'Номер будет удалён из базы, остаток страны уменьшится. Проданный номер удалить нельзя.' })
    if (ok === false) return
    try {
      await api(`/phones/${p.id}`, { method: 'DELETE' })
      toast('Номер удалён')
      void reload(true); void summary.reload(true); onChanged()
    } catch (e) { toast(errMsg(e), 'error') }
  }

  const toggleDisabled = async (p: PhoneRow) => {
    try {
      await api(`/phones/${p.id}`, { method: 'PATCH', body: { status: p.status === 'DISABLED' ? 'AVAILABLE' : 'DISABLED' } })
      toast(p.status === 'DISABLED' ? 'Номер включён' : 'Номер отключён')
      void reload(true); void summary.reload(true); onChanged()
    } catch (e) { toast(errMsg(e), 'error') }
  }

  const columns: Column<PhoneRow>[] = [
    { header: 'Номер', cell: (p) => (
      <div className="flex items-center gap-2">
        <span>{p.flag}</span>
        <span className="font-mono text-sm">{p.phone_e164}</span>
        <IconBtn label="Копировать" className="h-7 w-7" onClick={() => { void navigator.clipboard?.writeText(p.phone_e164); toast('Скопировано') }}><Copy className="h-3.5 w-3.5" /></IconBtn>
      </div>
    ) },
    { header: 'Страна', cell: (p) => <span className="text-sm">{p.country_name} <span className="text-muted">{p.country_iso2}</span></span> },
    { header: 'Статус', cell: (p) => <Badge tone={STATUS_META[p.status].tone}>{STATUS_META[p.status].label}</Badge> },
    { header: 'Заказ', cell: (p) => <span className="tabular text-sm text-muted">{p.sold_order_id ? `#${p.sold_order_id}` : p.reserved_order_id ? `#${p.reserved_order_id} (рез.)` : '—'}</span> },
    { header: 'Добавлен', cell: (p) => <span className="whitespace-nowrap text-xs text-muted">{dt(p.created_at)}{p.batch ? ` · ${p.batch}` : ''}</span> },
  ]
  if (canStock) columns.push({ header: '', align: 'right', cell: (p) => (
    <div className="flex justify-end gap-1">
      {(p.status === 'AVAILABLE' || p.status === 'DISABLED') && (
        <Btn size="sm" variant="ghost" onClick={() => toggleDisabled(p)}>{p.status === 'DISABLED' ? 'Включить' : 'Отключить'}</Btn>
      )}
      {p.status !== 'SOLD' && <IconBtn label="Удалить" className="h-8 w-8 text-danger" onClick={() => remove(p)}><Trash2 className="h-4 w-4" /></IconBtn>}
    </div>
  ) })

  const countryOpts = summary.data?.countries ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по номеру" className="min-w-[200px] flex-1" />
        <select className="input h-10 w-auto" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Все страны</option>
          {countryOpts.map((c) => <option key={c.country_iso2} value={c.country_iso2}>{c.flag} {c.country_name} ({c.available + c.reserved + c.sold})</option>)}
        </select>
        {canExport && (
          <Btn variant="secondary" onClick={() => download(`/phones/export.csv${qs({ status })}`, 'phone-inventory.csv').catch((e) => toast(errMsg(e), 'error'))}>
            <Download className="h-4 w-4" /> CSV
          </Btn>
        )}
      </div>
      <Chips value={status} onChange={(v) => setStatus(v)} options={[
        { value: '' as const, label: 'Все', count: summary.data?.totals.total },
        { value: 'AVAILABLE' as const, label: 'Свободные', count: summary.data?.totals.available },
        { value: 'RESERVED' as const, label: 'В резерве', count: summary.data?.totals.reserved },
        { value: 'SOLD' as const, label: 'Проданные', count: summary.data?.totals.sold },
        { value: 'DISABLED' as const, label: 'Отключённые', count: summary.data?.totals.disabled },
      ]} />
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      <DataTable rows={data?.items} columns={columns} loading={loading} rowKey={(p) => p.id}
        emptyText="Номера не найдены"
        card={(p) => (
          <div>
            <div className="flex items-center gap-2">
              <span>{p.flag}</span>
              <span className="font-mono text-sm font-semibold">{p.phone_e164}</span>
              <Badge tone={STATUS_META[p.status].tone} className="ml-auto">{STATUS_META[p.status].label}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted">{p.country_name} · {dt(p.created_at)}{p.sold_order_id ? ` · заказ #${p.sold_order_id}` : ''}</div>
            {canStock && (
              <div className="mt-2 flex gap-2">
                <Btn size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(p.phone_e164); toast('Скопировано') }}><Copy className="h-3.5 w-3.5" /> Копировать</Btn>
                {(p.status === 'AVAILABLE' || p.status === 'DISABLED') && <Btn size="sm" variant="ghost" onClick={() => toggleDisabled(p)}>{p.status === 'DISABLED' ? 'Включить' : 'Отключить'}</Btn>}
                {p.status !== 'SOLD' && <Btn size="sm" variant="danger" onClick={() => remove(p)}><Trash2 className="h-3.5 w-3.5" /> Удалить</Btn>}
              </div>
            )}
          </div>
        )} />
      {data && <Pager page={page} total={data.total} size={SIZE} onPage={setPage} />}
    </div>
  )
}

// ----------------------------------------------------------------- countries breakdown

function Countries({ rev }: { rev: number }) {
  const { data, loading, error, reload } = useApi<Summary>(`/phones/summary${qs({ rev })}`)
  if (loading) return <Skeleton className="h-64 rounded-2xl" />
  if (error) return <ErrorBox text={error} onRetry={() => reload()} />
  if (!data || data.countries.length === 0) return <div className="card"><Empty title="Нет стран" text="Добавьте номера — страны появятся автоматически." /></div>
  const columns: Column<CountryRow>[] = [
    { header: 'Страна', cell: (c) => <span className="text-sm font-semibold">{c.flag} {c.country_name} <span className="text-muted">{c.country_iso2}</span></span> },
    { header: 'Свободно', align: 'right', cell: (c) => <span className={clsx('tabular font-bold', c.available === 0 ? 'text-danger' : 'text-success')}>{c.available}</span> },
    { header: 'Резерв', align: 'right', cell: (c) => <span className="tabular text-warning">{c.reserved}</span> },
    { header: 'Продано', align: 'right', cell: (c) => <span className="tabular text-primary-soft">{c.sold}</span> },
    { header: 'Отключено', align: 'right', cell: (c) => <span className="tabular text-muted">{c.disabled}</span> },
  ]
  return (
    <DataTable rows={data.countries} columns={columns} rowKey={(c) => c.country_iso2}
      card={(c) => (
        <div>
          <div className="text-sm font-semibold">{c.flag} {c.country_name} <span className="text-muted">{c.country_iso2}</span></div>
          <div className="mt-1 flex gap-3 text-xs text-muted">
            <span className={clsx('tabular font-bold', c.available === 0 ? 'text-danger' : 'text-success')}>{c.available} своб.</span>
            <span className="tabular">{c.reserved} рез.</span>
            <span className="tabular">{c.sold} прод.</span>
            {c.disabled > 0 && <span className="tabular">{c.disabled} откл.</span>}
          </div>
        </div>
      )} />
  )
}

// ----------------------------------------------------------------- sale history

function HistoryTab({ rev }: { rev: number }) {
  const [country, setCountry] = useState('')
  const { data, loading, error, reload } = useApi<(PhoneRow & { order_public_id: string | null })[]>(`/phones/history${qs({ country, limit: 500, rev })}`)
  const summary = useApi<Summary>(`/phones/summary${qs({ rev })}`)
  const toast = useToast()
  const columns: Column<PhoneRow & { order_public_id: string | null }>[] = [
    { header: 'Номер', cell: (p) => (
      <div className="flex items-center gap-2">
        <span>{p.flag}</span>
        <span className="font-mono text-sm">{p.phone_e164}</span>
        <IconBtn label="Копировать" className="h-7 w-7" onClick={() => { void navigator.clipboard?.writeText(p.phone_e164); toast('Скопировано') }}><Copy className="h-3.5 w-3.5" /></IconBtn>
      </div>
    ) },
    { header: 'Страна', cell: (p) => <span className="text-sm">{p.country_name}</span> },
    { header: 'Заказ', cell: (p) => <span className="tabular text-sm text-muted">{p.sold_order_id ? `#${p.sold_order_id}` : '—'}</span> },
    { header: 'Продан', align: 'right', cell: (p) => <span className="whitespace-nowrap text-xs text-muted">{dt(p.sold_at)}</span> },
  ]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input h-10 w-auto" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Все страны</option>
          {(summary.data?.countries ?? []).filter((c) => c.sold > 0).map((c) => <option key={c.country_iso2} value={c.country_iso2}>{c.flag} {c.country_name} ({c.sold})</option>)}
        </select>
        <span className="text-xs text-muted">продано всего: {summary.data?.totals.sold ?? '—'}</span>
      </div>
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      <DataTable rows={data} columns={columns} loading={loading} rowKey={(p) => p.id} emptyText="Продаж пока нет"
        card={(p) => (
          <div>
            <div className="flex items-center gap-2"><span>{p.flag}</span><span className="font-mono text-sm font-semibold">{p.phone_e164}</span></div>
            <div className="mt-1 text-xs text-muted">{p.country_name} · {dt(p.sold_at)}{p.sold_order_id ? ` · заказ #${p.sold_order_id}` : ''}</div>
          </div>
        )} />
    </div>
  )
}

// ----------------------------------------------------------------- ownership verification (owner review)

type VerifyStatus = 'WAITING' | 'RECEIVED' | 'APPROVED' | 'EXPIRED' | 'FAILED'
interface VEvent { at: string; event: string; by?: string; note?: string; masked?: string; test_only?: boolean }
interface Verification {
  id: number
  status: VerifyStatus
  provider: string
  phone_e164: string | null
  code_masked: string | null
  attempts: number
  events: VEvent[]
  expires_at: string | null
  decided_by: string | null
  created_at: string
  order?: {
    id: number; public_id: string; item_title: string; status: string; country: string | null
    payment_status: string | null; payment_method: string | null; paid_at: string | null; requested_at: string
    buyer: { telegram_id: number; username: string | null } | null
  }
}

const V_META: Record<VerifyStatus, { label: string; tone: Tone }> = {
  WAITING: { label: 'Ожидает', tone: 'amber' },
  RECEIVED: { label: 'Код получен', tone: 'cyan' },
  APPROVED: { label: 'Подтверждено', tone: 'green' },
  EXPIRED: { label: 'Истекло', tone: 'gray' },
  FAILED: { label: 'Отклонено', tone: 'red' },
}

function Verifications() {
  const [status, setStatus] = useState<'active' | 'all'>('active')
  const { data, loading, error, reload } = useApi<Verification[]>(`/verifications${qs({ status })}`, { poll: 20_000 })
  const [open, setOpen] = useState<Verification | null>(null)

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white/[0.03] p-3 text-xs leading-relaxed text-muted">
        Проверка владения — только каркас с <b className="text-ink">мок-провайдером</b>: коды фиктивные (TEST-…), реальные коды Telegram и файлы .session не читаются и не передаются. Владелец подтверждает выдачу вручную. Заявка создаётся после подтверждённой оплаты, только если включена настройка «phone_verification_enabled».
      </div>
      <Chips value={status} onChange={setStatus} options={[{ value: 'active' as const, label: 'Активные' }, { value: 'all' as const, label: 'Все' }]} />
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      {loading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>}
      {data && data.length === 0 && <div className="card"><Empty icon={ShieldQuestion} title="Нет заявок на проверку" text="Заявки появляются автоматически после оплаты, когда проверка включена." /></div>}
      <div className="space-y-2">
        {data?.map((v) => (
          <button key={v.id} type="button" onClick={() => setOpen(v)} className="card flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.025]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Заказ {v.order?.public_id ?? `#${v.order?.id ?? v.id}`}</span>
                <Badge tone={V_META[v.status].tone}>{V_META[v.status].label}</Badge>
                {v.order?.payment_status === 'confirmed' && <Badge tone="green" dot>оплата подтверждена</Badge>}
              </div>
              <div className="mt-1 truncate text-xs text-muted">
                {v.order?.country ? `${v.order.country} · ` : ''}{v.phone_e164 ?? '—'} · заявка {dt(v.created_at)}
              </div>
            </div>
            <BadgeCheck className="h-5 w-5 shrink-0 text-muted" />
          </button>
        ))}
      </div>
      {open && <VerificationModal vid={open.id} onClose={() => setOpen(null)} onChanged={() => void reload(true)} />}
    </div>
  )
}

function VerificationModal({ vid, onClose, onChanged }: { vid: number; onClose: () => void; onChanged: () => void }) {
  const { data, loading, error, reload, setData } = useApi<Verification>(`/verifications/${vid}`)
  const [busy, setBusy] = useState<'fetch' | 'approve' | 'reject' | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const act = async (kind: 'fetch' | 'approve' | 'reject', note = '') => {
    setBusy(kind)
    try {
      const path = kind === 'fetch' ? `/verifications/${vid}/fetch-code` : `/verifications/${vid}/decide`
      const body = kind === 'fetch' ? undefined : { approve: kind === 'approve', note }
      const r = await api<Verification>(path, { method: 'POST', body })
      setData(r)
      toast(kind === 'fetch' ? 'Получен тестовый код' : kind === 'approve' ? 'Выдача подтверждена' : 'Заявка отклонена')
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(null) }
  }

  const reject = async () => {
    const note = await confirm({ title: 'Отклонить заявку?', danger: true, confirmLabel: 'Отклонить', input: { label: 'Причина (необязательно)', placeholder: 'Почему отклонено' } })
    if (note === false) return
    await act('reject', note)
  }

  const terminal = data && ['APPROVED', 'EXPIRED', 'FAILED'].includes(data.status)
  const buyer = data?.order?.buyer
  const contact = buyer?.username ? `https://t.me/${buyer.username}` : buyer ? `tg://user?id=${buyer.telegram_id}` : null

  return (
    <Modal open onClose={onClose} size="lg" title={`Проверка заявки${data?.order ? ` · ${data.order.public_id}` : ''}`}
      subtitle={data ? V_META[data.status].label : undefined}
      footer={data && (
        <>
          {contact && <a href={contact} target="_blank" rel="noreferrer" className="mr-auto"><Btn variant="secondary"><UserRound className="h-4 w-4" /> Связаться с покупателем</Btn></a>}
          {!terminal && <Btn variant="secondary" loading={busy === 'fetch'} onClick={() => act('fetch')}>Получить тест-код</Btn>}
          {!terminal && <Btn variant="danger" loading={busy === 'reject'} onClick={reject}><XCircle className="h-4 w-4" /> Отклонить</Btn>}
          {!terminal && <Btn variant="success" loading={busy === 'approve'} onClick={() => act('approve')}><CheckCircle2 className="h-4 w-4" /> Подтвердить</Btn>}
        </>
      )}>
      {loading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      {data && (
        <div className="space-y-4">
          {data.order && (
            <div className="grid gap-2 rounded-xl bg-white/[0.03] p-4 text-sm sm:grid-cols-2">
              <KV label="Заказ">{data.order.public_id}</KV>
              <KV label="Товар">{data.order.item_title}</KV>
              <KV label="Страна">{data.order.country ?? '—'}</KV>
              <KV label="Номер">{data.phone_e164 ?? '—'}</KV>
              <KV label="Статус оплаты">{data.order.payment_status === 'confirmed' ? <span className="text-success">Подтверждена</span> : data.order.payment_status ?? '—'}</KV>
              <KV label="Оплачен">{dt(data.order.paid_at)}</KV>
              <KV label="Покупатель">{buyer ? (buyer.username ? `@${buyer.username}` : `ID ${buyer.telegram_id}`) : '—'}</KV>
              <KV label="Время заявки">{dt(data.order.requested_at)}</KV>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] p-4 text-sm">
            <span className="text-muted">Код (маска):</span>
            <span className="font-mono text-lg font-semibold">{data.code_masked || '— ещё не получен'}</span>
            <Badge tone="amber" className="ml-auto">попыток: {data.attempts}</Badge>
            {data.expires_at && !terminal && <span className="text-xs text-muted">истекает {dt(data.expires_at)}</span>}
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold">Журнал действий</div>
            <div className="space-y-1.5">
              {(data.events ?? []).slice().reverse().map((e, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-3 py-2 text-xs">
                  <span className="font-mono text-muted">{dt(e.at)}</span>
                  <span className="font-semibold">{EVENT_RU[e.event] ?? e.event}</span>
                  {e.by && <span className="text-muted">· {e.by}</span>}
                  {e.masked && <span className="font-mono text-muted">· {e.masked}</span>}
                  {e.note && <span className="text-muted">· {e.note}</span>}
                  {e.test_only && <Badge tone="gray" className="ml-auto">тест</Badge>}
                </div>
              ))}
              {(data.events ?? []).length === 0 && <div className="text-xs text-muted">Пока нет событий</div>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

const EVENT_RU: Record<string, string> = {
  requested: 'Заявка создана', received: 'Получен тест-код', approved: 'Подтверждено', rejected: 'Отклонено',
  expired: 'Истекло', failed: 'Ошибка',
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[11px] uppercase tracking-wide text-muted">{label}</div><div className="mt-0.5 font-medium">{children}</div></div>
}
