import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Btn, DataTable, ErrorBox, Field, Modal, PageHead, Toggle, useConfirm, useToast } from '../components/ui'
import { api, errMsg } from '../lib/api'
import type { Country } from '../lib/types'
import { useApi } from '../lib/useApi'

const EMPTY = { code: '', name: '', flag: '', dial_code: '+', sort_order: 100, is_active: true }

export default function Countries() {
  const toast = useToast()
  const confirm = useConfirm()
  const { data, loading, error, reload } = useApi<Country[]>('/countries')
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
      reload(true)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const remove = async (c: Country) => {
    if (await confirm({ title: `Удалить страну ${c.name}?`, danger: true, confirmLabel: 'Удалить' }) === false) return
    try { await api(`/countries/${c.id}`, { method: 'DELETE' }); toast('Удалено'); setEdit(null); reload(true) } catch (e) { toast(errMsg(e), 'error') }
  }

  return (
    <div className="fade-in">
      <PageHead title="Страны" subtitle="Флаг, телефонный код и порядок в каталоге">
        <Btn onClick={() => setEdit({ ...EMPTY })}><Plus className="h-4 w-4" /> Страна</Btn>
      </PageHead>
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable rows={data} loading={loading} rowKey={(c) => c.id} onRowClick={(c) => setEdit({ ...c })}
        columns={[
          { header: 'Страна', cell: (c) => <span className="whitespace-nowrap"><span className="mr-2 text-xl">{c.flag}</span><span className="font-semibold">{c.name}</span></span> },
          { header: 'ISO', cell: (c) => <span className="font-mono text-muted">{c.code}</span> },
          { header: 'Код', cell: (c) => <span className="font-mono">{c.dial_code}</span> },
          { header: 'Порядок', cell: (c) => c.sort_order },
          { header: 'Статус', cell: (c) => c.is_active ? <Badge tone="green" dot>Активна</Badge> : <Badge tone="gray" dot>Скрыта</Badge> },
        ]}
        card={(c) => (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate"><span className="mr-2 text-xl">{c.flag}</span><span className="font-semibold">{c.name}</span> <span className="font-mono text-sm text-muted">{c.dial_code}</span></span>
            {c.is_active ? <Badge tone="green">Вкл</Badge> : <Badge tone="gray">Скрыта</Badge>}
          </div>
        )} />
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit?.id ? 'Редактировать страну' : 'Новая страна'}
        footer={edit && <>
          {edit.id && <Btn variant="danger" className="mr-auto" onClick={() => remove(data!.find((c) => c.id === edit.id)!)}><Trash2 className="h-4 w-4" /></Btn>}
          <Btn variant="secondary" onClick={() => setEdit(null)}>Отмена</Btn><Btn loading={busy} onClick={save}>Сохранить</Btn>
        </>}>
        {edit && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Название" className="col-span-2"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Флаг (emoji)"><input className="input" value={edit.flag} onChange={(e) => setEdit({ ...edit, flag: e.target.value })} placeholder="🇺🇦" /></Field>
            <Field label="ISO код"><input className="input uppercase" maxLength={2} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="UA" /></Field>
            <Field label="Телефонный код"><input className="input" inputMode="tel" value={edit.dial_code} onChange={(e) => setEdit({ ...edit, dial_code: e.target.value })} placeholder="+380" /></Field>
            <Field label="Порядок"><input className="input" inputMode="numeric" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
            <div className="col-span-2 flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3"><span className="text-sm font-semibold">Показывать в каталоге</span><Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Показывать" /></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
