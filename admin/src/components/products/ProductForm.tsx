import clsx from 'clsx'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Field, IconBtn, Toggle } from '../ui'
import type { Category, Country, Product, ProductStatus } from '../../lib/types'
import { decimal, FULFILLMENT, isoToLocal, localToIso, type FulfillmentMode } from './shared'

export const PRODUCT_STATUS: Record<ProductStatus, { label: string; tone: 'green' | 'gray' | 'amber' }> = {
  active: { label: 'Активен', tone: 'green' }, hidden: { label: 'Скрыт', tone: 'gray' }, archived: { label: 'Архив', tone: 'amber' },
}

export const MAX_TAGS = 20
export const MAX_TAG_LEN = 32
export const MAX_ATTRS = 30

export type Form = {
  id?: number; title: string; description: string; category: string; country_id: number | null; price: string; stock: string
  stock_reason: string; status: ProductStatus; is_popular: boolean; sort_order: string; delivery_note: string; created_at?: string
  fulfillment_mode: FulfillmentMode; uses_inventory: boolean; sale_price: string; sale_ends_at: string
  tags: string[]; attributes: { key: string; value: string }[]
  available_from: string; available_until: string; max_per_order: string; max_per_user: string
  price_usd: string; price_stars: string; stars_enabled: boolean
}

export const EMPTY: Form = {
  title: '', description: '', category: 'numbers', country_id: null, price: '', stock: '0', stock_reason: '', status: 'active', is_popular: false,
  sort_order: '100', delivery_note: '', fulfillment_mode: 'manual', uses_inventory: false, sale_price: '', sale_ends_at: '', tags: [], attributes: [],
  available_from: '', available_until: '', max_per_order: '', max_per_user: '',
  price_usd: '', price_stars: '', stars_enabled: true,
}

export const toForm = (p: Product): Form => ({
  id: p.id, title: p.title, description: p.description, category: p.category, country_id: p.country_id, price: String(p.price),
  stock: String(p.stock), stock_reason: '', status: p.status, is_popular: p.is_popular, sort_order: String(p.sort_order), delivery_note: p.delivery_note,
  created_at: p.created_at, fulfillment_mode: p.fulfillment_mode ?? 'manual', uses_inventory: Boolean(p.uses_inventory),
  sale_price: p.sale_price === null || p.sale_price === undefined ? '' : String(p.sale_price), sale_ends_at: isoToLocal(p.sale_ends_at),
  tags: [...(p.tags ?? [])], attributes: Object.entries(p.attributes ?? {}).map(([key, value]) => ({ key, value: String(value) })),
  available_from: isoToLocal(p.available_from), available_until: isoToLocal(p.available_until),
  max_per_order: p.max_per_order ? String(p.max_per_order) : '', max_per_user: p.max_per_user ? String(p.max_per_user) : '',
  price_usd: p.price_usd === null || p.price_usd === undefined ? '' : String(p.price_usd),
  price_stars: p.price_stars ? String(p.price_stars) : '', stars_enabled: p.stars_enabled ?? true,
})

const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const attrsObj = (rows: Form['attributes']) => Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value.trim()]))

/** Client-side checks mirroring the server, so most mistakes are explained before the request. */
export function validate(f: Form, initial: Form | null): string | null {
  const price = Number(decimal(f.price))
  if (f.title.trim().length < 2) return 'Название — минимум 2 символа'
  if (!(price > 0)) return 'Укажите цену больше 0'
  if (f.sale_price.trim()) {
    const sale = Number(decimal(f.sale_price))
    if (!(sale > 0)) return 'Акционная цена должна быть больше 0'
    if (sale >= price) return 'Акционная цена должна быть ниже обычной'
  }
  if (f.price_usd.trim() && !(Number(decimal(f.price_usd)) > 0)) return 'Цена в USD должна быть больше 0'
  if (f.price_stars.trim() && !(Number.isInteger(Number(f.price_stars)) && Number(f.price_stars) >= 1)) return 'Цена в Stars — целое число от 1'
  if (f.available_from && f.available_until && new Date(f.available_from) >= new Date(f.available_until)) return 'Окончание продаж должно быть позже начала'
  const mpo = intOrNull(f.max_per_order)
  if (mpo !== null && !(mpo >= 1 && mpo <= 10)) return 'Максимум в заказе — от 1 до 10'
  const mpu = intOrNull(f.max_per_user)
  if (mpu !== null && !(mpu >= 1 && mpu <= 10000)) return 'Максимум на покупателя — от 1 до 10 000'
  const keys = f.attributes.map((a) => a.key.trim()).filter(Boolean)
  if (new Set(keys).size !== keys.length) return 'Названия характеристик не должны повторяться'
  if (f.attributes.some((a) => !a.key.trim() && a.value.trim())) return 'У характеристики со значением должно быть название'
  if (initial?.id && !f.uses_inventory && !initial.uses_inventory && f.stock !== initial.stock && f.stock_reason.trim().length < 3) {
    return 'Укажите причину изменения остатка (минимум 3 символа)'
  }
  return null
}

/** Full body for POST, or only the changed fields for PATCH. */
export function buildBody(f: Form, initial: Form | null): Record<string, unknown> {
  const all: Record<string, unknown> = {
    title: f.title.trim(), description: f.description, category: f.category, country_id: f.country_id, price: decimal(f.price),
    status: f.status, is_popular: f.is_popular, sort_order: Number(f.sort_order) || 0, delivery_note: f.delivery_note,
    fulfillment_mode: f.fulfillment_mode, uses_inventory: f.uses_inventory,
    sale_price: f.sale_price.trim() ? decimal(f.sale_price) : null, sale_ends_at: f.sale_price.trim() ? localToIso(f.sale_ends_at) : null,
    tags: f.tags, attributes: attrsObj(f.attributes),
    available_from: localToIso(f.available_from), available_until: localToIso(f.available_until),
    max_per_order: intOrNull(f.max_per_order), max_per_user: intOrNull(f.max_per_user),
    price_usd: f.price_usd.trim() ? decimal(f.price_usd) : null, price_stars: intOrNull(f.price_stars),
    stars_enabled: f.stars_enabled,
  }
  if (!initial?.id) return { ...all, stock: f.uses_inventory ? 0 : Number(f.stock) || 0 }
  const before = buildBody({ ...initial, id: undefined }, null)
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(all)) {
    if (k === 'price' ? Number(v) !== Number(before[k]) : JSON.stringify(v) !== JSON.stringify(before[k])) body[k] = v
  }
  if (!f.uses_inventory && !initial.uses_inventory && f.stock !== initial.stock) {
    body.stock = Number(f.stock) || 0
    body.stock_reason = f.stock_reason.trim()
  }
  return body
}

export function ProductFields({ form, setForm, initial, categories, countries, can }: {
  form: Form; setForm: (f: Form) => void; initial: Form | null; categories: Category[] | null; countries: Country[] | null
  can: { edit: boolean; price: boolean; stock: boolean }
}) {
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v })
  const country = countries?.find((x) => x.id === form.country_id)
  const isEdit = Boolean(form.id)
  const stockChanged = isEdit && !form.uses_inventory && !initial?.uses_inventory && form.stock !== initial?.stock
  const price = Number(decimal(form.price))
  const sale = Number(decimal(form.sale_price))
  const saleBad = form.sale_price.trim() !== '' && price > 0 && sale >= price
  const ro = !can.edit
  return (
    <fieldset disabled={ro} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {ro && <div className="rounded-xl bg-white/[0.04] px-4 py-3 text-sm text-muted sm:col-span-2">Только просмотр: нет права «Редактировать товары».</div>}
      <Field label="Название" className="sm:col-span-2"><input className="input" maxLength={128} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Номер США" /></Field>

      <Section title="Цена и акция" hint={can.price ? 'Изменение цены может быть ограничено лимитом вашей роли — сервер сообщит, если превышен.' : 'Нет права «Изменять цены» — поля только для просмотра.'} />
      <Field label="Цена, грн"><input className="input tabular" inputMode="decimal" disabled={!can.price} value={form.price} onChange={(e) => set('price', e.target.value)} /></Field>
      <Field label="Акционная цена, грн" hint={saleBad ? <span className="text-danger">Должна быть ниже обычной цены</span> : 'Пусто — без акции. Обычная цена будет показана зачёркнутой.'}>
        <input className={clsx('input tabular', saleBad && 'ring-1 ring-danger/60')} inputMode="decimal" disabled={!can.price} value={form.sale_price} placeholder="—" onChange={(e) => set('sale_price', e.target.value)} />
      </Field>
      <Field label="Акция действует до" hint="Пусто — пока не уберёте вручную" className="sm:col-span-2">
        <DateInput value={form.sale_ends_at} disabled={!can.price || !form.sale_price.trim()} onChange={(v) => set('sale_ends_at', v)} />
      </Field>
      <Field label="Цена, USD" hint="Справочная: показывается покупателю, оплаты в долларах нет">
        <input className="input tabular" inputMode="decimal" disabled={!can.price} value={form.price_usd} placeholder="—" onChange={(e) => set('price_usd', e.target.value)} />
      </Field>
      <Field label="Цена, Telegram Stars" hint="Ровно столько Stars выставляется в счёте. Пусто — по курсу из настроек оплаты">
        <input className="input tabular" inputMode="numeric" disabled={!can.price} value={form.price_stars} placeholder="—" onChange={(e) => set('price_stars', e.target.value.replace(/\D/g, ''))} />
      </Field>
      <label className="flex items-start gap-3 rounded-xl bg-white/[0.03] px-4 py-3 sm:col-span-2">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[#8B5CF6]" disabled={!can.price} checked={form.stars_enabled} onChange={(e) => set('stars_enabled', e.target.checked)} />
        <span className="text-sm"><span className="font-semibold">Разрешить оплату Telegram Stars для этого товара</span>
          <span className="mt-0.5 block text-xs text-muted">Выключайте для товаров, которые нельзя продавать за Stars по правилам Telegram.</span></span>
      </label>

      <Section title="Выдача" />
      <div className="sm:col-span-2">
        <span className="label">Как выдаётся товар</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(FULFILLMENT) as FulfillmentMode[]).map((m) => (
            <button key={m} type="button" onClick={() => set('fulfillment_mode', m)}
              className={clsx('rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed',
                form.fulfillment_mode === m ? 'border-primary/50 bg-primary/10' : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]')}>
              <div className="text-sm font-semibold">{FULFILLMENT[m].label}</div>
              <div className="mt-0.5 text-xs leading-snug text-muted">{FULFILLMENT[m].hint}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3 sm:col-span-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Выдача из загруженных единиц (ключи, коды)</div>
          <div className="mt-0.5 text-xs text-muted">
            {can.stock ? 'Остаток = число свободных единиц. Каждому покупателю выдаётся своя единица.' : 'Нет права «Управлять остатками и единицами».'}
          </div>
        </div>
        <Toggle checked={form.uses_inventory} disabled={!can.stock || ro} onChange={(v) => set('uses_inventory', v)} label="Выдача из загруженных единиц" />
      </div>
      {form.fulfillment_mode === 'auto' && !form.uses_inventory && (
        <div className="flex gap-2 rounded-xl bg-warning/10 px-4 py-3 text-xs text-warning sm:col-span-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Для автовыдачи обычно включают выдачу из загруженных единиц — иначе выдавать нечего.
        </div>
      )}
      {form.uses_inventory ? (
        <div className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-muted sm:col-span-2">
          {isEdit ? <>Свободных единиц: <b className="text-ink">{initial?.uses_inventory ? form.stock : 'пересчитается после сохранения'}</b>. Загрузка и списание — в разделе «Ключи».</>
            : 'Остаток появится после загрузки единиц (кнопка «Ключи» у сохранённого товара).'}
        </div>
      ) : (
        <>
          <Field label="Остаток, шт" hint={!can.stock ? 'Нет права «Управлять остатками»' : undefined}>
            <input className="input tabular" inputMode="numeric" disabled={!can.stock} value={form.stock} onChange={(e) => set('stock', e.target.value.replace(/\D/g, ''))} />
          </Field>
          {stockChanged ? (
            <Field label="Причина изменения остатка" hint={`Было ${initial?.stock} → станет ${form.stock || 0}. Попадёт в историю остатков.`}>
              <input className="input" maxLength={200} value={form.stock_reason} placeholder="Поступление, пересчёт…" onChange={(e) => set('stock_reason', e.target.value)} />
            </Field>
          ) : <div className="hidden sm:block" />}
        </>
      )}
      <Field label="Инструкция покупателю после оплаты" className="sm:col-span-2"
        hint={<span className="flex gap-1.5 text-warning"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />Никогда не указывайте здесь ключи, пароли и коды входа — текст одинаков для всех покупателей. Секреты загружайте как единицы.</span>}>
        <textarea className="input min-h-[80px]" maxLength={4000} value={form.delivery_note} onChange={(e) => set('delivery_note', e.target.value)} />
      </Field>

      <Section title="Ограничения и расписание" />
      <Field label="Максимум в одном заказе" hint="1–10, пусто — без ограничения">
        <input className="input tabular" inputMode="numeric" value={form.max_per_order} placeholder="—" onChange={(e) => set('max_per_order', e.target.value.replace(/\D/g, '').slice(0, 2))} />
      </Field>
      <Field label="Максимум на покупателя" hint="За всё время, пусто — без ограничения">
        <input className="input tabular" inputMode="numeric" value={form.max_per_user} placeholder="—" onChange={(e) => set('max_per_user', e.target.value.replace(/\D/g, '').slice(0, 5))} />
      </Field>
      <Field label="В продаже с" hint="Пусто — сразу"><DateInput value={form.available_from} onChange={(v) => set('available_from', v)} /></Field>
      <Field label="В продаже до" hint="Пусто — без срока"><DateInput value={form.available_until} onChange={(v) => set('available_until', v)} /></Field>

      <Section title="Каталог" />
      <Field label="Категория">
        <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
          {categories?.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
        </select>
      </Field>
      <Field label="Страна" hint={country ? `${country.flag} код ${country.dial_code}` : undefined}>
        <select className="input" value={form.country_id ?? ''} onChange={(e) => set('country_id', e.target.value ? Number(e.target.value) : null)}>
          <option value="">— без страны —</option>
          {countries?.map((c) => <option key={c.id} value={c.id}>{c.flag} {c.name} {c.dial_code}</option>)}
        </select>
      </Field>
      <Field label="Статус">
        <select className="input" value={form.status} onChange={(e) => set('status', e.target.value as ProductStatus)}>
          {Object.entries(PRODUCT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>
      <Field label="Порядок сортировки"><input className="input tabular" inputMode="numeric" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value.replace(/\D/g, ''))} /></Field>
      <Field label="Описание" className="sm:col-span-2"><textarea className="input min-h-[90px]" maxLength={4000} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <TagsInput tags={form.tags} onChange={(v) => set('tags', v)} />
      <AttributesEditor rows={form.attributes} onChange={(v) => set('attributes', v)} />
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3 sm:col-span-2">
        <span className="text-sm font-semibold">Показывать в «Популярном»</span>
        <Toggle checked={form.is_popular} disabled={ro} onChange={(v) => set('is_popular', v)} label="Популярный" />
      </div>
    </fieldset>
  )
}

function Section({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="-mb-1 mt-1 border-t border-white/[0.06] pt-4 sm:col-span-2">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{title}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

function DateInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-2">
      <input type="datetime-local" className="input min-w-0 flex-1 tabular" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && !disabled && <IconBtn label="Очистить" onClick={() => onChange('')}><X className="h-4 w-4" /></IconBtn>}
    </div>
  )
}

function TagsInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const full = tags.length >= MAX_TAGS
  const add = () => {
    const parts = draft.split(',').map((t) => t.trim().slice(0, MAX_TAG_LEN)).filter(Boolean)
    if (!parts.length) return
    const next = [...tags]
    for (const t of parts) if (!next.includes(t) && next.length < MAX_TAGS) next.push(t)
    onChange(next)
    setDraft('')
  }
  return (
    <div className="min-w-0 sm:col-span-2">
      <span className="label">Теги <span className="font-normal">· {tags.length}/{MAX_TAGS}</span></span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary/15 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-primary-soft">
            {t}
            <button type="button" aria-label={`Убрать тег ${t}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-white/10" onClick={() => onChange(tags.filter((x) => x !== t))}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input className="h-8 min-w-[120px] flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted disabled:cursor-not-allowed" value={draft} maxLength={MAX_TAG_LEN * 4}
          disabled={full} placeholder={full ? 'Достигнут лимит тегов' : 'Тег и Enter'}
          onChange={(e) => setDraft(e.target.value)} onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
            if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1))
          }} />
      </div>
      <span className="mt-1.5 block text-xs text-muted">До {MAX_TAGS} тегов, каждый до {MAX_TAG_LEN} символов. Показываются покупателю в карточке товара.</span>
    </div>
  )
}

function AttributesEditor({ rows, onChange }: { rows: Form['attributes']; onChange: (r: Form['attributes']) => void }) {
  const upd = (i: number, patch: Partial<Form['attributes'][number]>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="min-w-0 sm:col-span-2">
      <span className="label">Характеристики <span className="font-normal">· {rows.length}/{MAX_ATTRS}</span></span>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input className="input w-[40%] min-w-0" placeholder="Название" maxLength={64} value={r.key} onChange={(e) => upd(i, { key: e.target.value })} aria-label="Название характеристики" />
            <input className="input min-w-0 flex-1" placeholder="Значение" maxLength={200} value={r.value} onChange={(e) => upd(i, { value: e.target.value })} aria-label="Значение характеристики" />
            <IconBtn label="Удалить характеристику" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X className="h-4 w-4" /></IconBtn>
          </div>
        ))}
        <button type="button" disabled={rows.length >= MAX_ATTRS} onClick={() => onChange([...rows, { key: '', value: '' }])}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-primary-soft transition hover:bg-white/[0.05] disabled:opacity-40">
          <Plus className="h-4 w-4" /> Добавить характеристику
        </button>
      </div>
      <span className="mt-1.5 block text-xs text-muted">Например «Срок действия — 30 дней». Показываются покупателю в карточке товара.</span>
    </div>
  )
}
