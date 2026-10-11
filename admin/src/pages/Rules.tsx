import clsx from 'clsx'
import { CheckCircle2, FlaskConical, History, Plus, ShieldAlert, Trash2, Workflow, X, XCircle } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import {
  Badge, Btn, DataTable, Empty, ErrorBox, Field, IconBtn, Modal, PageHead, Skeleton, Toggle, useConfirm, useToast,
} from '../components/ui'
import { ago, api, ApiError, dt, errMsg } from '../lib/api'
import { useCan } from '../lib/session'
import { useApi } from '../lib/useApi'

// limits mirror backend/app/services/rules.py (MAX_CONDITIONS / MAX_ACTIONS); the server checks them again
const MAX_CONDITIONS = 10
const MAX_ACTIONS = 5

type FieldType = 'number' | 'string' | 'list' | 'bool'
interface Catalog {
  triggers: { key: string; label: string }[]
  fields: { key: string; label: string; type: FieldType; events: string[] }[]
  operators: { key: string; label: string; types: FieldType[] }[]
  actions: { key: string; label: string; events: string[]; params: { name: string; type: string; required: boolean }[] }[]
}
type CondValue = string | number | boolean | (string | number)[]
interface Cond { field: string; op: string; value: CondValue }
interface Action { type: string; params: Record<string, string> }
interface Rule {
  id: number; name: string; trigger: string; trigger_label: string; match: 'all' | 'any'; conditions: Cond[]; actions: Action[]
  actions_text: string[]; is_active: boolean; priority: number; runs: number; matches: number; failures: number
  last_run_at: string | null; version: number; created_by: string | null; updated_by: string | null; created_at: string
}
interface RunRow {
  id: number; event: string; entity_id: number; matched: boolean; dry_run: boolean; created_at: string
  result: { conditions?: (Cond & { actual: unknown; ok: boolean })[]; actions?: { action: string; ok: boolean; result?: string; error?: string }[] } | null
}
interface DryRun { entity_id: number; matched: boolean; conditions: (Cond & { actual: unknown; ok: boolean })[]; would_run: string[] }
interface PermCatalog { groups: { name: string; permissions: { code: string; label: string }[] }[] }
interface Template { key: string; audience: string; title: string; enabled: boolean }
interface Account { id: number; username: string; display_name: string | null; is_active: boolean }

type FormCond = { field: string; op: string; value: string }
type Form = {
  id?: number; version?: number; name: string; trigger: string; match: 'all' | 'any'
  conditions: FormCond[]; actions: Action[]; is_active: boolean; priority: string
}

const PRIORITY: Record<string, string> = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', urgent: 'Срочный' }
const ORDER_VARS = ['{order_no}', '{order_id}', '{product_name}', '{price}', '{customer_name}', '{status}']
const TICKET_VARS = ['{ticket_id}', '{reason}']

const fmtValue = (v: unknown, type?: FieldType): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  if (Array.isArray(v)) return v.length ? v.map((x) => fmtValue(x, type)).join(', ') : '—'
  return String(v)
}
const toFormValue = (v: CondValue): string => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? String(v) : String(v ?? ''))

export default function Rules() {
  const canEdit = useCan('system.automation')
  const { data: catalog, error: catError } = useApi<Catalog>('/rules/catalog')
  const { data, loading, error, reload, setData } = useApi<Rule[]>('/rules')
  const [form, setForm] = useState<Form | null>(null)
  const [history, setHistory] = useState<Rule | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const fieldOf = (key: string) => catalog?.fields.find((f) => f.key === key)
  const opOf = (key: string) => catalog?.operators.find((o) => o.key === key)
  const condText = (c: Cond) => {
    const f = fieldOf(c.field)
    return `${f?.label ?? c.field} ${opOf(c.op)?.label ?? c.op} ${fmtValue(c.value, f?.type)}`
  }

  const toggle = async (r: Rule, v: boolean) => {
    try {
      const updated = await api<Rule>(`/rules/${r.id}/toggle`, { method: 'POST', body: { is_active: v } })
      setData((rows) => rows?.map((x) => (x.id === r.id ? updated : x)) ?? rows)
      toast(v ? 'Правило включено' : 'Правило выключено')
    } catch (e) { toast(errMsg(e), 'error') }
  }
  const remove = async (r: Rule) => {
    const ok = await confirm({ title: `Удалить правило «${r.name}»?`, danger: true, confirmLabel: 'Удалить', text: 'История запусков правила тоже будет недоступна. Чтобы временно остановить правило, достаточно его выключить.' })
    if (ok === false) return
    try {
      await api(`/rules/${r.id}`, { method: 'DELETE' })
      toast('Правило удалено')
      setForm(null)
      reload(true)
    } catch (e) { toast(errMsg(e), 'error') }
  }
  const openNew = () => {
    const trigger = catalog?.triggers[0]?.key ?? 'order_paid'
    setForm({ name: '', trigger, match: 'all', conditions: [], actions: [], is_active: false, priority: '100' })
  }
  const openEdit = (r: Rule) => setForm({
    id: r.id, version: r.version, name: r.name, trigger: r.trigger, match: r.match,
    conditions: r.conditions.map((c) => ({ field: c.field, op: c.op, value: toFormValue(c.value) })),
    actions: r.actions.map((a) => ({ type: a.type, params: Object.fromEntries(Object.entries(a.params ?? {}).map(([k, v]) => [k, String(v)])) })),
    is_active: r.is_active, priority: String(r.priority),
  })

  const conditionsSummary = (r: Rule) => {
    if (!r.conditions.length) return <span className="text-muted">Всегда (без условий)</span>
    const joiner = r.match === 'all' ? ' и ' : ' или '
    return <span>{r.conditions.map(condText).join(joiner)}</span>
  }

  return (
    <div className="fade-in">
      <PageHead title="Правила автоматизации" subtitle="КОГДА произошло событие → ЕСЛИ выполнены условия → ТОГДА выполнить действия">
        {canEdit && <Btn className="w-full sm:w-auto" disabled={!catalog} onClick={openNew}><Plus className="h-4 w-4" /> Правило</Btn>}
      </PageHead>
      <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-muted">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
        <span>Правила не проводят денежные операции и не выдают товары — оплата, возвраты и выдача всегда проходят обычные проверки сервера. Действия правил не запускают другие правила.</span>
      </div>
      {(error || catError) && <div className="mb-3"><ErrorBox text={error ?? catError ?? ''} onRetry={() => reload()} /></div>}
      <DataTable
        rows={data} loading={loading} rowKey={(r) => r.id}
        onRowClick={(r) => (canEdit && catalog ? openEdit(r) : setHistory(r))}
        emptyText="Правил пока нет"
        columns={[
          { header: 'Правило', cell: (r) => (
            <div className="min-w-0 max-w-[240px]">
              <div className="truncate font-semibold">{r.name}</div>
              <div className="truncate text-xs text-muted">Когда: {r.trigger_label} · порядок {r.priority}</div>
            </div>
          ) },
          { header: 'Условия', cell: (r) => <div className="max-w-[280px] text-[13px] leading-snug">{conditionsSummary(r)}</div> },
          { header: 'Действия', cell: (r) => (
            <ul className="max-w-[280px] space-y-0.5 text-[13px] leading-snug">{r.actions_text.map((t, i) => <li key={i} className="line-clamp-2">→ {t}</li>)}</ul>
          ) },
          { header: 'Запуски', cell: (r) => <Stats r={r} /> },
          { header: 'Последний', cell: (r) => <span className="whitespace-nowrap text-xs text-muted" title={dt(r.last_run_at)}>{r.last_run_at ? ago(r.last_run_at) : 'не запускалось'}</span> },
          { header: 'Активно', cell: (r) => (
            <div onClick={(e) => e.stopPropagation()}>
              <Toggle checked={r.is_active} disabled={!canEdit} onChange={(v) => void toggle(r, v)} label="Активно" />
            </div>
          ) },
          { header: '', align: 'right', cell: (r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <IconBtn label="История запусков" onClick={() => setHistory(r)}><History className="h-4 w-4" /></IconBtn>
              {canEdit && <IconBtn label="Удалить" onClick={() => void remove(r)}><Trash2 className="h-4 w-4" /></IconBtn>}
            </div>
          ) },
        ]}
        card={(r) => (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{r.name}</div>
                <div className="text-xs text-muted">Когда: {r.trigger_label}</div>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Toggle checked={r.is_active} disabled={!canEdit} onChange={(v) => void toggle(r, v)} label="Активно" />
              </div>
            </div>
            <div className="mt-2 text-[13px] leading-snug"><span className="text-muted">Если: </span>{conditionsSummary(r)}</div>
            <ul className="mt-1 space-y-0.5 text-[13px] leading-snug">{r.actions_text.map((t, i) => <li key={i}>→ {t}</li>)}</ul>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <Stats r={r} />
              <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setHistory(r) }}><History className="h-4 w-4" /> История</Btn>
            </div>
          </div>
        )}
      />

      {form && catalog && (
        <Builder form={form} setForm={setForm} catalog={catalog}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); reload(true) }}
          onConflict={() => { setForm(null); reload(true) }}
          onDelete={form.id ? () => { const r = data?.find((x) => x.id === form.id); if (r) void remove(r) } : undefined} />
      )}
      {history && catalog && <RunsDialog rule={history} catalog={catalog} condText={condText} onClose={() => setHistory(null)} />}
    </div>
  )
}

function Stats({ r }: { r: Rule }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="tabular text-muted" title="Проверок">{r.runs} пров.</span>
      <Badge tone={r.matches ? 'cyan' : 'gray'}>{r.matches} срабат.</Badge>
      {r.failures > 0 && <Badge tone="red">{r.failures} ошиб.</Badge>}
    </div>
  )
}

// ------------------------------------------------------------------ builder

function Builder({ form, setForm, catalog, onClose, onSaved, onConflict, onDelete }: {
  form: Form; setForm: (f: Form) => void; catalog: Catalog; onClose: () => void; onSaved: () => void; onConflict: () => void; onDelete?: () => void
}) {
  const canStaff = useCan('staff.manage')
  const canTemplates = useCan('notifications.manage')
  const { data: perms } = useApi<PermCatalog>('/staff/permissions')
  const { data: templates, error: tplError } = useApi<Template[]>(canTemplates ? '/notification-templates' : null)
  const { data: accounts } = useApi<Account[]>(canStaff ? '/accounts' : null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dry, setDry] = useState<{ entity: string; result: DryRun | null; error: string | null; busy: boolean }>({ entity: '', result: null, error: null, busy: false })
  const toast = useToast()

  const fields = catalog.fields.filter((f) => f.events.includes(form.trigger))
  const actions = catalog.actions.filter((a) => a.events.includes(form.trigger))
  const fieldOf = (key: string) => catalog.fields.find((f) => f.key === key)
  const opsFor = (type: FieldType | undefined) => catalog.operators.filter((o) => type && o.types.includes(type))
  const customerTemplates = (templates ?? []).filter((t) => t.audience === 'customer')
  const vars = form.trigger === 'ticket_created' ? TICKET_VARS : ORDER_VARS

  const update = (patch: Partial<Form>) => { setForm({ ...form, ...patch }); setDry((d) => ({ ...d, result: null, error: null })) }
  const setCond = (i: number, c: FormCond) => update({ conditions: form.conditions.map((x, j) => (j === i ? c : x)) })
  const setAction = (i: number, a: Action) => update({ actions: form.actions.map((x, j) => (j === i ? a : x)) })

  const changeTrigger = (trigger: string) => {
    const conditions = form.conditions.filter((c) => fieldOf(c.field)?.events.includes(trigger))
    const acts = form.actions.filter((a) => catalog.actions.find((x) => x.key === a.type)?.events.includes(trigger))
    if (conditions.length !== form.conditions.length || acts.length !== form.actions.length) {
      toast('Убраны условия и действия, недоступные для выбранного события', 'info')
    }
    update({ trigger, conditions, actions: acts })
  }
  const newCond = (): FormCond => {
    const f = fields[0]
    const op = opsFor(f?.type)[0]
    return { field: f?.key ?? '', op: op?.key ?? '', value: f?.type === 'bool' ? 'true' : '' }
  }
  const changeField = (i: number, key: string) => {
    const f = fieldOf(key)
    const cur = form.conditions[i]
    const ops = opsFor(f?.type)
    const op = ops.some((o) => o.key === cur.op) ? cur.op : ops[0]?.key ?? ''
    const sameType = fieldOf(cur.field)?.type === f?.type
    setCond(i, { field: key, op, value: sameType ? cur.value : f?.type === 'bool' ? 'true' : '' })
  }
  const newAction = (): Action => {
    const a = actions.find((x) => !form.actions.some((y) => y.type === x.key)) ?? actions[0]
    return { type: a?.key ?? '', params: defaultParams(a?.key ?? '') }
  }
  const defaultParams = (key: string): Record<string, string> => {
    const a = catalog.actions.find((x) => x.key === key)
    const p: Record<string, string> = {}
    for (const prm of a?.params ?? []) {
      if (prm.name === 'priority') p.priority = 'high'
      else if (prm.name === 'template') p.template = customerTemplates[0]?.key ?? ''
      else p[prm.name] = ''
    }
    return p
  }

  const condPayload = (c: FormCond) => {
    const type = fieldOf(c.field)?.type
    if (c.op === 'in' || c.op === 'not_in') return { ...c, value: c.value.split(',').map((x) => x.trim()).filter(Boolean) }
    if (type === 'bool') return { ...c, value: c.value === 'true' }
    return { ...c, value: type === 'number' ? c.value.trim().replace(',', '.') : c.value.trim() }
  }
  const actionPayload = (a: Action) => ({
    type: a.type,
    params: Object.fromEntries(Object.entries(a.params).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()])),
  })
  const localCheck = (): string | null => {
    for (const c of form.conditions) {
      if (!c.field || !c.op) return 'Выберите поле и оператор в каждом условии'
      if (c.value.trim() === '') return `Укажите значение для условия «${fieldOf(c.field)?.label ?? c.field}»`
      if (fieldOf(c.field)?.type === 'number') {
        const parts = c.op === 'in' || c.op === 'not_in' ? c.value.split(',').map((x) => x.trim()).filter(Boolean) : [c.value.trim()]
        if (parts.some((x) => Number.isNaN(Number(x.replace(',', '.'))))) return `«${fieldOf(c.field)?.label}»: значение должно быть числом`
      }
    }
    return null
  }

  const save = async () => {
    setErr(null)
    if (form.name.trim().length < 2) { setErr('Название — от 2 символов'); return }
    if (!form.actions.length) { setErr('Добавьте хотя бы одно действие'); return }
    const local = localCheck()
    if (local) { setErr(local); return }
    for (const a of form.actions) {
      const def = catalog.actions.find((x) => x.key === a.type)
      const miss = def?.params.find((p) => p.required && !(a.params[p.name] ?? '').trim())
      if (miss) { setErr(`«${def?.label}»: заполните поле «${PARAM_LABEL[miss.name] ?? miss.name}»`); return }
    }
    const body = {
      name: form.name.trim(), trigger: form.trigger, match: form.match, conditions: form.conditions.map(condPayload),
      actions: form.actions.map(actionPayload), is_active: form.is_active,
      priority: Math.min(10000, Math.max(0, Number(form.priority) || 0)),
      ...(form.id ? { version: form.version } : {}),
    }
    setBusy(true)
    try {
      await api(form.id ? `/rules/${form.id}` : '/rules', { method: form.id ? 'PATCH' : 'POST', body })
      toast(form.id ? 'Правило сохранено' : form.is_active ? 'Правило создано и включено' : 'Правило создано (выключено)')
      onSaved()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { toast(e.message, 'error'); onConflict(); return }
      setErr(errMsg(e))
    } finally { setBusy(false) }
  }

  const runDry = async () => {
    const local = localCheck()
    if (local) { setDry((d) => ({ ...d, error: local, result: null })); return }
    const entity = Number(dry.entity)
    setDry((d) => ({ ...d, busy: true, error: null, result: null }))
    try {
      const result = await api<DryRun>('/rules/dry-run', {
        method: 'POST',
        body: {
          trigger: form.trigger, match: form.match, conditions: form.conditions.map(condPayload),
          actions: form.actions.filter((a) => a.type).map(actionPayload), entity_id: entity > 0 ? entity : null,
        },
      })
      setDry((d) => ({ ...d, busy: false, result }))
    } catch (e) { setDry((d) => ({ ...d, busy: false, error: errMsg(e) })) }
  }

  const paramInput = (a: Action, i: number, name: string, required: boolean) => {
    const v = a.params[name] ?? ''
    const set = (val: string) => setAction(i, { ...a, params: { ...a.params, [name]: val } })
    const label = `${PARAM_LABEL[name] ?? name}${required ? '' : ' (необязательно)'}`
    if (name === 'text') {
      return (
        <Field key={name} label={label} hint={<>Можно вставить переменные: {vars.map((x) => (
          <button key={x} type="button" className="mr-1 rounded bg-white/[0.06] px-1 font-mono text-[11px] text-ink hover:bg-white/[0.1]" onClick={() => set(v + x)}>{x}</button>
        ))} · до 1000 символов</>}>
          <textarea className="input min-h-[80px]" maxLength={1000} value={v} onChange={(e) => set(e.target.value)}
            placeholder={form.trigger === 'ticket_created' ? 'Новое обращение {ticket_id}: {reason}' : 'Заказ {order_no} на {price} — {product_name}'} />
        </Field>
      )
    }
    if (name === 'permission') {
      return (
        <Field key={name} label="Кому: сотрудникам с правом" hint="По умолчанию — всем, кто видит заказы">
          <select className="input" value={v} onChange={(e) => set(e.target.value)}>
            <option value="">По умолчанию (просмотр заказов)</option>
            {perms?.groups.map((g) => (
              <optgroup key={g.name} label={g.name}>{g.permissions.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</optgroup>
            ))}
            {v && perms && !perms.groups.some((g) => g.permissions.some((p) => p.code === v)) && <option value={v}>{v}</option>}
          </select>
        </Field>
      )
    }
    if (name === 'template') {
      if (canTemplates && !tplError) {
        return (
          <Field key={name} label="Шаблон сообщения покупателю" hint="Текст шаблона редактируется в разделе уведомлений. Выключенный шаблон не отправляется.">
            <select className="input" value={v} onChange={(e) => set(e.target.value)}>
              <option value="">— выберите шаблон —</option>
              {customerTemplates.map((t) => <option key={t.key} value={t.key}>{t.title}{t.enabled ? '' : ' (выключен)'}</option>)}
              {v && templates && !customerTemplates.some((t) => t.key === v) && <option value={v}>{v}</option>}
            </select>
          </Field>
        )
      }
      return (
        <Field key={name} label="Ключ шаблона покупателю" hint="Нет доступа к списку шаблонов — введите ключ шаблона (например, order_paid)">
          <input className="input font-mono" value={v} onChange={(e) => set(e.target.value.trim())} />
        </Field>
      )
    }
    if (name === 'priority') {
      return (
        <Field key={name} label="Новый приоритет">
          <select className="input" value={v} onChange={(e) => set(e.target.value)}>
            {Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      )
    }
    if (name === 'username') {
      if (canStaff && accounts) {
        return (
          <Field key={name} label="Сотрудник">
            <select className="input" value={v} onChange={(e) => set(e.target.value)}>
              <option value="">— выберите сотрудника —</option>
              {accounts.filter((acc) => acc.is_active || acc.username === v).map((acc) => (
                <option key={acc.id} value={acc.username}>{acc.display_name ? `${acc.display_name} (${acc.username})` : acc.username}</option>
              ))}
            </select>
          </Field>
        )
      }
      return (
        <Field key={name} label="Логин сотрудника" hint="Должен совпадать с логином активной учётной записи">
          <input className="input font-mono" value={v} onChange={(e) => set(e.target.value.trim())} />
        </Field>
      )
    }
    return (
      <Field key={name} label={label}><input className="input" value={v} onChange={(e) => set(e.target.value)} /></Field>
    )
  }

  return (
    <Modal open onClose={onClose} size="xl" title={form.id ? 'Редактировать правило' : 'Новое правило'}
      subtitle={form.id ? `ID ${form.id} · версия ${form.version}` : 'Правило создаётся выключенным, если не включить его явно'}
      footer={<>
        {onDelete && <Btn variant="danger" className="mr-auto" onClick={onDelete}><Trash2 className="h-4 w-4" /><span className="hidden sm:inline">Удалить</span></Btn>}
        <Btn variant="secondary" className="hidden sm:inline-flex" onClick={onClose}>Отмена</Btn>
        <Btn className="flex-1 sm:flex-none" loading={busy} onClick={save}>Сохранить</Btn>
      </>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field label="Название"><input className="input" maxLength={80} value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="Крупный заказ — сообщить менеджеру" /></Field>
          <Field label="Порядок выполнения" hint="Меньше — раньше"><input className="input tabular" inputMode="numeric" value={form.priority} onChange={(e) => update({ priority: e.target.value.replace(/\D/g, '').slice(0, 5) })} /></Field>
        </div>

        <Section step="Когда" text="Событие, на которое реагирует правило">
          <select className="input" value={form.trigger} onChange={(e) => changeTrigger(e.target.value)}>
            {catalog.triggers.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Section>

        <Section step="Если" text={form.conditions.length ? undefined : 'Без условий правило срабатывает на каждое событие'}
          right={form.conditions.length > 1 && (
            <select className="input h-9 w-auto text-[13px]" value={form.match} onChange={(e) => update({ match: e.target.value as 'all' | 'any' })} aria-label="Совпадение">
              <option value="all">все условия</option><option value="any">любое условие</option>
            </select>
          )}>
          <div className="space-y-2">
            {form.conditions.map((c, i) => {
              const f = fieldOf(c.field)
              const ops = opsFor(f?.type)
              const list = c.op === 'in' || c.op === 'not_in'
              return (
                <div key={i} className="rounded-xl bg-white/[0.03] p-2.5">
                  {i > 0 && <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">{form.match === 'all' ? 'и' : 'или'}</div>}
                  <div className="grid gap-2 sm:grid-cols-[1.3fr_0.9fr_1fr_auto]">
                    <select className="input" value={c.field} onChange={(e) => changeField(i, e.target.value)} aria-label="Поле">
                      {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                    <select className="input" value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value })} aria-label="Оператор">
                      {ops.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                    {f?.type === 'bool' && !list ? (
                      <select className="input" value={c.value} onChange={(e) => setCond(i, { ...c, value: e.target.value })} aria-label="Значение">
                        <option value="true">да</option><option value="false">нет</option>
                      </select>
                    ) : (
                      <input className={clsx('input', f?.type === 'number' && !list && 'tabular')} value={c.value}
                        inputMode={f?.type === 'number' && !list ? 'decimal' : 'text'} aria-label="Значение"
                        placeholder={list ? 'через запятую: a, b, c' : f?.type === 'number' ? '0' : 'значение'}
                        onChange={(e) => setCond(i, { ...c, value: e.target.value })} />
                    )}
                    <IconBtn label="Убрать условие" className="justify-self-end" onClick={() => update({ conditions: form.conditions.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></IconBtn>
                  </div>
                </div>
              )
            })}
            <Btn size="sm" variant="outline" disabled={form.conditions.length >= MAX_CONDITIONS || !fields.length} onClick={() => update({ conditions: [...form.conditions, newCond()] })}>
              <Plus className="h-4 w-4" /> Условие <span className="text-muted">{form.conditions.length}/{MAX_CONDITIONS}</span>
            </Btn>
          </div>
        </Section>

        <Section step="Тогда" text={form.actions.length ? undefined : 'Добавьте хотя бы одно действие'}>
          <div className="space-y-2">
            {form.actions.map((a, i) => {
              const def = catalog.actions.find((x) => x.key === a.type)
              return (
                <div key={i} className="space-y-3 rounded-xl bg-white/[0.03] p-2.5">
                  <div className="flex gap-2">
                    <select className="input flex-1" value={a.type} onChange={(e) => setAction(i, { type: e.target.value, params: defaultParams(e.target.value) })} aria-label="Действие">
                      {actions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                    <IconBtn label="Убрать действие" onClick={() => update({ actions: form.actions.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></IconBtn>
                  </div>
                  {def && def.params.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {def.params.map((p) => <div key={p.name} className={p.name === 'text' ? 'sm:col-span-2' : undefined}>{paramInput(a, i, p.name, p.required)}</div>)}
                    </div>
                  )}
                  {a.type === 'hold_for_review' && <p className="text-xs text-muted">Оплаченный заказ не будет выдан автоматически — его проверит оператор.</p>}
                </div>
              )
            })}
            <Btn size="sm" variant="outline" disabled={form.actions.length >= MAX_ACTIONS || !actions.length} onClick={() => update({ actions: [...form.actions, newAction()] })}>
              <Plus className="h-4 w-4" /> Действие <span className="text-muted">{form.actions.length}/{MAX_ACTIONS}</span>
            </Btn>
          </div>
        </Section>

        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Правило активно</div>
            <div className="text-xs text-muted">Выключенное правило не проверяется, но его можно протестировать</div>
          </div>
          <Toggle checked={form.is_active} onChange={(v) => update({ is_active: v })} label="Активно" />
        </div>

        {err && <ErrorBox text={err} />}

        <div className="rounded-2xl border border-secondary/20 bg-secondary/[0.04] p-4">
          <div className="flex items-center gap-2 font-display text-[15px] font-semibold"><FlaskConical className="h-4 w-4 text-secondary" /> Проверить (dry-run)</div>
          <p className="mt-1 text-xs text-muted">Текущие (несохранённые) условия проверяются на реальном {form.trigger === 'ticket_created' ? 'обращении' : 'заказе'}. Ничего не выполняется и не отправляется.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input className="input tabular w-full sm:w-56" inputMode="numeric" value={dry.entity}
              placeholder={form.trigger === 'ticket_created' ? 'ID обращения (необязательно)' : 'ID заказа (необязательно)'}
              onChange={(e) => setDry({ ...dry, entity: e.target.value.replace(/\D/g, '') })}
              onKeyDown={(e) => { if (e.key === 'Enter') void runDry() }} />
            <Btn variant="secondary" className="w-full sm:w-auto" loading={dry.busy} onClick={runDry}><FlaskConical className="h-4 w-4" /> Проверить</Btn>
          </div>
          {!dry.entity && <p className="mt-1.5 text-xs text-muted">Без номера берётся последний {form.trigger === 'ticket_created' ? 'созданный тикет' : form.trigger === 'order_paid' || form.trigger === 'order_delivered' ? 'оплаченный заказ' : 'заказ'}.</p>}
          {dry.error && <div className="mt-3"><ErrorBox text={dry.error} /></div>}
          {dry.result && (
            <div className="mt-3 space-y-3">
              <div className={clsx('flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold', dry.result.matched ? 'bg-success/10 text-success' : 'bg-white/[0.04] text-muted')}>
                {dry.result.matched ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {form.trigger === 'ticket_created' ? 'Обращение' : 'Заказ'} ID {dry.result.entity_id}: {dry.result.matched ? 'правило сработало бы' : 'правило не сработало бы'}
              </div>
              {dry.result.conditions.length > 0 && <CondResults rows={dry.result.conditions} catalog={catalog} />}
              {dry.result.matched && (
                <div>
                  <div className="label">Было бы выполнено</div>
                  {dry.result.would_run.length
                    ? <ul className="space-y-1 text-sm">{dry.result.would_run.map((t, i) => <li key={i}>→ {t}</li>)}</ul>
                    : <p className="text-sm text-muted">Действия не заданы</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

const PARAM_LABEL: Record<string, string> = { text: 'Текст', permission: 'Получатели', template: 'Шаблон', priority: 'Приоритет', username: 'Сотрудник' }

function Section({ step, text, right, children }: { step: string; text?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-primary/15 px-2 py-0.5 text-[12px] font-bold uppercase tracking-wider text-primary-soft">{step}</span>
          {text && <span className="text-xs text-muted">{text}</span>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function CondResults({ rows, catalog }: { rows: (Cond & { actual: unknown; ok: boolean })[]; catalog: Catalog }) {
  return (
    <div className="space-y-1.5">
      {rows.map((c, i) => {
        const f = catalog.fields.find((x) => x.key === c.field)
        const op = catalog.operators.find((x) => x.key === c.op)
        return (
          <div key={i} className="flex items-start gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-[13px]">
            {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
            <div className="min-w-0">
              <div>{f?.label ?? c.field} {op?.label ?? c.op} <b>{fmtValue(c.value, f?.type)}</b></div>
              <div className="text-xs text-muted">Фактически: {fmtValue(c.actual, f?.type)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ history

function RunsDialog({ rule, catalog, condText, onClose }: { rule: Rule; catalog: Catalog; condText: (c: Cond) => string; onClose: () => void }) {
  const { data, loading, error, reload } = useApi<RunRow[]>(`/rules/${rule.id}/runs?limit=100`)
  const [open, setOpen] = useState<number | null>(null)
  const trigger = useMemo(() => Object.fromEntries(catalog.triggers.map((t) => [t.key, t.label])), [catalog])
  const actionLabel = (k: string) => catalog.actions.find((a) => a.key === k)?.label ?? k
  return (
    <Modal open onClose={onClose} size="lg" title={<span className="flex items-center gap-2"><History className="h-5 w-5 text-muted" /> История: {rule.name}</span>}
      subtitle={`Проверок ${rule.runs} · срабатываний ${rule.matches} · ошибок ${rule.failures}`}>
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      {loading && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
      {data && !data.length && <Empty icon={Workflow} title="Запусков ещё не было" text="Правило проверяется, когда происходит событие и правило включено." />}
      <div className="space-y-2">
        {data?.map((r) => {
          const acts = r.result?.actions ?? []
          const failed = acts.some((a) => !a.ok)
          return (
            <div key={r.id} className="rounded-xl bg-white/[0.03] p-3">
              <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{trigger[r.event] ?? r.event} · {r.event === 'ticket_created' ? 'обращение' : 'заказ'} ID {r.entity_id}</div>
                  <div className="text-xs text-muted">{dt(r.created_at)}</div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {r.dry_run && <Badge tone="gray">тест</Badge>}
                  {r.matched ? <Badge tone="cyan" dot>Сработало</Badge> : <Badge tone="gray" dot>Не подошло</Badge>}
                  {failed && <Badge tone="red">Ошибка</Badge>}
                </div>
              </button>
              {acts.length > 0 && (
                <ul className="mt-2 space-y-1 text-[13px]">
                  {acts.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {a.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />}
                      <span className="min-w-0">{actionLabel(a.action)}{a.ok ? (a.result ? <span className="text-muted"> — {a.result}</span> : null) : <span className="text-danger"> — {a.error}</span>}</span>
                    </li>
                  ))}
                </ul>
              )}
              {open === r.id && (r.result?.conditions?.length
                ? <div className="mt-2"><CondResults rows={r.result.conditions} catalog={catalog} /></div>
                : open === r.id && <p className="mt-2 text-xs text-muted">Без условий</p>)}
            </div>
          )
        })}
      </div>
      {rule.conditions.length > 0 && (
        <p className="mt-4 text-xs text-muted">Текущие условия: {rule.conditions.map(condText).join(rule.match === 'all' ? ' и ' : ' или ')}. История показывает условия на момент запуска — нажмите на запуск, чтобы раскрыть.</p>
      )}
      <div className="mt-3 flex justify-end"><Btn size="sm" variant="ghost" onClick={() => reload()}>Обновить</Btn></div>
    </Modal>
  )
}
