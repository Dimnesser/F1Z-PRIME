import { History, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Btn, PageHead, Skeleton, useToast } from '../components/ui'
import { api, dt } from '../lib/api'
import { useApi } from '../lib/useApi'

interface Row { key: string; value: string; description: string; is_public: boolean }
interface Action { id: number; admin: string; action: string; entity: string; entity_id: number | null; created_at: string }

export default function Settings() {
  const toast = useToast()
  const { data, loading } = useApi<Row[]>('/settings')
  const { data: actions } = useApi<Action[]>('/actions?limit=30')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setValues(Object.fromEntries(data.map((r) => [r.key, r.value]))) }, [data])

  const save = async () => {
    setBusy(true)
    try {
      await api('/settings', { method: 'PUT', body: { values } })
      toast('Настройки сохранены')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Settings" subtitle="Тексты витрины, способы оплаты и курс Telegram Stars">
        <Btn loading={busy} onClick={save}><Save className="h-4 w-4" /> Сохранить</Btn>
      </PageHead>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="card divide-y divide-white/[0.06]">
          {loading && <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
          {data?.map((r) => (
            <div key={r.key} className="grid gap-2 p-5 md:grid-cols-[260px_1fr] md:items-center">
              <div>
                <div className="text-sm font-semibold">{r.description}</div>
                <div className="font-mono text-xs text-muted">{r.key}</div>
              </div>
              {['stars_enabled', 'manual_enabled'].includes(r.key) ? (
                <select className="input" value={values[r.key] ?? ''} onChange={(e) => setValues({ ...values, [r.key]: e.target.value })}>
                  <option value="true">Включено</option><option value="false">Выключено</option>
                </select>
              ) : r.key === 'manual_payment_details' ? (
                <textarea className="input min-h-[90px]" value={values[r.key] ?? ''} onChange={(e) => setValues({ ...values, [r.key]: e.target.value })} />
              ) : (
                <input className="input" value={values[r.key] ?? ''} onChange={(e) => setValues({ ...values, [r.key]: e.target.value })} />
              )}
            </div>
          ))}
        </div>
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2 font-display font-semibold"><History className="h-4 w-4 text-primary-soft" /> Журнал действий</div>
          <div className="space-y-2.5">
            {actions?.length === 0 && <div className="text-sm text-muted">Пока пусто</div>}
            {actions?.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                <span><b>{a.admin}</b> <span className="text-muted">{a.action}</span> {a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</span>
                <span className="text-xs text-muted">{dt(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
