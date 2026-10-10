import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Btn, Field, Modal, PageHead, Table, Toggle, useToast } from '../components/ui'
import { api } from '../lib/api'
import type { Country } from '../lib/types'
import { useApi } from '../lib/useApi'

const EMPTY = { code: '', name: '', flag: '', dial_code: '+', sort_order: 100, is_active: true }

export default function Countries() {
  const toast = useToast()
  const { data, loading, reload } = useApi<Country[]>('/countries')
  const [edit, setEdit] = useState<(typeof EMPTY & { id?: number }) | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!edit) return
    setBusy(true)
    try {
      const { id, ...body } = edit
      await api(id ? `/countries/${id}` : '/countries', { method: id ? 'PATCH' : 'POST', body })
      toast(id ? 'Страна обновлена' : 'Страна добавлена')
      setEdit(null)
      reload()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const remove = async (c: Country) => {
    if (!confirm(`Удалить страну ${c.name}?`)) return
    try { await api(`/countries/${c.id}`, { method: 'DELETE' }); toast('Удалено'); reload() } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div>
      <PageHead title="Countries" subtitle="Страны каталога: флаг, код, порядок отображения">
        <Btn onClick={() => setEdit({ ...EMPTY })}><Plus className="h-4 w-4" /> Добавить страну</Btn>
      </PageHead>
      <Table loading={loading} empty={data?.length === 0} head={['Страна', 'ISO', 'Код', 'Порядок', 'Статус', '']}>
        {data?.map((c) => (
          <tr key={c.id} className="hover:bg-white/[0.02]">
            <td className="td"><span className="mr-2 text-xl">{c.flag}</span><span className="font-semibold">{c.name}</span></td>
            <td className="td font-mono text-muted">{c.code}</td>
            <td className="td font-mono">{c.dial_code}</td>
            <td className="td">{c.sort_order}</td>
            <td className="td">{c.is_active ? <Badge tone="green">Активна</Badge> : <Badge tone="gray">Скрыта</Badge>}</td>
            <td className="td text-right">
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" className="h-8 px-3" onClick={() => setEdit({ ...c })}><Pencil className="h-3.5 w-3.5" /></Btn>
                <Btn variant="danger" className="h-8 px-3" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></Btn>
              </div>
            </td>
          </tr>
        ))}
      </Table>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? 'Редактировать страну' : 'Новая страна'}>
        {edit && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Название" className="col-span-2"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Флаг (emoji)"><input className="input" value={edit.flag} onChange={(e) => setEdit({ ...edit, flag: e.target.value })} placeholder="🇺🇦" /></Field>
            <Field label="ISO код"><input className="input uppercase" maxLength={2} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="UA" /></Field>
            <Field label="Телефонный код"><input className="input" value={edit.dial_code} onChange={(e) => setEdit({ ...edit, dial_code: e.target.value })} placeholder="+380" /></Field>
            <Field label="Порядок"><input className="input" type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></Field>
            <div className="col-span-2 flex items-center justify-between rounded-xl bg-card px-4 py-3"><span className="text-sm font-semibold">Показывать в каталоге</span><Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} /></div>
            <Btn className="col-span-2 h-11" loading={busy} onClick={save}>Сохранить</Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
