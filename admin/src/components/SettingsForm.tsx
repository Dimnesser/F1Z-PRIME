import clsx from 'clsx'
import { Save } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, errMsg } from '../lib/api'
import type { SettingRow } from '../lib/types'
import { Btn, Card, Field, Skeleton, Toggle, useConfirm, useToast } from './ui'

export interface SettingField { key: string; label: string; hint?: ReactNode; multiline?: boolean; placeholder?: string; danger?: boolean; suffix?: string }

/** Shared settings editor: loads /settings, edits only the given keys, saves the changed ones in one PUT. */
export function useSettings() {
  const [rows, setRows] = useState<SettingRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api<SettingRow[]>('/settings').then((r) => { if (alive) setRows(r) }).catch((e) => { if (alive) setError(errMsg(e)) })
    return () => {
      alive = false
    }
  }, [])
  return { rows, setRows, error }
}

export function SettingsSection({ title, description, fields, rows, onSaved, readOnly }: {
  title: string; description?: string; fields: SettingField[]; rows: SettingRow[] | null; onSaved: (rows: SettingRow[]) => void; readOnly?: boolean
}) {
  const initial = useMemo(() => Object.fromEntries((rows ?? []).map((r) => [r.key, r.value])), [rows])
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  useEffect(() => { setValues(initial) }, [initial])
  const types = Object.fromEntries((rows ?? []).map((r) => [r.key, r.type]))
  const changed = fields.filter((f) => (values[f.key] ?? '') !== (initial[f.key] ?? ''))

  const save = async (patch?: Record<string, string>) => {
    const body = patch ?? Object.fromEntries(changed.map((f) => [f.key, values[f.key] ?? '']))
    if (!Object.keys(body).length) return
    const risky = fields.filter((f) => f.danger && body[f.key] !== undefined && body[f.key] !== initial[f.key])
    if (risky.length && await confirm({ title: 'Изменить важную настройку?', text: risky.map((f) => f.label).join(', '), danger: true }) === false) {
      setValues(initial)
      return
    }
    setBusy(true)
    try {
      onSaved(await api<SettingRow[]>('/settings', { method: 'PUT', body: { values: body } }))
      toast('Сохранено — изменения уже применены')
    } catch (e) {
      toast(errMsg(e), 'error')
      setValues(initial)
    } finally { setBusy(false) }
  }

  if (!rows) return <Skeleton className="h-48 rounded-2xl" />
  const textFields = fields.filter((f) => types[f.key] !== 'bool')
  const boolFields = fields.filter((f) => types[f.key] === 'bool')
  return (
    <Card title={title}>
      {description && <p className="-mt-2 mb-4 text-sm text-muted">{description}</p>}
      {boolFields.length > 0 && (
        <div className={clsx('divide-y divide-white/[0.05] rounded-xl bg-white/[0.02]', textFields.length && 'mb-4')}>
          {boolFields.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{f.label}</div>
                {f.hint && <div className="mt-0.5 text-xs text-muted">{f.hint}</div>}
              </div>
              <Toggle label={f.label} disabled={readOnly || busy} checked={values[f.key] === 'true'}
                onChange={(v) => { setValues((s) => ({ ...s, [f.key]: String(v) })); void save({ [f.key]: String(v) }) }} />
            </div>
          ))}
        </div>
      )}
      {textFields.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {textFields.map((f) => (
            <Field key={f.key} label={f.label + (f.suffix ? `, ${f.suffix}` : '')} hint={f.hint} className={clsx(f.multiline && 'sm:col-span-2')}>
              {f.multiline
                ? <textarea className="input min-h-[90px]" disabled={readOnly} value={values[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} />
                : <input className="input" disabled={readOnly} inputMode={types[f.key] === 'number' ? 'decimal' : undefined} value={values[f.key] ?? ''} placeholder={f.placeholder}
                    onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))} />}
            </Field>
          ))}
        </div>
      )}
      {!readOnly && textFields.length > 0 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {changed.length > 0 && <Btn variant="ghost" onClick={() => setValues(initial)}>Отменить</Btn>}
          <Btn loading={busy} disabled={!changed.length} onClick={() => save()}><Save className="h-4 w-4" /> Сохранить</Btn>
        </div>
      )}
    </Card>
  )
}
