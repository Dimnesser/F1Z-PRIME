import { Check, Pencil, Plus, Star, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Btn, Field, Modal, PageHead, Table, Toggle, useToast } from '../components/ui'
import { api, money } from '../lib/api'
import type { Country, Product } from '../lib/types'
import { useApi } from '../lib/useApi'

type Form = { id?: number; title: string; description: string; category: string; country_id: number | null; price: string; stock: number; status: Product['status']; is_popular: boolean; sort_order: number; delivery_note: string }
const EMPTY: Form = { title: '', description: '', category: 'numbers', country_id: null, price: '', stock: 0, status: 'active', is_popular: false, sort_order: 100, delivery_note: '' }
const STATUS = { active: { l: 'Активен' }, hidden: { l: 'Скрыт' }, archived: { l: 'Архив' } }

export default function Products() {
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [countryId, setCountryId] = useState('')
  const qs = new URLSearchParams()
  if (status) qs.set('status', status)
  if (countryId) qs.set('country_id', countryId)
  const { data, loading, reload } = useApi<Product[]>(`/products?${qs}`)
  const { data: countries } = useApi<Country[]>('/countries')
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [inline, setInline] = useState<{ id: number; price: string; stock: string } | null>(null)

  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      const { id, ...body } = form
      await api(id ? `/products/${id}` : '/products', { method: id ? 'PATCH' : 'POST', body })
      toast(id ? 'Товар обновлён' : 'Товар создан')
      setForm(null)
      reload()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const saveInline = async () => {
    if (!inline) return
    try {
      await api(`/products/${inline.id}`, { method: 'PATCH', body: { price: inline.price, stock: Number(inline.stock) } })
      toast('Цена и остаток обновлены — изменения уже в Mini App')
      setInline(null)
      reload()
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const remove = async (p: Product) => {
    if (!confirm(`Удалить «${p.title}»?`)) return
    try {
      const r = await api<{ archived?: boolean; detail?: string }>(`/products/${p.id}`, { method: 'DELETE' })
      toast(r.archived ? r.detail ?? 'Перемещён в архив' : 'Товар удалён')
      reload()
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const quick = async (p: Product, body: Partial<Form>) => {
    try { await api(`/products/${p.id}`, { method: 'PATCH', body }); reload() } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div>
      <PageHead title="Products" subtitle="Цены, остатки и статусы товаров. Изменения сразу видны в Mini App.">
        <select className="input w-40" value={countryId} onChange={(e) => setCountryId(e.target.value)}>
          <option value="">Все страны</option>
          {countries?.map((c) => <option key={c.id} value={c.id}>{c.flag} {c.name}</option>)}
        </select>
        <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option><option value="active">Активные</option><option value="hidden">Скрытые</option><option value="archived">Архив</option>
        </select>
        <Btn onClick={() => setForm({ ...EMPTY })}><Plus className="h-4 w-4" /> Новый товар</Btn>
      </PageHead>
      <Table loading={loading} empty={data?.length === 0} head={['Товар', 'Категория', 'Цена', 'Остаток', 'Статус', 'Топ', '']}>
        {data?.map((p) => {
          const editing = inline?.id === p.id
          return (
            <tr key={p.id} className="hover:bg-white/[0.02]">
              <td className="td">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-lg">{p.country?.flag ?? '📦'}</span>
                  <div><div className="font-semibold">{p.title}</div><div className="text-xs text-muted">{p.country ? `${p.country.name} ${p.country.dial_code}` : 'Без страны'}</div></div>
                </div>
              </td>
              <td className="td text-muted">{p.category}</td>
              <td className="td">
                {editing ? <input className="input h-8 w-24" type="number" value={inline.price} onChange={(e) => setInline({ ...inline, price: e.target.value })} autoFocus />
                  : <button className="font-bold hover:text-primary-soft" onClick={() => setInline({ id: p.id, price: String(p.price), stock: String(p.stock) })}>{money(p.price)}</button>}
              </td>
              <td className="td">
                {editing ? <input className="input h-8 w-20" type="number" value={inline.stock} onChange={(e) => setInline({ ...inline, stock: e.target.value })} />
                  : <button className={p.stock > 0 ? 'font-semibold text-success' : 'font-semibold text-danger'} onClick={() => setInline({ id: p.id, price: String(p.price), stock: String(p.stock) })}>{p.stock}</button>}
              </td>
              <td className="td">
                <select className={`rounded-full px-2.5 py-1 text-[12px] font-bold outline-none ring-1 ${p.status === 'active' ? 'bg-success/15 text-success ring-success/25' : 'bg-white/[0.06] text-muted ring-white/10'}`} value={p.status} onChange={(e) => quick(p, { status: e.target.value as Product['status'] })}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k} className="bg-surface">{v.l}</option>)}
                </select>
              </td>
              <td className="td"><button onClick={() => quick(p, { is_popular: !p.is_popular })}><Star className={p.is_popular ? 'h-4 w-4 fill-warning text-warning' : 'h-4 w-4 text-muted'} /></button></td>
              <td className="td">
                <div className="flex justify-end gap-2">
                  {editing ? (<>
                    <Btn variant="success" className="h-8 px-3" onClick={saveInline}><Check className="h-3.5 w-3.5" /></Btn>
                    <Btn variant="ghost" className="h-8 px-3" onClick={() => setInline(null)}><X className="h-3.5 w-3.5" /></Btn>
                  </>) : (<>
                    <Btn variant="ghost" className="h-8 px-3" onClick={() => setForm({ ...p, price: String(p.price) })}><Pencil className="h-3.5 w-3.5" /></Btn>
                    <Btn variant="danger" className="h-8 px-3" onClick={() => remove(p)}><Trash2 className="h-3.5 w-3.5" /></Btn>
                  </>)}
                </div>
              </td>
            </tr>
          )
        })}
      </Table>

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.id ? 'Редактировать товар' : 'Новый товар'} wide>
        {form && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Название" className="md:col-span-2"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Страна">
              <select className="input" value={form.country_id ?? ''} onChange={(e) => setForm({ ...form, country_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— без страны —</option>
                {countries?.map((c) => <option key={c.id} value={c.id}>{c.flag} {c.name} {c.dial_code}</option>)}
              </select>
            </Field>
            <Field label="Категория">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="numbers">numbers — номера по странам</option><option value="digital">digital — цифровые товары</option><option value="services">services — сервисы</option>
              </select>
            </Field>
            <Field label="Цена, грн"><input className="input" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Количество (остаток)"><input className="input" type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} /></Field>
            <Field label="Статус">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Product['status'] })}>
                <option value="active">Активен</option><option value="hidden">Скрыт</option><option value="archived">Архив</option>
              </select>
            </Field>
            <Field label="Порядок"><input className="input" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></Field>
            <Field label="Описание" className="md:col-span-2"><textarea className="input min-h-[80px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Инструкция покупателю после оплаты" className="md:col-span-2"><textarea className="input min-h-[70px]" value={form.delivery_note} onChange={(e) => setForm({ ...form, delivery_note: e.target.value })} /></Field>
            <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3 md:col-span-2"><span className="text-sm font-semibold">Показывать в «Популярном»</span><Toggle checked={form.is_popular} onChange={(v) => setForm({ ...form, is_popular: v })} /></div>
            <Btn className="h-11 md:col-span-2" loading={busy} onClick={save}>Сохранить</Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
