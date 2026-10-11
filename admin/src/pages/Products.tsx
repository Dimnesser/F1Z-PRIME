import clsx from 'clsx'
import { Archive, Copy, Download, History, KeyRound, LineChart, Pencil, Plus, SlidersHorizontal, Star, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge, Btn, Chips, DataTable, ErrorBox, Field, IconBtn, Modal, PageHead, SearchInput, Tabs, Toggle, useConfirm, useToast,
} from '../components/ui'
import { PriceHistoryDialog, StockAdjustDialog, StockHistoryDialog } from '../components/products/History'
import { InventoryPanel, InventorySummary, type InventorySummaryRow } from '../components/products/Inventory'
import { buildBody, EMPTY, PRODUCT_STATUS as STATUS, ProductFields, toForm, validate, type Form } from '../components/products/ProductForm'
import { FULFILLMENT, saleActive, schedule } from '../components/products/shared'
import { api, download, dt, errMsg, money } from '../lib/api'
import { useCan } from '../lib/session'
import type { Category, Country, Product } from '../lib/types'
import { useApi } from '../lib/useApi'

export default function Products() {
  const [tab, setTab] = useState<'products' | 'categories'>('products')
  return (
    <div className="fade-in">
      <PageHead title="Товары" subtitle="Цены, остатки, акции и ключи. Изменения сразу видны в Mini App." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'products', label: 'Каталог' }, { value: 'categories', label: 'Категории' }]} />
      {tab === 'products' ? <Catalog /> : <Categories />}
    </div>
  )
}

type Dialog =
  | { kind: 'inventory'; product: { id: number; title: string } }
  | { kind: 'price' | 'stock'; product: { id: number; title: string } }
  | { kind: 'adjust'; product: { id: number; title: string; stock: number } }

const BULK: { value: string; label: string; confirm: string; perm: 'edit' | 'price' | 'stock'; input?: 'number' | 'text' | 'status' | 'category'; placeholder?: string }[] = [
  { value: 'price_percent', label: 'Цена ± %', confirm: 'Изменить цену на %', perm: 'price', input: 'number', placeholder: '+10 / -5' },
  { value: 'price_delta', label: 'Цена ± грн', confirm: 'Изменить цену на сумму', perm: 'price', input: 'number', placeholder: '0' },
  { value: 'price_set', label: 'Установить цену', confirm: 'Установить цену', perm: 'price', input: 'number', placeholder: '0' },
  { value: 'sale_percent', label: 'Скидка акции, %', confirm: 'Акционная цена со скидкой, %', perm: 'price', input: 'number', placeholder: '1–95' },
  { value: 'sale_clear', label: 'Убрать акцию', confirm: 'Убрать акционную цену', perm: 'price' },
  { value: 'stock_set', label: 'Установить остаток', confirm: 'Установить остаток', perm: 'stock', input: 'number', placeholder: '0' },
  { value: 'stock_delta', label: 'Остаток ± шт', confirm: 'Изменить остаток на', perm: 'stock', input: 'number', placeholder: '+10 / -5' },
  { value: 'status', label: 'Статус', confirm: 'Изменить статус', perm: 'edit', input: 'status' },
  { value: 'category', label: 'Категория', confirm: 'Сменить категорию', perm: 'edit', input: 'category' },
  { value: 'tag_add', label: 'Добавить тег', confirm: 'Добавить тег', perm: 'edit', input: 'text', placeholder: 'тег' },
  { value: 'tag_remove', label: 'Убрать тег', confirm: 'Убрать тег', perm: 'edit', input: 'text', placeholder: 'тег' },
]

function Catalog() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | Product['status']>('')
  const [category, setCategory] = useState('')
  const [countryId, setCountryId] = useState('')
  const { data, loading, error, reload } = useApi<Product[]>('/products')
  const { data: countries } = useApi<Country[]>('/countries')
  const { data: categories } = useApi<Category[]>('/categories')
  const hasInventory = Boolean(data?.some((p) => p.uses_inventory))
  const summary = useApi<InventorySummaryRow[]>(hasInventory ? '/inventory/summary' : null)
  const [form, setForm] = useState<Form | null>(null)
  const [initial, setInitial] = useState<Form | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [selected, setSelected] = useState<Set<number | string>>(new Set())
  const [bulk, setBulk] = useState<{ action: string; value: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const can = { edit: useCan('products.edit'), price: useCan('products.price'), stock: useCan('products.stock') }
  const canImport = useCan('products.import')
  const canDelete = useCan('products.delete')
  const bulkOptions = BULK.filter((b) => can[b.perm])
  const bulkDef = BULK.find((b) => b.value === bulk?.action)

  const refresh = () => {
    void reload(true)
    if (hasInventory) void summary.reload(true)
  }
  const open = (f: Form | null) => { setForm(f); setInitial(f?.id ? f : null) }

  // client-side filtering: the catalog is small, so search feels instant
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data ?? []).filter((p) =>
      (!status || p.status === status) && (!category || p.category === category) && (!countryId || String(p.country_id) === countryId)
      && (!term || p.title.toLowerCase().includes(term) || String(p.id) === term || p.country?.name.toLowerCase().includes(term)
        || p.tags?.some((t) => t.toLowerCase().includes(term))))
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
    if (params.get('new')) open({ ...EMPTY, category: categories?.[0]?.slug ?? 'numbers' })
    else if (edit && data) {
      const p = data.find((x) => x.id === edit)
      if (p) open(toForm(p))
    } else return
    const next = new URLSearchParams(params)
    next.delete('new')
    next.delete('edit')
    setParams(next, { replace: true })
  }, [params, data, categories, setParams])

  const save = async () => {
    if (!form) return
    const problem = validate(form, initial)
    if (problem) { toast(problem, 'error'); return }
    const body = buildBody(form, initial)
    if (form.id && Object.keys(body).length === 0) { toast('Изменений нет', 'info'); open(null); return }
    setBusy(true)
    try {
      await api(form.id ? `/products/${form.id}` : '/products', { method: form.id ? 'PATCH' : 'POST', body })
      toast(form.id ? 'Товар сохранён' : form.status === 'active' ? 'Товар создан и уже виден в Mini App' : 'Товар создан')
      open(null)
      refresh()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const remove = async (p: Product) => {
    const ok = await confirm({ title: `Удалить «${p.title}»?`, danger: true, confirmLabel: 'Удалить', text: 'Если по товару были заказы, он будет перемещён в архив, а история сохранится.' })
    if (ok === false) return
    try {
      const r = await api<{ archived?: boolean; detail?: string }>(`/products/${p.id}`, { method: 'DELETE' })
      toast(r.archived ? r.detail ?? 'Перемещён в архив' : 'Товар удалён')
      open(null)
      refresh()
    } catch (e) { toast(errMsg(e), 'error') }
  }
  const copy = async (id: number) => {
    setBusy(true)
    try {
      const c = await api<Product>(`/products/${id}/copy`, { method: 'POST' })
      toast('Создана скрытая копия — остаток и ключи не копируются')
      open(toForm(c))
      refresh()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const quick = async (p: Product, body: Record<string, unknown>) => {
    try { await api(`/products/${p.id}`, { method: 'PATCH', body }); refresh() } catch (e) { toast(errMsg(e), 'error') }
  }
  const quickStock = async (p: Product, stock: number) => {
    const reason = await confirm({ title: `Остаток «${p.title}»: ${p.stock} → ${stock}`, confirmLabel: 'Сохранить',
      input: { label: 'Причина (попадёт в историю остатков)', placeholder: 'Поступление, пересчёт…', required: true } })
    if (reason === false) return
    try {
      await api(`/products/${p.id}/stock`, { method: 'POST', body: { stock, reason } })
      toast(`Остаток: ${stock} шт`)
      refresh()
    } catch (e) { toast(errMsg(e), 'error') }
  }
  const runBulk = async () => {
    if (!bulk || !bulkDef) return
    const ids = [...selected].map(Number)
    const shown = bulkDef.input === 'status' ? STATUS[bulk.value as Product['status']]?.label : bulkDef.input === 'category' ? catTitle(bulk.value) : bulk.value
    const ok = await confirm({ title: bulkDef.input ? `${bulkDef.confirm}: ${shown}` : bulkDef.confirm, text: `Будет изменено товаров: ${ids.length}. Изменения сразу появятся в Mini App.` })
    if (ok === false) return
    setBusy(true)
    try {
      const r = await api<{ updated: number }>('/products/bulk', { method: 'POST', body: { ids, action: bulk.action, value: bulk.value.trim() } })
      toast(`Обновлено товаров: ${r.updated}`)
      setBulk(null)
      setSelected(new Set())
      refresh()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const toggle = (p: Product) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(p.id)) n.delete(p.id)
    else n.add(p.id)
    return n
  })
  const current = form?.id ? data?.find((x) => x.id === form.id) : undefined

  return (
    <>
      {hasInventory && summary.data && summary.data.length > 0 && (
        <InventorySummary rows={summary.data} onOpen={(product) => setDialog({ kind: 'inventory', product })} />
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput className="min-w-[200px] flex-1" value={search} onChange={setSearch} placeholder="Название, тег, страна или ID" />
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
          {canImport && <>
            <Btn variant="secondary" className="flex-1 sm:flex-none" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Импорт</Btn>
            <Btn variant="secondary" className="flex-1 sm:flex-none" onClick={() => download('/products/export.csv', 'products.csv').catch((e) => toast(errMsg(e), 'error'))}><Download className="h-4 w-4" /> Экспорт</Btn>
          </>}
          {can.edit && can.price && <Btn className="flex-1 sm:flex-none" onClick={() => open({ ...EMPTY, category: categories?.[0]?.slug ?? 'numbers' })}><Plus className="h-4 w-4" /> Товар</Btn>}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-elevated p-3 shadow-pop lg:top-4">
          <span className="text-sm font-semibold">Выбрано: {selected.size}</span>
          <select className="input h-10 w-auto flex-1 sm:flex-none" value={bulk?.action ?? ''} onChange={(e) => {
            const def = BULK.find((b) => b.value === e.target.value)
            setBulk(def ? { action: def.value, value: def.input === 'status' ? 'active' : def.input === 'category' ? (categories?.[0]?.slug ?? '') : '' } : null)
          }}>
            <option value="">{bulkOptions.length ? 'Действие…' : 'Нет доступных действий'}</option>
            {bulkOptions.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          {bulk && bulkDef?.input === 'status' && (
            <select className="input h-10 w-auto" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          )}
          {bulk && bulkDef?.input === 'category' && (
            <select className="input h-10 w-auto" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}>
              {categories?.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
            </select>
          )}
          {bulk && bulkDef?.input === 'number' && (
            <input className="input h-10 w-28" inputMode="decimal" autoFocus value={bulk.value} placeholder={bulkDef.placeholder} onChange={(e) => setBulk({ ...bulk, value: e.target.value.replace(',', '.') })} />
          )}
          {bulk && bulkDef?.input === 'text' && (
            <input className="input h-10 w-36" autoFocus maxLength={32} value={bulk.value} placeholder={bulkDef.placeholder} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} />
          )}
          <Btn disabled={!bulkDef || (Boolean(bulkDef.input) && !bulk?.value.trim())} loading={busy} onClick={runBulk}>Применить</Btn>
          <IconBtn label="Снять выделение" onClick={() => { setSelected(new Set()); setBulk(null) }}><X className="h-4 w-4" /></IconBtn>
          {bulk?.action === 'sale_percent' && <span className="w-full text-xs text-muted">Акционная цена = обычная цена минус указанный процент (1–95%). Срок акции задаётся в карточке товара.</span>}
          {bulk?.action.startsWith('stock') && <span className="w-full text-xs text-muted">Товары с выдачей из загруженных единиц так изменить нельзя — их остаток считается по ключам.</span>}
        </div>
      )}

      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable
        rows={rows} loading={loading} rowKey={(p) => p.id} onRowClick={(p) => open(toForm(p))}
        selected={selected} onToggle={toggle} onToggleAll={(all) => setSelected(all ? new Set(rows.map((p) => p.id)) : new Set())}
        emptyText={data?.length ? 'Ничего не найдено' : 'Товаров пока нет'}
        columns={[
          { header: 'Товар', cell: (p) => (
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-lg">{p.country?.flag ?? '📦'}</span>
              <div className="min-w-0">
                <div className="max-w-[260px] truncate font-semibold">{p.title}</div>
                <div className="text-xs text-muted">{p.country ? `${p.country.name} ${p.country.dial_code}` : `ID ${p.id}`} · {catTitle(p.category)}</div>
                <Tags tags={p.tags} />
              </div>
            </div>
          ) },
          { header: 'Цена', align: 'right', cell: (p) => <PriceCell p={p} onSave={can.price ? (v) => quick(p, { price: v }) : undefined} /> },
          { header: 'Остаток', align: 'right', cell: (p) => p.uses_inventory
            ? <KeysButton p={p} onClick={() => setDialog({ kind: 'inventory', product: p })} />
            : can.stock
              ? <InlineNumber value={p.stock} integer tone={stockTone(p.stock)} onSave={(v) => quickStock(p, Number(v))} />
              : <span className={clsx('tabular px-2 font-bold', stockTone(p.stock))}>{p.stock}</span> },
          { header: 'Статус', cell: (p) => <StatusBadges p={p} /> },
          { header: 'Топ', cell: (p) => (
            <button type="button" aria-label="Популярный" disabled={!can.edit} onClick={(e) => { e.stopPropagation(); void quick(p, { is_popular: !p.is_popular }) }} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/[0.05] disabled:cursor-default disabled:hover:bg-transparent">
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
            <div className="mt-2.5 flex items-center justify-between gap-2 text-sm">
              <PriceCell p={p} />
              {p.uses_inventory
                ? <KeysButton p={p} onClick={() => setDialog({ kind: 'inventory', product: p })} />
                : <span className={clsx('tabular font-semibold', stockTone(p.stock))}>{p.stock} шт</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={FULFILLMENT[p.fulfillment_mode]?.tone ?? 'gray'}>{FULFILLMENT[p.fulfillment_mode]?.short ?? p.fulfillment_mode}</Badge>
              <ScheduleBadge p={p} />
              <Tags tags={p.tags} inline />
            </div>
          </div>
        )}
      />

      <Modal open={form !== null} onClose={() => open(null)} size="lg" title={form?.id ? (can.edit ? 'Редактировать товар' : 'Товар') : 'Новый товар'}
        subtitle={form?.created_at ? `ID ${form.id} · создан ${dt(form.created_at)}` : undefined}
        footer={form && (can.edit ? <>
          {form.id && canDelete && current && <Btn variant="danger" className="mr-auto" onClick={() => remove(current)}><Trash2 className="h-4 w-4" /><span className="hidden sm:inline">Удалить</span></Btn>}
          {form.id && form.status !== 'archived' && <Btn variant="secondary" aria-label="В архив" onClick={() => setForm({ ...form, status: 'archived' })}><Archive className="h-4 w-4" /><span className="hidden sm:inline">В архив</span></Btn>}
          <Btn variant="secondary" className="hidden sm:inline-flex" onClick={() => open(null)}>Отмена</Btn>
          <Btn className="flex-1 sm:flex-none" loading={busy} onClick={save}>Сохранить</Btn>
        </> : <Btn variant="secondary" onClick={() => open(null)}>Закрыть</Btn>)}>
        {form && (
          <>
            {current && (
              <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1">
                {current.uses_inventory && <Btn size="sm" variant="secondary" onClick={() => setDialog({ kind: 'inventory', product: current })}><KeyRound className="h-4 w-4" /> Ключи</Btn>}
                {can.stock && !current.uses_inventory && <Btn size="sm" variant="secondary" onClick={() => setDialog({ kind: 'adjust', product: current })}><SlidersHorizontal className="h-4 w-4" /> Скорректировать остаток</Btn>}
                <Btn size="sm" variant="secondary" onClick={() => setDialog({ kind: 'price', product: current })}><LineChart className="h-4 w-4" /> История цен</Btn>
                <Btn size="sm" variant="secondary" onClick={() => setDialog({ kind: 'stock', product: current })}><History className="h-4 w-4" /> История остатков</Btn>
                {can.edit && <Btn size="sm" variant="secondary" loading={busy} onClick={() => copy(current.id)}><Copy className="h-4 w-4" /> Копировать</Btn>}
              </div>
            )}
            <ProductFields form={form} setForm={setForm} initial={initial} categories={categories} countries={countries} can={can} />
          </>
        )}
      </Modal>
      {dialog?.kind === 'inventory' && <InventoryPanel product={dialog.product} onClose={() => setDialog(null)} onChanged={refresh} />}
      {dialog?.kind === 'price' && <PriceHistoryDialog product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'stock' && <StockHistoryDialog product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'adjust' && <StockAdjustDialog product={dialog.product} onClose={() => setDialog(null)} onDone={(stock) => {
        refresh()
        // keep the open edit form in sync so saving it doesn't resend the old stock
        setForm((f) => f && { ...f, stock: String(stock), stock_reason: '' })
        setInitial((i) => i && { ...i, stock: String(stock) })
      }} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onDone={refresh} />}
    </>
  )
}

const stockTone = (n: number) => (n === 0 ? 'text-danger' : n <= 5 ? 'text-warning' : 'text-success')

function PriceCell({ p, onSave }: { p: Product; onSave?: (v: string | number) => void }) {
  if (saleActive(p)) {
    return (
      <span className="inline-flex flex-col items-end leading-tight" title={p.sale_ends_at ? `Акция до ${dt(p.sale_ends_at)}` : 'Акция без срока'}>
        <span className="tabular font-bold text-success">{money(p.sale_price)}</span>
        <s className="tabular text-xs text-muted">{money(p.price)}</s>
      </span>
    )
  }
  if (onSave) return <InlineNumber value={p.price} suffix="грн" onSave={onSave} />
  return <span className="tabular px-2 font-bold">{money(p.price)}</span>
}

function KeysButton({ p, onClick }: { p: Product; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick() }}
      className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold transition hover:bg-white/[0.06]', stockTone(p.stock))}>
      <KeyRound className="h-3.5 w-3.5" /> ключи: {p.stock} свободно
    </button>
  )
}

function ScheduleBadge({ p }: { p: Product }) {
  const s = schedule(p)
  return s ? <Badge tone={s.tone}>{s.label}</Badge> : null
}

function StatusBadges({ p }: { p: Product }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone={STATUS[p.status].tone} dot>{STATUS[p.status].label}</Badge>
      <Badge tone={FULFILLMENT[p.fulfillment_mode]?.tone ?? 'gray'}>{FULFILLMENT[p.fulfillment_mode]?.short ?? p.fulfillment_mode}</Badge>
      <ScheduleBadge p={p} />
    </div>
  )
}

function Tags({ tags, inline }: { tags: string[] | undefined; inline?: boolean }) {
  if (!tags?.length) return null
  const shown = tags.slice(0, 3)
  const items = <>
    {shown.map((t) => <span key={t} className="rounded-full bg-white/[0.06] px-2 py-px text-[11px] font-semibold text-muted">#{t}</span>)}
    {tags.length > shown.length && <span className="text-[11px] text-muted">+{tags.length - shown.length}</span>}
  </>
  return inline ? items : <div className="mt-1 flex max-w-[260px] flex-wrap gap-1">{items}</div>
}

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
