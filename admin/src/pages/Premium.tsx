import { Eye, EyeOff, Plus, Trash2, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Btn, Chips, DataTable, ErrorBox, Field, Modal, PageHead, SearchInput, useConfirm, useToast, type Tone } from '../components/ui'
import { api, errMsg, money } from '../lib/api'
import type { Country, Premium as P } from '../lib/types'
import { useApi } from '../lib/useApi'

type Form = { id?: number; country_id: number | null; number: string; display_mask: string; tier: string; title: string; description: string; price: string; status: P['status'] }
const EMPTY: Form = { country_id: null, number: '', display_mask: '', tier: 'premium', title: 'PREMIUM NUMBER', description: '', price: '', status: 'available' }
const ST: Record<P['status'], { l: string; t: Tone }> = { available: { l: 'В наличии', t: 'green' }, reserved: { l: 'Забронирован', t: 'amber' }, sold: { l: 'Продан', t: 'violet' }, hidden: { l: 'Скрыт', t: 'gray' } }

export default function Premium() {
  const toast = useToast()
  const confirm = useConfirm()
  const { data, loading, error, reload } = useApi<P[]>('/premium-numbers')
  const { data: countries } = useApi<Country[]>('/countries')
  const [form, setForm] = useState<Form | null>(null)
  const [visible, setVisible] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'' | P['status']>('')
  const [search, setSearch] = useState('')
  const [reveal, setReveal] = useState(false)
  const rows = useMemo(() => (data ?? []).filter((n) => (!status || n.status === status)
    && (!search || n.display_mask.includes(search) || n.number.includes(search.replace(/\D/g, '') || '#'))), [data, status, search])

  const autoMask = async () => {
    if (!form) return
    const dial = countries?.find((c) => c.id === form.country_id)?.dial_code ?? ''
    try {
      const r = await api<{ mask: string }>('/premium-numbers/mask-preview', { method: 'POST', body: { number: form.number, dial_code: dial, visible: visible || null } })
      setForm({ ...form, display_mask: r.mask })
    } catch (e) { toast(errMsg(e), 'error') }
  }
  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      const { id, ...body } = form
      const payload: Record<string, unknown> = { ...body, display_mask: body.display_mask || null, price: body.price.replace(',', '.') }
      if (id && payload.status !== 'available' && payload.status !== 'hidden') delete payload.status
      await api(id ? `/premium-numbers/${id}` : '/premium-numbers', { method: id ? 'PATCH' : 'POST', body: payload })
      toast(id ? 'Номер обновлён' : 'Номер добавлен')
      setForm(null)
      reload(true)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const remove = async (n: P) => {
    if (await confirm({ title: `Удалить номер ${n.display_mask}?`, danger: true, confirmLabel: 'Удалить', text: 'Если номер участвовал в заказах, он будет скрыт, а история сохранится.' }) === false) return
    try { await api(`/premium-numbers/${n.id}`, { method: 'DELETE' }); toast('Готово'); setForm(null); reload(true) } catch (e) { toast(errMsg(e), 'error') }
  }
  const count = (s: P['status']) => data?.filter((n) => n.status === s).length ?? 0

  return (
    <div className="fade-in">
      <PageHead title="Красивые номера" subtitle="Маска — то, что видят покупатели. Полный номер открывается покупателю только после оплаты.">
        <Btn variant="secondary" onClick={() => setReveal((v) => !v)}>{reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {reveal ? 'Скрыть номера' : 'Показать номера'}</Btn>
        <Btn onClick={() => { setForm({ ...EMPTY }); setVisible('') }}><Plus className="h-4 w-4" /> Номер</Btn>
      </PageHead>
      <SearchInput className="mb-3" value={search} onChange={setSearch} placeholder="Поиск по цифрам" />
      <Chips className="mb-4" value={status} onChange={setStatus} options={[
        { value: '', label: 'Все', count: data?.length }, { value: 'available', label: 'В наличии', count: count('available') },
        { value: 'reserved', label: 'Бронь', count: count('reserved') }, { value: 'sold', label: 'Проданы', count: count('sold') }, { value: 'hidden', label: 'Скрытые', count: count('hidden') },
      ]} />
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable rows={rows} loading={loading} rowKey={(n) => n.id} onRowClick={(n) => { setForm({ ...n, price: String(n.price) }); setVisible('') }}
        columns={[
          { header: 'Маска', cell: (n) => <span className="whitespace-nowrap"><span className="mr-2 text-lg">{n.country?.flag ?? '🌐'}</span><span className="font-mono font-bold">{n.display_mask}</span></span> },
          { header: 'Полный номер', cell: (n) => <span className="font-mono text-muted">{reveal ? n.number : '••• скрыт'}</span> },
          { header: 'Уровень', cell: (n) => <Badge tone="violet">{n.tier.toUpperCase()}</Badge> },
          { header: 'Цена', align: 'right', cell: (n) => <span className="tabular font-bold">{money(n.price)}</span> },
          { header: 'Статус', cell: (n) => <Badge tone={ST[n.status].t} dot>{ST[n.status].l}</Badge> },
        ]}
        card={(n) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-mono font-bold">{n.country?.flag} {n.display_mask}</div>
              <div className="mt-0.5 text-xs text-muted">{n.tier.toUpperCase()} · {reveal ? n.number : 'номер скрыт'}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1"><span className="tabular font-bold">{money(n.price)}</span><Badge tone={ST[n.status].t}>{ST[n.status].l}</Badge></div>
          </div>
        )} />

      <Modal open={form !== null} onClose={() => setForm(null)} size="lg" title={form?.id ? 'Редактировать номер' : 'Новый красивый номер'}
        footer={form && <>
          {form.id && <Btn variant="danger" className="mr-auto" onClick={() => remove(data!.find((x) => x.id === form.id)!)}><Trash2 className="h-4 w-4" /> Удалить</Btn>}
          <Btn variant="secondary" onClick={() => setForm(null)}>Отмена</Btn><Btn loading={busy} onClick={save}>Сохранить</Btn>
        </>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Страна">
              <select className="input" value={form.country_id ?? ''} onChange={(e) => setForm({ ...form, country_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— не указана —</option>
                {countries?.map((c) => <option key={c.id} value={c.id}>{c.flag} {c.name} {c.dial_code}</option>)}
              </select>
            </Field>
            <Field label="Полный номер (скрыт от покупателей)"><input className="input font-mono" inputMode="tel" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="+1 415 777 7012" /></Field>
            <div className="rounded-2xl bg-white/[0.03] p-4 sm:col-span-2">
              <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto]">
                <Field label="Маска отображения"><input className="input font-mono" value={form.display_mask} onChange={(e) => setForm({ ...form, display_mask: e.target.value })} placeholder="+1 *** 7777 ***" /></Field>
                <Field label="Оставить видимым"><input className="input font-mono" inputMode="numeric" value={visible} onChange={(e) => setVisible(e.target.value)} placeholder="7777" /></Field>
                <div className="flex items-end"><Btn variant="secondary" className="h-11 w-full" onClick={autoMask} disabled={!form.number}><Wand2 className="h-4 w-4" /> Авто</Btn></div>
              </div>
              <p className="mt-2 text-xs text-muted">Скрывайте цифры символом *. Пустая маска сгенерируется автоматически.</p>
              {form.display_mask && (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-primary/10 px-4 py-3">
                  <span className="text-xs text-muted">Так увидит покупатель:</span>
                  <span className="font-mono text-lg font-bold">{form.display_mask}</span>
                </div>
              )}
            </div>
            <Field label="Уровень">
              <select className="input" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                <option value="premium">Premium</option><option value="gold">Gold</option><option value="platinum">Platinum</option><option value="vip">VIP</option>
              </select>
            </Field>
            <Field label="Цена, грн"><input className="input tabular" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Заголовок"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Статус" hint={form.status === 'reserved' || form.status === 'sold' ? 'Статус меняется через заказ' : undefined}>
              <select className="input" value={form.status} disabled={form.status === 'reserved' || form.status === 'sold'} onChange={(e) => setForm({ ...form, status: e.target.value as P['status'] })}>
                <option value="available">В наличии</option><option value="hidden">Скрыт</option>
                {(form.status === 'reserved' || form.status === 'sold') && <option value={form.status}>{ST[form.status].l}</option>}
              </select>
            </Field>
            <Field label="Описание" className="sm:col-span-2"><textarea className="input min-h-[70px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
