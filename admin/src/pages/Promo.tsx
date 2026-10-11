import clsx from 'clsx'
import { Copy, Dices, Plus, ReceiptText, Tag, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  Badge, Btn, Chips, DataTable, Empty, ErrorBox, Field, IconBtn, Modal, OrderBadge, PageHead, SearchInput, Skeleton, Toggle,
  useConfirm, useToast, type Tone,
} from '../components/ui'
import { api, dt, errMsg, money } from '../lib/api'
import { useCan } from '../lib/session'
import type { Category, Product } from '../lib/types'
import { useApi } from '../lib/useApi'

type State = 'active' | 'scheduled' | 'expired' | 'exhausted' | 'disabled'
interface Promo {
  id: number; code: string; kind: 'percent' | 'fixed'; value: number; min_total: number | null; max_discount: number | null
  starts_at: string | null; ends_at: string | null; max_uses: number | null; max_uses_per_user: number; used_count: number
  product_ids: number[]; categories: string[]; first_order_only: boolean; is_active: boolean; note: string
  created_by: string | null; created_at: string; state: State; discount_total: number; paid_orders: number
}
interface Redemption { order_id: number; public_id: string | null; status: string; discount: number; total: number; user: string; created_at: string }

const STATE: Record<State, { label: string; tone: Tone }> = {
  active: { label: 'Активен', tone: 'green' },
  scheduled: { label: 'Запланирован', tone: 'cyan' },
  expired: { label: 'Истёк', tone: 'gray' },
  exhausted: { label: 'Исчерпан', tone: 'amber' },
  disabled: { label: 'Выключен', tone: 'red' },
}

type Form = {
  id?: number; code: string; kind: 'percent' | 'fixed'; value: string; min_total: string; max_discount: string
  starts_at: string; ends_at: string; max_uses: string; max_uses_per_user: string; first_order_only: boolean
  product_ids: number[]; categories: string[]; note: string; is_active: boolean; used_count?: number; created_at?: string
}
const EMPTY: Form = {
  code: '', kind: 'percent', value: '', min_total: '', max_discount: '', starts_at: '', ends_at: '', max_uses: '',
  max_uses_per_user: '1', first_order_only: false, product_ids: [], categories: [], note: '', is_active: true,
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function randomCode(len = 8): string {
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => ALPHABET[n % ALPHABET.length]).join('')
}
/** ISO (UTC) → value for <input type="datetime-local"> in the admin's local time */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null)
const dec = (v: string) => v.trim().replace(',', '.')
const discountLabel = (p: { kind: string; value: number }) => (p.kind === 'percent' ? `−${p.value}%` : `−${money(p.value)}`)

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch { return false }
  }
}

export default function Promo() {
  const canManage = useCan('promo.manage')
  const { data, loading, error, reload } = useApi<Promo[]>(canManage ? '/promo-codes' : null)
  const canProducts = useCan('products.view')
  const { data: products } = useApi<Product[]>(canManage && canProducts ? '/products' : null)
  const { data: categories } = useApi<Category[]>(canManage && canProducts ? '/categories' : null)
  const [state, setState] = useState<'' | State>('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [redemptions, setRedemptions] = useState<Promo | null>(null)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': data?.length ?? 0 }
    for (const p of data ?? []) c[p.state] = (c[p.state] ?? 0) + 1
    return c
  }, [data])
  const rows = useMemo(() => {
    const term = search.trim().toUpperCase()
    return (data ?? []).filter((p) => (!state || p.state === state) && (!term || p.code.includes(term) || p.note.toUpperCase().includes(term)))
  }, [data, state, search])
  const catTitle = (slug: string) => categories?.find((c) => c.slug === slug)?.title ?? slug
  const productTitle = (id: number) => products?.find((p) => p.id === id)?.title ?? `#${id}`

  const scopeText = (p: Promo) => {
    const parts: string[] = []
    if (p.product_ids.length) parts.push(p.product_ids.length <= 2 ? p.product_ids.map(productTitle).join(', ') : `${p.product_ids.length} товаров`)
    if (p.categories.length) parts.push(p.categories.map(catTitle).join(', '))
    return parts.length ? parts.join(' · ') : 'Весь каталог'
  }
  const windowText = (p: Promo) => {
    if (!p.starts_at && !p.ends_at) return 'Бессрочно'
    if (p.starts_at && p.ends_at) return `${dt(p.starts_at)} — ${dt(p.ends_at)}`
    return p.starts_at ? `с ${dt(p.starts_at)}` : `до ${dt(p.ends_at)}`
  }

  const copy = async (code: string) => {
    if (await copyText(code)) toast(`Скопировано: ${code}`)
    else toast('Не удалось скопировать', 'error')
  }

  const openEdit = (p: Promo) => {
    setFormErr(null)
    setForm({
      id: p.id, code: p.code, kind: p.kind, value: String(p.value), min_total: p.min_total === null ? '' : String(p.min_total),
      max_discount: p.max_discount === null ? '' : String(p.max_discount), starts_at: toLocalInput(p.starts_at), ends_at: toLocalInput(p.ends_at),
      max_uses: p.max_uses === null ? '' : String(p.max_uses), max_uses_per_user: String(p.max_uses_per_user),
      first_order_only: p.first_order_only, product_ids: [...p.product_ids], categories: [...p.categories], note: p.note,
      is_active: p.is_active, used_count: p.used_count, created_at: p.created_at,
    })
  }

  const save = async () => {
    if (!form) return
    setFormErr(null)
    const value = Number(dec(form.value))
    if (!form.id && !/^[A-Z0-9_-]{3,32}$/.test(form.code)) { setFormErr('Код: 3–32 символа A–Z, 0–9, _ и -'); return }
    if (!(value > 0)) { setFormErr('Укажите размер скидки больше 0'); return }
    if (form.kind === 'percent' && value > 95) { setFormErr('Скидка в процентах — не более 95%'); return }
    for (const [label, v] of [['Минимальная сумма', form.min_total], ['Максимальная скидка', form.max_discount]] as const) {
      if (v.trim() && !(Number(dec(v)) > 0)) { setFormErr(`${label}: число больше 0 или пусто`); return }
    }
    if (form.starts_at && form.ends_at && new Date(form.starts_at) >= new Date(form.ends_at)) { setFormErr('Окончание действия должно быть позже начала'); return }
    const perUser = Number(form.max_uses_per_user)
    if (!(perUser >= 1)) { setFormErr('Лимит на покупателя — не меньше 1'); return }
    const common = {
      value: dec(form.value),
      min_total: form.min_total.trim() ? dec(form.min_total) : null,
      max_discount: form.kind === 'percent' && form.max_discount.trim() ? dec(form.max_discount) : null,
      starts_at: fromLocalInput(form.starts_at), ends_at: fromLocalInput(form.ends_at),
      max_uses: form.max_uses.trim() ? Number(form.max_uses) : null, max_uses_per_user: perUser,
      product_ids: form.product_ids, categories: form.categories, first_order_only: form.first_order_only,
      is_active: form.is_active, note: form.note.trim(),
    }
    setBusy(true)
    try {
      if (form.id) await api(`/promo-codes/${form.id}`, { method: 'PATCH', body: common })
      else await api('/promo-codes', { method: 'POST', body: { code: form.code, kind: form.kind, ...common } })
      toast(form.id ? 'Промокод сохранён' : `Промокод ${form.code} создан`)
      setForm(null)
      reload(true)
    } catch (e) { setFormErr(errMsg(e)) } finally { setBusy(false) }
  }

  const remove = async (p: Promo) => {
    const ok = await confirm({
      title: `Удалить промокод ${p.code}?`, danger: true, confirmLabel: 'Удалить',
      text: p.used_count > 0 || p.paid_orders > 0
        ? 'Промокод уже применялся в заказах — он будет выключен, а история заказов сохранится.'
        : 'Промокод ещё не использовался и будет удалён полностью.',
    })
    if (ok === false) return
    try {
      const r = await api<{ deleted: boolean; disabled?: boolean }>(`/promo-codes/${p.id}`, { method: 'DELETE' })
      toast(r.deleted ? `Промокод ${p.code} удалён` : `Промокод ${p.code} уже использовался — он выключен, история сохранена`, r.deleted ? 'success' : 'info')
      setForm(null)
      reload(true)
    } catch (e) { toast(errMsg(e), 'error') }
  }

  if (!canManage) {
    return (
      <div className="fade-in">
        <PageHead title="Промокоды" />
        <div className="card"><Empty icon={Tag} title="Нет доступа" text="Для работы с промокодами нужно право «promo.manage»." /></div>
      </div>
    )
  }

  const usage = (p: Promo) => (
    <span className="tabular">{p.used_count}<span className="text-muted"> / {p.max_uses ?? '∞'}</span></span>
  )

  return (
    <div className="fade-in">
      <PageHead title="Промокоды" subtitle="Скидка рассчитывается только на сервере; отменённый неоплаченный заказ возвращает активацию.">
        <Btn className="w-full sm:w-auto" onClick={() => { setFormErr(null); setForm({ ...EMPTY, code: randomCode() }) }}><Plus className="h-4 w-4" /> Промокод</Btn>
      </PageHead>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput className="min-w-[200px] flex-1" value={search} onChange={setSearch} placeholder="Код или заметка" />
      </div>
      <Chips className="mb-4" value={state} onChange={setState} options={[
        { value: '', label: 'Все', count: counts[''] },
        ...(Object.keys(STATE) as State[]).map((k) => ({ value: k, label: STATE[k].label, count: counts[k] ?? 0 })),
      ]} />
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable
        rows={rows} loading={loading} rowKey={(p) => p.id} onRowClick={openEdit}
        emptyText={data?.length ? 'Ничего не найдено' : 'Промокодов пока нет'}
        columns={[
          { header: 'Код', cell: (p) => (
            <div className="flex items-center gap-1">
              <span className="font-mono font-bold tracking-wide">{p.code}</span>
              <IconBtn label="Скопировать код" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); void copy(p.code) }}><Copy className="h-3.5 w-3.5" /></IconBtn>
            </div>
          ) },
          { header: 'Статус', cell: (p) => <Badge tone={STATE[p.state].tone} dot>{STATE[p.state].label}</Badge> },
          { header: 'Скидка', cell: (p) => (
            <div className="leading-tight">
              <div className="font-bold text-primary-soft">{discountLabel(p)}</div>
              <div className="text-xs text-muted">
                {[p.min_total !== null && `от ${money(p.min_total)}`, p.max_discount !== null && `макс. ${money(p.max_discount)}`, p.first_order_only && '1-й заказ'].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
          ) },
          { header: 'Использовано', cell: (p) => (
            <div className="leading-tight"><div>{usage(p)}</div><div className="text-xs text-muted">{p.max_uses_per_user} на покупателя</div></div>
          ) },
          { header: 'Период', cell: (p) => <span className="text-xs text-muted">{windowText(p)}</span> },
          { header: 'Действует на', cell: (p) => <span className="block max-w-[180px] truncate text-xs text-muted" title={scopeText(p)}>{scopeText(p)}</span> },
          { header: 'Результат', align: 'right', cell: (p) => (
            <div className="leading-tight"><div className="tabular font-semibold">{money(p.discount_total)}</div><div className="text-xs text-muted">{p.paid_orders} оплач.</div></div>
          ) },
          { header: '', align: 'right', cell: (p) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <IconBtn label="Применения" onClick={() => setRedemptions(p)}><ReceiptText className="h-4 w-4" /></IconBtn>
              <IconBtn label="Удалить" onClick={() => void remove(p)}><Trash2 className="h-4 w-4" /></IconBtn>
            </div>
          ) },
        ]}
        card={(p) => (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono text-[15px] font-bold tracking-wide">{p.code}</span>
                <IconBtn label="Скопировать код" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); void copy(p.code) }}><Copy className="h-3.5 w-3.5" /></IconBtn>
              </div>
              <Badge tone={STATE[p.state].tone}>{STATE[p.state].label}</Badge>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-sm">
              <span className="font-bold text-primary-soft">{discountLabel(p)}</span>
              <span>{usage(p)} <span className="text-xs text-muted">исп.</span></span>
            </div>
            <div className="mt-1 text-xs text-muted">{windowText(p)} · {scopeText(p)}</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">Скидок: <b className="tabular text-ink">{money(p.discount_total)}</b> · {p.paid_orders} оплач.</span>
              <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setRedemptions(p) }}><ReceiptText className="h-4 w-4" /> Применения</Btn>
            </div>
          </div>
        )}
      />

      <Modal open={form !== null} onClose={() => setForm(null)} size="lg" title={form?.id ? `Промокод ${form.code}` : 'Новый промокод'}
        subtitle={form?.id ? `Использован ${form.used_count} раз · создан ${dt(form.created_at)}` : 'Код и тип скидки нельзя изменить после создания'}
        footer={form && <>
          {form.id && <Btn variant="danger" className="mr-auto" onClick={() => { const p = data?.find((x) => x.id === form.id); if (p) void remove(p) }}><Trash2 className="h-4 w-4" /><span className="hidden sm:inline">Удалить</span></Btn>}
          <Btn variant="secondary" className="hidden sm:inline-flex" onClick={() => setForm(null)}>Отмена</Btn>
          <Btn className="flex-1 sm:flex-none" loading={busy} onClick={save}>Сохранить</Btn>
        </>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Код" hint={form.id ? 'Нельзя изменить' : 'A–Z, 0–9, _ и -, от 3 до 32 символов'}>
              <div className="flex gap-2">
                <input className="input font-mono uppercase tracking-wide" disabled={Boolean(form.id)} maxLength={32} value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="SPRING10" />
                {!form.id && <Btn variant="secondary" aria-label="Сгенерировать" title="Сгенерировать" onClick={() => setForm({ ...form, code: randomCode() })}><Dices className="h-4 w-4" /><span className="hidden sm:inline">Сгенерировать</span></Btn>}
              </div>
            </Field>
            <Field label="Тип скидки" hint={form.id ? 'Нельзя изменить' : undefined}>
              <select className="input" disabled={Boolean(form.id)} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Form['kind'] })}>
                <option value="percent">Процент от суммы</option><option value="fixed">Фиксированная сумма, грн</option>
              </select>
            </Field>
            <Field label={form.kind === 'percent' ? 'Скидка, %' : 'Скидка, грн'} hint={form.kind === 'percent' ? 'До 95%' : 'Заказ после скидки — не меньше 1 грн'}>
              <input className="input tabular" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </Field>
            <Field label="Минимальная сумма заказа, грн" hint="Пусто — без ограничения">
              <input className="input tabular" inputMode="decimal" value={form.min_total} onChange={(e) => setForm({ ...form, min_total: e.target.value })} />
            </Field>
            {form.kind === 'percent' && (
              <Field label="Максимальная скидка, грн" hint="Пусто — без ограничения">
                <input className="input tabular" inputMode="decimal" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: e.target.value })} />
              </Field>
            )}
            <Field label="Всего активаций" hint="Пусто — без лимита">
              <input className="input tabular" inputMode="numeric" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value.replace(/\D/g, '').slice(0, 7) })} />
            </Field>
            <Field label="Активаций на покупателя">
              <input className="input tabular" inputMode="numeric" value={form.max_uses_per_user} onChange={(e) => setForm({ ...form, max_uses_per_user: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </Field>
            <Field label="Начало действия" hint="Пусто — сразу">
              <input className="input" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
            </Field>
            <Field label="Окончание действия" hint="Пусто — бессрочно">
              <input className="input" type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
            </Field>

            <div className="sm:col-span-2">
              <span className="label">Категории</span>
              {categories ? (
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => {
                    const on = form.categories.includes(c.slug)
                    return (
                      <button key={c.slug} type="button" className={clsx('chip', on && 'chip-active')}
                        onClick={() => setForm({ ...form, categories: on ? form.categories.filter((x) => x !== c.slug) : [...form.categories, c.slug] })}>{c.title}</button>
                    )
                  })}
                  {form.categories.filter((s) => !categories.some((c) => c.slug === s)).map((s) => (
                    <button key={s} type="button" className="chip chip-active" onClick={() => setForm({ ...form, categories: form.categories.filter((x) => x !== s) })}>{s} ×</button>
                  ))}
                </div>
              ) : <p className="text-xs text-muted">{canProducts ? 'Загрузка…' : 'Нет доступа к списку категорий'}{form.categories.length ? ` · выбрано: ${form.categories.join(', ')}` : ''}</p>}
              <span className="mt-1.5 block text-xs text-muted">Ничего не выбрано — промокод действует на все категории</span>
            </div>
            <div className="sm:col-span-2">
              <ProductPicker products={products} canView={canProducts} value={form.product_ids} onChange={(ids) => setForm({ ...form, product_ids: ids })} />
            </div>

            <Field label="Заметка" className="sm:col-span-2" hint="Видна только в панели">
              <input className="input" maxLength={255} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Рассылка в канале, октябрь" />
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3">
              <span className="text-sm font-semibold">Только первый заказ</span>
              <Toggle checked={form.first_order_only} onChange={(v) => setForm({ ...form, first_order_only: v })} label="Только первый заказ" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3">
              <span className="text-sm font-semibold">Включён</span>
              <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Включён" />
            </div>
            {formErr && <div className="sm:col-span-2"><ErrorBox text={formErr} /></div>}
          </div>
        )}
      </Modal>

      {redemptions && <RedemptionsDialog promo={redemptions} onClose={() => setRedemptions(null)} />}
    </div>
  )
}

function ProductPicker({ products, canView, value, onChange }: { products: Product[] | null; canView: boolean; value: number[]; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (products ?? [])
      .filter((p) => p.status !== 'archived' || value.includes(p.id))
      .filter((p) => !term || p.title.toLowerCase().includes(term) || String(p.id) === term)
  }, [products, q, value])
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label mb-0">Товары {value.length > 0 && <span className="text-ink">· выбрано {value.length}</span>}</span>
        {value.length > 0 && <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={() => onChange([])}>Сбросить</button>}
      </div>
      {!canView ? (
        <p className="text-xs text-muted">Нет доступа к списку товаров{value.length ? ` · выбраны ID: ${value.join(', ')}` : ''}</p>
      ) : !products ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="rounded-xl border border-white/[0.06]">
          <div className="border-b border-white/[0.06] p-2"><SearchInput value={q} onChange={setQ} placeholder="Найти товар" /></div>
          <div className="max-h-52 overflow-y-auto overscroll-contain p-1">
            {list.length === 0 && <div className="px-3 py-4 text-center text-sm text-muted">Ничего не найдено</div>}
            {list.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-white/[0.04]">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
                <span className="min-w-0 flex-1 truncate text-sm">{p.country?.flag ? `${p.country.flag} ` : ''}{p.title}</span>
                <span className="tabular text-xs text-muted">{money(p.price)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <span className="mt-1.5 block text-xs text-muted">Ничего не выбрано — промокод действует на все товары (с учётом категорий)</span>
    </div>
  )
}

function RedemptionsDialog({ promo, onClose }: { promo: Promo; onClose: () => void }) {
  const { data, loading, error, reload } = useApi<Redemption[]>(`/promo-codes/${promo.id}/redemptions?limit=500`)
  return (
    <Modal open onClose={onClose} size="xl" title={<span className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-muted" /> Применения {promo.code}</span>}
      subtitle={`Активаций ${promo.used_count} · оплачено заказов ${promo.paid_orders} · скидок ${money(promo.discount_total)}`}>
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable rows={data} loading={loading} rowKey={(r) => r.order_id} emptyText="Промокод ещё не применялся"
        columns={[
          { header: 'Заказ', cell: (r) => <span className="font-mono font-semibold">{r.public_id ?? `#${r.order_id}`}</span> },
          { header: 'Статус', cell: (r) => <OrderBadge status={r.status} /> },
          { header: 'Скидка', align: 'right', cell: (r) => <span className="tabular text-primary-soft">−{money(r.discount)}</span> },
          { header: 'Итого', align: 'right', cell: (r) => <span className="tabular font-semibold">{money(r.total)}</span> },
          { header: 'Покупатель', cell: (r) => <span className="text-muted">{/^\d+$/.test(r.user) ? r.user : `@${r.user}`}</span> },
          { header: 'Дата', cell: (r) => <span className="whitespace-nowrap text-xs text-muted">{dt(r.created_at)}</span> },
        ]}
        card={(r) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold">{r.public_id ?? `#${r.order_id}`}</span>
              <OrderBadge status={r.status} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-sm">
              <span className="tabular text-primary-soft">−{money(r.discount)}</span>
              <span className="tabular font-semibold">{money(r.total)}</span>
            </div>
            <div className="mt-1 text-xs text-muted">{/^\d+$/.test(r.user) ? r.user : `@${r.user}`} · {dt(r.created_at)}</div>
          </div>
        )} />
    </Modal>
  )
}
