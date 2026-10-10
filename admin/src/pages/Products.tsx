import clsx from 'clsx'
import { Archive, Download, Pencil, Plus, Star, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge, Btn, Chips, DataTable, ErrorBox, Field, IconBtn, Modal, PageHead, SearchInput, Tabs, Toggle, useConfirm, useToast, type Tone,
} from '../components/ui'
import { api, download, dt, errMsg, money } from '../lib/api'
import type { Category, Country, Product, ProductStatus } from '../lib/types'
import { useApi } from '../lib/useApi'

const STATUS: Record<ProductStatus, { label: string; tone: Tone }> = {
  active: { label: 'Активен', tone: 'green' }, hidden: { label: 'Скрыт', tone: 'gray' }, archived: { label: 'Архив', tone: 'amber' },
}
type Form = {
  id?: number; title: string; description: string; category: string; country_id: number | null; price: string; stock: string
  status: ProductStatus; is_popular: boolean; sort_order: string; delivery_note: string; created_at?: string
}
const EMPTY: Form = { title: '', description: '', category: 'numbers', country_id: null, price: '', stock: '0', status: 'active', is_popular: false, sort_order: '100', delivery_note: '' }

export default function Products() {
  const [tab, setTab] = useState<'products' | 'categories'>('products')
  return (
    <div className="fade-in">
      <PageHead title="Товары" subtitle="Цены, остатки и статусы. Изменения сразу видны в Mini App." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'products', label: 'Каталог' }, { value: 'categories', label: 'Категории' }]} />
      {tab === 'products' ? <Catalog /> : <Categories />}
    </div>
  )
}

function Catalog() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | ProductStatus>('')
  const [category, setCategory] = useState('')
  const [countryId, setCountryId] = useState('')
  const { data, loading, error, reload } = useApi<Product[]>('/products')
  const { data: countries } = useApi<Country[]>('/countries')
  const { data: categories } = useApi<Category[]>('/categories')
  const [form, setForm] = useState<Form | null>(null)
  const [selected, setSelected] = useState<Set<number | string>>(new Set())
  const [bulk, setBulk] = useState<{ action: string; value: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  // client-side filtering: the catalog is small, so search feels instant
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data ?? []).filter((p) =>
      (!status || p.status === status) && (!category || p.category === category) && (!countryId || String(p.country_id) === countryId)
      && (!term || p.title.toLowerCase().includes(term) || String(p.id) === term || p.country?.name.toLowerCase().includes(term)))
  }, [data, search, status, category, countryId])
  const counts = useMemo(() => {
    const c: Record<string, number> = { '': data?.length ?? 0 }
    for (const p of data ?? []) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [data])
  const catTitle = (slug: string) => categories?.find((c) => c.slug === slug)?.title ?? slug

  // deep links from the dashboard: ?new=1, ?edit=<id>
  useEffect(() => {
    const edit = Number(params.get('edit'))
    if (params.get('new')) setForm({ ...EMPTY, category: categories?.[0]?.slug ?? 'numbers' })
    else if (edit && data) {
      const p = data.find((x) => x.id === edit)
      if (p) setForm(toForm(p))
    } else return
    const next = new URLSearchParams(params)
    next.delete('new')
    next.delete('edit')
    setParams(next, { replace: true })
  }, [params, data, categories, setParams])

  const save = async () => {
    if (!form) return
    if (!form.title.trim() || !(Number(form.price.replace(',', '.')) > 0)) { toast('Укажите название и цену больше 0', 'error'); return }
    setBusy(true)
    try {
      const { id, created_at: _c, ...rest } = form
      const body = { ...rest, title: rest.title.trim(), price: rest.price.replace(',', '.'), stock: Number(rest.stock) || 0, sort_order: Number(rest.sort_order) || 0 }
      await api(id ? `/products/${id}` : '/products', { method: id ? 'PATCH' : 'POST', body })
      toast(id ? 'Товар сохранён' : 'Товар создан и уже виден в Mini App')
      setForm(null)
      reload(true)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const remove = async (p: Product) => {
    const ok = await confirm({ title: `Удалить «${p.title}»?`, danger: true, confirmLabel: 'Удалить', text: 'Если по товару были заказы, он будет перемещён в архив, а история сохранится.' })
    if (ok === false) return
    try {
      const r = await api<{ archived?: boolean; detail?: string }>(`/products/${p.id}`, { method: 'DELETE' })
      toast(r.archived ? r.detail ?? 'Перемещён в архив' : 'Товар удалён')
      setForm(null)
      reload(true)
    } catch (e) { toast(errMsg(e), 'error') }
  }
  const quick = async (p: Product, body: Record<string, unknown>) => {
    try { await api(`/products/${p.id}`, { method: 'PATCH', body }); reload(true) } catch (e) { toast(errMsg(e), 'error') }
  }
  const runBulk = async () => {
    if (!bulk) return
    const ids = [...selected].map(Number)
    const labels: Record<string, string> = {
      status: 'Изменить статус', price_set: 'Установить цену', price_percent: 'Изменить цену на %', price_delta: 'Изменить цену на сумму',
      stock_set: 'Установить остаток', stock_delta: 'Изменить остаток на', category: 'Сменить категорию',
    }
    const ok = await confirm({ title: `${labels[bulk.action]}: ${bulk.value}`, text: `Будет изменено товаров: ${ids.length}. Изменения сразу появятся в Mini App.` })
    if (ok === false) return
    setBusy(true)
    try {
      const r = await api<{ updated: number }>('/products/bulk', { method: 'POST', body: { ids, action: bulk.action, value: bulk.value } })
      toast(`Обновлено товаров: ${r.updated}`)
      setBulk(null)
      setSelected(new Set())
      reload(true)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const toggle = (p: Product) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(p.id)) n.delete(p.id)
    else n.add(p.id)
    return n
  })

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput className="min-w-[200px] flex-1" value={search} onChange={setSearch} placeholder="Название, страна или ID" />
        <select className="input w-[calc(50%-4px)] sm:w-44" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
          <option value="">Все категории</option>{categories?.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
        </select>
        <select className="input w-[calc(50%-4px)] sm:w-44" value={countryId} onChange={(e) => setCountryId(e.target.value)} aria-label="Страна">
          <option value="">Все страны</option>{countries?.map((c) => <option key={c.id} value={c.id}>{c.flag} {c.name}</option>)}
        </select>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Chips value={status} onChange={setStatus} options={[
          { value: '', label: 'Все', count: counts[''] }, { value: 'active', label: 'Активные', count: counts.active ?? 0 },
          { value: 'hidden', label: 'Скрытые', count: counts.hidden ?? 0 }, { value: 'archived', label: 'Архив', count: counts.archived ?? 0 },
        ]} />
        <div className="flex w-full gap-2 sm:w-auto">
          <Btn variant="secondary" className="flex-1 sm:flex-none" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Импорт</Btn>
          <Btn variant="secondary" className="flex-1 sm:flex-none" onClick={() => download('/products/export.csv', 'products.csv').catch((e) => toast(errMsg(e), 'error'))}><Download className="h-4 w-4" /> Экспорт</Btn>
          <Btn className="flex-1 sm:flex-none" onClick={() => setForm({ ...EMPTY, category: categories?.[0]?.slug ?? 'numbers' })}><Plus className="h-4 w-4" /> Товар</Btn>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-elevated p-3 shadow-pop lg:top-4">
          <span className="text-sm font-semibold">Выбрано: {selected.size}</span>
          <select className="input h-10 w-auto flex-1 sm:flex-none" value={bulk?.action ?? ''} onChange={(e) => setBulk(e.target.value ? { action: e.target.value, value: e.target.value === 'status' ? 'active' : e.target.value === 'category' ? (categories?.[0]?.slug ?? '') : '' } : null)}>
            <option value="">Действие…</option>
            <option value="price_percent">Цена ± %</option><option value="price_delta">Цена ± грн</option><option value="price_set">Установить цену</option>
            <option value="stock_set">Установить остаток</option><option value="stock_delta">Остаток ± шт</option>
            <option value="status">Статус</option><option value="category">Категория</option>
          </select>
          {bulk?.action === 'status' && (
            <select className="input h-10 w-auto" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          )}
          {bulk?.action === 'category' && (
            <select className="input h-10 w-auto" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}>
              {categories?.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
            </select>
          )}
          {bulk && !['status', 'category'].includes(bulk.action) && (
            <input className="input h-10 w-28" inputMode="decimal" autoFocus value={bulk.value} placeholder={bulk.action === 'price_percent' ? '+10 / -5' : '0'} onChange={(e) => setBulk({ ...bulk, value: e.target.value.replace(',', '.') })} />
          )}
          <Btn disabled={!bulk?.value} loading={busy} onClick={runBulk}>Применить</Btn>
          <IconBtn label="Снять выделение" onClick={() => { setSelected(new Set()); setBulk(null) }}><X className="h-4 w-4" /></IconBtn>
        </div>
      )}

      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable
        rows={rows} loading={loading} rowKey={(p) => p.id} onRowClick={(p) => setForm(toForm(p))}
        selected={selected} onToggle={toggle} onToggleAll={(all) => setSelected(all ? new Set(rows.map((p) => p.id)) : new Set())}
        emptyText={data?.length ? 'Ничего не найдено' : 'Товаров пока нет'}
        columns={[
          { header: 'Товар', cell: (p) => (
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-lg">{p.country?.flag ?? '📦'}</span>
              <div className="min-w-0"><div className="max-w-[260px] truncate font-semibold">{p.title}</div><div className="text-xs text-muted">{p.country ? `${p.country.name} ${p.country.dial_code}` : `ID ${p.id}`}</div></div>
            </div>
          ) },
          { header: 'Категория', cell: (p) => <span className="text-muted">{catTitle(p.category)}</span> },
          { header: 'Цена', align: 'right', cell: (p) => <InlineNumber value={p.price} suffix="грн" onSave={(v) => quick(p, { price: v })} /> },
          { header: 'Остаток', align: 'right', cell: (p) => <InlineNumber value={p.stock} integer tone={p.stock === 0 ? 'text-danger' : p.stock <= 5 ? 'text-warning' : 'text-success'} onSave={(v) => quick(p, { stock: v })} /> },
          { header: 'Статус', cell: (p) => <Badge tone={STATUS[p.status].tone} dot>{STATUS[p.status].label}</Badge> },
          { header: 'Топ', cell: (p) => (
            <button type="button" aria-label="Популярный" onClick={(e) => { e.stopPropagation(); void quick(p, { is_popular: !p.is_popular }) }} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/[0.05]">
              <Star className={p.is_popular ? 'h-4 w-4 fill-warning text-warning' : 'h-4 w-4 text-muted'} />
            </button>
          ) },
        ]}
        card={(p) => (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="text-xl">{p.country?.flag ?? '📦'}</span>
                <div className="min-w-0"><div className="truncate font-semibold">{p.title}</div><div className="text-xs text-muted">{catTitle(p.category)}</div></div>
              </div>
              <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-sm">
              <span className="tabular font-bold">{money(p.price)}</span>
              <span className={clsx('tabular font-semibold', p.stock === 0 ? 'text-danger' : p.stock <= 5 ? 'text-warning' : 'text-success')}>{p.stock} шт</span>
            </div>
          </div>
        )}
      />

      <Modal open={form !== null} onClose={() => setForm(null)} size="lg" title={form?.id ? 'Редактировать товар' : 'Новый товар'}
        subtitle={form?.created_at ? `ID ${form.id} · создан ${dt(form.created_at)}` : undefined}
        footer={form && <>
          {form.id && <Btn variant="danger" className="mr-auto" onClick={() => remove(data!.find((x) => x.id === form.id)!)}><Trash2 className="h-4 w-4" /> Удалить</Btn>}
          {form.id && form.status !== 'archived' && <Btn variant="secondary" onClick={() => setForm({ ...form, status: 'archived' })}><Archive className="h-4 w-4" /> В архив</Btn>}
          <Btn variant="secondary" onClick={() => setForm(null)}>Отмена</Btn>
          <Btn loading={busy} onClick={save}>Сохранить</Btn>
        </>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Название" className="sm:col-span-2"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Номер США" /></Field>
            <Field label="Цена, грн"><input className="input tabular" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Остаток, шт"><input className="input tabular" inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Категория">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories?.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
              </select>
            </Field>
            <Field label="Страна" hint={(() => { const c = countries?.find((x) => x.id === form.country_id); return c ? `${c.flag} код ${c.dial_code}` : undefined })()}>
              <select className="input" value={form.country_id ?? ''} onChange={(e) => setForm({ ...form, country_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— без страны —</option>
                {countries?.map((c) => <option key={c.id} value={c.id}>{c.flag} {c.name} {c.dial_code}</option>)}
              </select>
            </Field>
            <Field label="Статус">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProductStatus })}>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Порядок сортировки"><input className="input tabular" inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Описание" className="sm:col-span-2"><textarea className="input min-h-[90px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Инструкция покупателю после оплаты" className="sm:col-span-2" hint="Видна покупателю только после оплаты. Не указывайте здесь пароли и коды входа в аккаунты.">
              <textarea className="input min-h-[80px]" value={form.delivery_note} onChange={(e) => setForm({ ...form, delivery_note: e.target.value })} />
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3 sm:col-span-2">
              <span className="text-sm font-semibold">Показывать в «Популярном»</span>
              <Toggle checked={form.is_popular} onChange={(v) => setForm({ ...form, is_popular: v })} label="Популярный" />
            </div>
          </div>
        )}
      </Modal>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onDone={() => reload(true)} />}
    </>
  )
}

const toForm = (p: Product): Form => ({
  id: p.id, title: p.title, description: p.description, category: p.category, country_id: p.country_id, price: String(p.price),
  stock: String(p.stock), status: p.status, is_popular: p.is_popular, sort_order: String(p.sort_order), delivery_note: p.delivery_note,
  created_at: p.created_at,
})

function InlineNumber({ value, onSave, suffix, integer, tone }: { value: number; onSave: (v: string | number) => void; suffix?: string; integer?: boolean; tone?: string }) {
  const [edit, setEdit] = useState<string | null>(null)
  if (edit === null) {
    return (
      <button type="button" title="Нажмите, чтобы изменить" onClick={(e) => { e.stopPropagation(); setEdit(String(value)) }}
        className={clsx('tabular rounded-lg px-2 py-1 font-bold transition hover:bg-white/[0.06]', tone)}>
        {integer ? value : money(value).replace(' грн', '')}{suffix ? <span className="ml-1 text-xs font-normal text-muted">{suffix}</span> : null}
      </button>
    )
  }
  const commit = () => {
    const v = edit.replace(',', '.')
    setEdit(null)
    if (v !== String(value) && v !== '') onSave(integer ? Math.max(0, Math.floor(Number(v))) : v)
  }
  return (
    <input className="input tabular h-8 w-24 px-2 text-right" autoFocus inputMode="decimal" value={edit}
      onClick={(e) => e.stopPropagation()} onChange={(e) => setEdit(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEdit(null) }} />
  )
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ created: number; updated: number; errors: { row: number; error: string }[]; applied: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const run = async (dry: boolean) => {
    setBusy(true)
    try {
      const r = await api<typeof result>('/products/import', { method: 'POST', body: { csv: text, dry_run: dry } })
      setResult(r)
      if (r?.applied) { toast(`Импорт: создано ${r.created}, обновлено ${r.updated}`); onDone(); onClose() }
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Импорт товаров из CSV"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Отмена</Btn>
        <Btn variant="secondary" disabled={!text} loading={busy} onClick={() => run(true)}>Проверить</Btn>
        <Btn disabled={!text || (result !== null && result.errors.length > 0)} loading={busy} onClick={() => run(false)}>Импортировать</Btn>
      </>}>
      <p className="text-sm text-muted">Колонки как в экспорте: <code className="text-ink">id;title;description;category;country_code;price;stock;status;is_popular;sort_order;delivery_note</code>.
        Строки с id обновляют товар, без id — создают новый. Если в файле есть ошибка, ничего не сохраняется.</p>
      <div className="mt-4 flex gap-2">
        <Btn variant="secondary" onClick={() => file.current?.click()}><Upload className="h-4 w-4" /> Выбрать файл</Btn>
        <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) { setText(await f.text()); setResult(null) }
        }} />
      </div>
      <textarea className="input mt-3 min-h-[160px] font-mono text-xs" value={text} onChange={(e) => { setText(e.target.value); setResult(null) }} placeholder={'title;price;stock;category;country_code\nНомер Германия;120;10;numbers;DE'} />
      {result && (
        <div className={clsx('mt-3 rounded-xl p-3 text-sm', result.errors.length ? 'bg-danger/10' : 'bg-success/10')}>
          <div className="font-semibold">Будет создано: {result.created}, обновлено: {result.updated}</div>
          {result.errors.map((e) => <div key={e.row} className="mt-1 text-danger">Строка {e.row}: {e.error}</div>)}
        </div>
      )}
    </Modal>
  )
}

function Categories() {
  const { data, loading, reload } = useApi<Category[]>('/categories')
  const [form, setForm] = useState<(Omit<Category, 'id'> & { id?: number }) | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      const { id, slug, ...rest } = form
      await api(id ? `/categories/${id}` : '/categories', { method: id ? 'PATCH' : 'POST', body: id ? rest : { slug, ...rest } })
      toast('Категория сохранена')
      setForm(null)
      reload(true)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const remove = async (c: Category) => {
    if (await confirm({ title: `Удалить категорию «${c.title}»?`, danger: true, confirmLabel: 'Удалить' }) === false) return
    try { await api(`/categories/${c.id}`, { method: 'DELETE' }); toast('Удалено'); reload(true) } catch (e) { toast(errMsg(e), 'error') }
  }
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Btn onClick={() => setForm({ slug: '', title: '', icon: 'box', sort_order: 100, is_active: true })}><Plus className="h-4 w-4" /> Категория</Btn>
      </div>
      <DataTable rows={data} loading={loading} rowKey={(c) => c.id} onRowClick={(c) => setForm({ ...c })}
        columns={[
          { header: 'Название', cell: (c) => <span className="font-semibold">{c.title}</span> },
          { header: 'Код', cell: (c) => <span className="font-mono text-muted">{c.slug}</span> },
          { header: 'Порядок', cell: (c) => c.sort_order },
          { header: 'Статус', cell: (c) => c.is_active ? <Badge tone="green" dot>Показывается</Badge> : <Badge tone="gray" dot>Скрыта</Badge> },
          { header: '', align: 'right', cell: (c) => <IconBtn label="Удалить" onClick={(e) => { e.stopPropagation(); void remove(c) }}><Trash2 className="h-4 w-4" /></IconBtn> },
        ]}
        card={(c) => (
          <div className="flex items-center justify-between gap-3">
            <div><div className="font-semibold">{c.title}</div><div className="font-mono text-xs text-muted">{c.slug}</div></div>
            {c.is_active ? <Badge tone="green">Вкл</Badge> : <Badge tone="gray">Скрыта</Badge>}
          </div>
        )} />
      <p className="mt-3 text-xs text-muted">Раздел «Красивые номера» в Mini App формируется автоматически.</p>
      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.id ? 'Категория' : 'Новая категория'}
        footer={<><Btn variant="secondary" onClick={() => setForm(null)}>Отмена</Btn><Btn loading={busy} onClick={save}><Pencil className="h-4 w-4" /> Сохранить</Btn></>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Название" className="sm:col-span-2"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Код (латиница)" hint="Нельзя изменить после создания"><input className="input font-mono" disabled={Boolean(form.id)} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="gift_cards" /></Field>
            <Field label="Иконка">
              <select className="input" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
                {['box', 'globe', 'sparkles', 'zap', 'gem', 'gift', 'star', 'shield'].map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Порядок"><input className="input" inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
            <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 sm:mt-6">
              <span className="text-sm font-semibold">Показывать</span>
              <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Показывать" />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
