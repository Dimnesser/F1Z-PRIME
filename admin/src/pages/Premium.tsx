import { Eye, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Btn, Field, Modal, PageHead, Table, useToast, type Tone } from '../components/ui'
import { api, money } from '../lib/api'
import type { Country, Premium as P } from '../lib/types'
import { useApi } from '../lib/useApi'

type Form = { id?: number; country_id: number | null; number: string; display_mask: string; tier: string; title: string; description: string; price: string; status: P['status'] }
const EMPTY: Form = { country_id: null, number: '', display_mask: '', tier: 'premium', title: 'PREMIUM NUMBER', description: '', price: '', status: 'available' }
const ST: Record<P['status'], { l: string; t: Tone }> = { available: { l: 'В наличии', t: 'green' }, reserved: { l: 'Забронирован', t: 'amber' }, sold: { l: 'Продан', t: 'violet' }, hidden: { l: 'Скрыт', t: 'gray' } }

export default function Premium() {
  const toast = useToast()
  const { data, loading, reload } = useApi<P[]>('/premium-numbers')
  const { data: countries } = useApi<Country[]>('/countries')
  const [form, setForm] = useState<Form | null>(null)
  const [visible, setVisible] = useState('')
  const [busy, setBusy] = useState(false)

  const autoMask = async () => {
    if (!form) return
    const dial = countries?.find((c) => c.id === form.country_id)?.dial_code ?? ''
    try {
      const r = await api<{ mask: string }>('/premium-numbers/mask-preview', { method: 'POST', body: { number: form.number, dial_code: dial, visible: visible || null } })
      setForm({ ...form, display_mask: r.mask })
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      const { id, ...body } = form
      const payload = { ...body, display_mask: body.display_mask || null }
      if (id && payload.status !== 'available' && payload.status !== 'hidden') delete (payload as Partial<Form>).status
      await api(id ? `/premium-numbers/${id}` : '/premium-numbers', { method: id ? 'PATCH' : 'POST', body: payload })
      toast(id ? 'Номер обновлён' : 'Номер добавлен')
      setForm(null)
      reload()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const remove = async (n: P) => {
    if (!confirm(`Удалить номер ${n.display_mask}?`)) return
    try { await api(`/premium-numbers/${n.id}`, { method: 'DELETE' }); toast('Готово'); reload() } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div>
      <PageHead title="Premium Numbers" subtitle="Красивые номера и маски отображения. Полный номер видит только покупатель после оплаты.">
        <Btn onClick={() => { setForm({ ...EMPTY }); setVisible('') }}><Plus className="h-4 w-4" /> Добавить номер</Btn>
      </PageHead>
      <Table loading={loading} empty={data?.length === 0} head={['Маска (видят покупатели)', 'Полный номер', 'Уровень', 'Цена', 'Статус', '']}>
        {data?.map((n) => (
          <tr key={n.id} className="hover:bg-white/[0.02]">
            <td className="td"><span className="mr-2 text-lg">{n.country?.flag ?? '🌐'}</span><span className="font-mono font-bold">{n.display_mask}</span></td>
            <td className="td font-mono text-muted">{n.number}</td>
            <td className="td"><Badge tone="violet">{n.tier.toUpperCase()}</Badge></td>
            <td className="td font-bold">{money(n.price)}</td>
            <td className="td"><Badge tone={ST[n.status].t}>{ST[n.status].l}</Badge></td>
            <td className="td">
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" className="h-8 px-3" onClick={() => { setForm({ ...n, price: String(n.price) }); setVisible('') }}><Pencil className="h-3.5 w-3.5" /></Btn>
                <Btn variant="danger" className="h-8 px-3" onClick={() => remove(n)}><Trash2 className="h-3.5 w-3.5" /></Btn>
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.id ? 'Редактировать номер' : 'Новый красивый номер'} wide>
        {form && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Страна">
              <select className="input" value={form.country_id ?? ''} onChange={(e) => setForm({ ...form, country_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— не указана —</option>
                {countries?.map((c) => <option key={c.id} value={c.id}>{c.flag} {c.name} {c.dial_code}</option>)}
              </select>
            </Field>
            <Field label="Полный номер (скрыт от покупателей)"><input className="input font-mono" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="+1 415 777 7012" /></Field>
            <div className="rounded-2xl bg-card p-4 ring-1 ring-white/[0.06] md:col-span-2">
              <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
                <Field label="Маска отображения"><input className="input font-mono" value={form.display_mask} onChange={(e) => setForm({ ...form, display_mask: e.target.value })} placeholder="+1 *** 7777 ***" /></Field>
                <Field label="Оставить видимым"><input className="input font-mono" value={visible} onChange={(e) => setVisible(e.target.value)} placeholder="7777" /></Field>
                <div className="flex items-end"><Btn variant="ghost" onClick={autoMask} disabled={!form.number}><Wand2 className="h-4 w-4" /> Авто</Btn></div>
              </div>
              <p className="mt-2 text-xs text-muted">Скрывайте цифры символом *. Пустая маска будет сгенерирована автоматически.</p>
              {form.display_mask && (
                <div className="mt-3 flex items-center gap-3 rounded-xl bg-brand-soft px-4 py-3 ring-1 ring-white/10">
                  <Eye className="h-4 w-4 text-primary-soft" />
                  <span className="text-xs text-muted">Предпросмотр:</span>
                  <span className="font-mono text-lg font-bold">{form.display_mask}</span>
                </div>
              )}
            </div>
            <Field label="Уровень">
              <select className="input" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                <option value="premium">Premium</option><option value="gold">Gold</option><option value="platinum">Platinum</option><option value="vip">VIP</option>
              </select>
            </Field>
            <Field label="Цена, грн"><input className="input" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Заголовок"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Статус">
              <select className="input" value={form.status} disabled={form.status === 'reserved' || form.status === 'sold'} onChange={(e) => setForm({ ...form, status: e.target.value as P['status'] })}>
                <option value="available">В наличии</option><option value="hidden">Скрыт</option>
                {(form.status === 'reserved' || form.status === 'sold') && <option value={form.status}>{ST[form.status].l}</option>}
              </select>
            </Field>
            <Field label="Описание" className="md:col-span-2"><textarea className="input min-h-[70px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Btn className="h-11 md:col-span-2" loading={busy} onClick={save}>Сохранить</Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
