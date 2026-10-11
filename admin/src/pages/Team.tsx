import clsx from 'clsx'
import {
  Ban, CheckCircle2, Copy, Crown, History, KeyRound, LogOut, Plus, Info, Save, ShieldCheck, Trash2, UserPlus, Users as UsersIcon, XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge, Btn, Card, Chips, DataTable, Empty, ErrorBox, Field, KV, Modal, PageHead, Skeleton, Tabs, useConfirm, useToast,
} from '../components/ui'
import { ago, api, ApiError, dt, errMsg, money } from '../lib/api'
import { useCan } from '../lib/session'
import { useApi } from '../lib/useApi'

// ------------------------------------------------------------------ types

interface StaffAccount {
  id: number; username: string; display_name: string | null; telegram_id: number | null; telegram_username: string | null
  role: string; role_name: string; role_color: string; is_active: boolean; expired: boolean; expires_at: string | null
  extra_permissions: string[]; denied_permissions: string[]; effective_permissions: string[]; limits: Record<string, number>
  has_password: boolean; last_login_at: string | null; created_at: string; note: string | null; version: number
  orders_processed: number; tickets_closed: number; is_self: boolean
}
interface StaffRole {
  id: number; slug: string; name: string; description: string; color: string; permissions: string[]
  limits: Record<string, number>; is_system: boolean; expires_at: string | null; version: number; updated_by: string | null; accounts: number
}
interface Catalog {
  groups: { name: string; permissions: { code: string; label: string }[] }[]
  limits: { key: string; label: string }[]
}
interface Approval {
  id: number; kind: string; kind_label: string; summary: string; amount: number | null; status: 'pending' | 'approved' | 'rejected'
  requested_by: string; decided_by: string | null; decision_note: string | null; result: string | null
  created_at: string; decided_at: string | null; can_decide: boolean
}
interface HistoryRow { id: number; action: string; entity: string; entity_id: number | null; details: Record<string, unknown>; created_at: string }

type TabKey = 'staff' | 'roles' | 'approvals'

// ---------------------------------------------------------------- helpers

/** ISO → value for <input type="datetime-local"> in the admin's local time */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
/** datetime-local value → timezone-aware ISO for the server */
const fromLocalInput = (v: string) => new Date(v).toISOString()

const SLUG_RE = /^[a-z][a-z0-9_]{1,31}$/
const SWATCHES = ['#8B5CF6', '#A78BFA', '#22D3EE', '#67E8F9', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#9494A8', '#64748B']

const accountName = (a: StaffAccount) => a.display_name || (a.telegram_username ? `@${a.telegram_username}` : a.username)

function AccountStatus({ a }: { a: StaffAccount }) {
  if (!a.is_active) return <Badge tone="red" dot>Отключён</Badge>
  if (a.expired) return <Badge tone="amber" dot>Доступ истёк</Badge>
  return <Badge tone="green" dot>Активен</Badge>
}

function RoleChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-bold"
      style={{ background: `${color}26`, color }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{name}</span>
    </span>
  )
}

function useFail(reload: () => void) {
  const toast = useToast()
  return (e: unknown) => {
    toast(errMsg(e), 'error')
    if (e instanceof ApiError && e.status === 409) reload()
  }
}

// ------------------------------------------------------------------- page

export default function Team({ onChange }: { onChange: () => void }) {
  const canStaff = useCan('staff.manage')
  const canRoles = useCan('staff.roles')
  const [params, setParams] = useSearchParams()
  const tabs: { value: TabKey; label: string }[] = [
    ...(canStaff ? [{ value: 'staff' as TabKey, label: 'Сотрудники' }] : []),
    ...(canRoles ? [{ value: 'roles' as TabKey, label: 'Роли' }] : []),
    { value: 'approvals', label: 'Одобрения' },
  ]
  const requested = params.get('tab') as TabKey | null
  const tab: TabKey = tabs.some((t) => t.value === requested) ? requested! : tabs[0].value
  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    setParams(next, { replace: true })
  }
  return (
    <div className="fade-in">
      <PageHead title="Команда" subtitle="Сотрудники, роли и права доступа, одобрение операций" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'staff' && <StaffTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'approvals' && <ApprovalsTab onChange={onChange} />}
    </div>
  )
}

// ------------------------------------------------------------------ staff

function StaffTab() {
  const { data, loading, error, reload, setData } = useApi<StaffAccount[]>('/accounts')
  const roles = useApi<StaffRole[]>('/roles')
  const catalog = useApi<Catalog>('/staff/permissions')
  const [invite, setInvite] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const toast = useToast()
  const editing = data?.find((a) => a.id === editId) ?? null
  const reloadAll = () => { void reload(true); void roles.reload(true) }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary-soft"><Crown className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Владелец — полный доступ, защищён</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Владелец задаётся на сервере (OWNER_TELEGRAM_ID или логин из .env), не является учётной записью и не может быть изменён,
              отключён или удалён из панели.
            </p>
          </div>
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{data ? `${data.length} сотрудн.` : ' '}</p>
        <Btn onClick={() => setInvite(true)}><UserPlus className="h-4 w-4" /> Пригласить</Btn>
      </div>
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      <DataTable rows={data} loading={loading} rowKey={(a) => a.id} onRowClick={(a) => (a.is_self ? toast('Свою учётную запись меняет владелец или другой администратор', 'error') : setEditId(a.id))} emptyText="Сотрудников пока нет"
        columns={[
          { header: 'Сотрудник', cell: (a) => (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold">{accountName(a)}</div>
              <div className="truncate text-xs text-muted">{a.username}{a.note ? ` · ${a.note}` : ''}</div>
            </div>
          ) },
          { header: 'Telegram', cell: (a) => a.telegram_id
            ? <div className="leading-tight"><div className="tabular font-mono text-sm">{a.telegram_id}</div>{a.telegram_username && <div className="text-xs text-muted">@{a.telegram_username}</div>}</div>
            : <span className="text-muted">—</span> },
          { header: 'Роль', cell: (a) => <RoleChip name={a.role_name} color={a.role_color} /> },
          { header: 'Статус', cell: (a) => <div className="space-y-1"><AccountStatus a={a} />{a.expires_at && !a.expired && <div className="text-[11px] text-muted">до {dt(a.expires_at)}</div>}</div> },
          { header: 'Вход', cell: (a) => <span className="whitespace-nowrap text-muted">{ago(a.last_login_at)}</span> },
          { header: 'Заказов', align: 'right', cell: (a) => <span className="tabular">{a.orders_processed}</span> },
          { header: 'Тикетов', align: 'right', cell: (a) => <span className="tabular">{a.tickets_closed}</span> },
        ]}
        card={(a) => (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 leading-tight">
                <div className="truncate font-semibold">{accountName(a)}</div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {a.telegram_id ? `ID ${a.telegram_id}${a.telegram_username ? ` · @${a.telegram_username}` : ''}` : a.username}
                </div>
              </div>
              <AccountStatus a={a} />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <RoleChip name={a.role_name} color={a.role_color} />
              <span className="text-xs text-muted">вход {ago(a.last_login_at)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-white/[0.03] py-1.5"><div className="text-muted">Заказов</div><div className="tabular font-semibold text-ink">{a.orders_processed}</div></div>
              <div className="rounded-lg bg-white/[0.03] py-1.5"><div className="text-muted">Тикетов</div><div className="tabular font-semibold text-ink">{a.tickets_closed}</div></div>
            </div>
          </div>
        )} />
      {invite && (
        <InviteModal roles={roles.data} onClose={() => setInvite(false)}
          onCreated={(a) => { setInvite(false); setData((s) => (s ? [...s, a] : [a])); void roles.reload(true); setEditId(null) }} />
      )}
      {editing && (
        <AccountSheet key={editing.id} account={editing} roles={roles.data} catalog={catalog.data}
          onClose={() => setEditId(null)}
          onSaved={(a) => setData((s) => s?.map((x) => (x.id === a.id ? a : x)) ?? s)}
          onDeleted={() => { setEditId(null); reloadAll() }}
          onConflict={reloadAll} />
      )}
    </div>
  )
}

function RoleSelect({ roles, value, onChange }: { roles: StaffRole[] | null; value: string; onChange: (v: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!roles}>
      {!roles && <option value={value}>Загрузка…</option>}
      {roles && !roles.some((r) => r.slug === value) && <option value={value}>{value}</option>}
      {roles?.map((r) => <option key={r.slug} value={r.slug}>{r.name}{r.is_system ? '' : ' (своя)'}</option>)}
    </select>
  )
}

function InviteModal({ roles, onClose, onCreated }: { roles: StaffRole[] | null; onClose: () => void; onCreated: (a: StaffAccount) => void }) {
  const [mode, setMode] = useState<'tg' | 'login'>('tg')
  const [f, setF] = useState({ telegram_id: '', telegram_username: '', display_name: '', username: '', password: '', role: 'support', expires: '', note: '' })
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }))
  const role = roles?.find((r) => r.slug === f.role)
  const tgOk = /^\d{3,15}$/.test(f.telegram_id) && (!f.telegram_username || /^@?[A-Za-z0-9_]{3,64}$/.test(f.telegram_username))
  const loginOk = /^[A-Za-z0-9_.-]{3,64}$/.test(f.username) && f.password.length >= 10
  const valid = mode === 'tg' ? tgOk : loginOk

  const submit = async () => {
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        role: f.role, display_name: f.display_name.trim() || null, note: f.note.trim() || null,
        expires_at: f.expires ? fromLocalInput(f.expires) : null,
      }
      if (mode === 'tg') {
        body.telegram_id = Number(f.telegram_id)
        body.telegram_username = f.telegram_username.trim() || null
      } else {
        body.username = f.username
        body.password = f.password
      }
      const a = await api<StaffAccount>('/accounts', { method: 'POST', body })
      toast('Сотрудник добавлен')
      onCreated(a)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="Пригласить сотрудника" subtitle="Доступ определяется ролью — её можно сменить в любой момент"
      footer={<><Btn variant="secondary" onClick={onClose}>Отмена</Btn><Btn loading={busy} disabled={!valid} onClick={submit}><UserPlus className="h-4 w-4" /> Добавить</Btn></>}>
      <div className="space-y-4">
        <Chips value={mode} onChange={setMode} options={[{ value: 'tg', label: 'По Telegram ID' }, { value: 'login', label: 'Логин и пароль' }]} />
        {mode === 'tg' ? (
          <>
            <div className="rounded-xl bg-secondary/10 px-3.5 py-3 text-xs leading-relaxed text-secondary-soft">
              Кнопка «Админ-панель» появится у этого Telegram-аккаунта в Mini App автоматически — править .env на сервере не нужно.
              Сообщение человеку не отправляется: сообщите ему сами, что доступ открыт.
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Telegram ID" hint="Только цифры. Узнать можно у @userinfobot">
                <input className="input font-mono" inputMode="numeric" autoFocus value={f.telegram_id} placeholder="123456789"
                  onChange={(e) => set({ telegram_id: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label="@username (необязательно)">
                <input className="input" autoCapitalize="none" value={f.telegram_username} placeholder="@manager"
                  onChange={(e) => set({ telegram_username: e.target.value.replace(/[^@A-Za-z0-9_]/g, '') })} />
              </Field>
            </div>
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Логин" hint="Латиница, цифры, точка, дефис, _">
              <input className="input" autoCapitalize="none" autoComplete="off" value={f.username}
                onChange={(e) => set({ username: e.target.value.replace(/[^A-Za-z0-9_.-]/g, '') })} />
            </Field>
            <Field label="Пароль" hint="Не короче 10 символов. Передайте лично.">
              <input className="input" type="text" autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} />
            </Field>
          </div>
        )}
        <Field label="Имя для команды (необязательно)">
          <input className="input" maxLength={64} value={f.display_name} placeholder="Анна — поддержка" onChange={(e) => set({ display_name: e.target.value })} />
        </Field>
        <Field label="Роль" hint={role ? `${role.description || role.name} · ${role.permissions.length} прав` : undefined}>
          <RoleSelect roles={roles} value={f.role} onChange={(v) => set({ role: v })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Доступ до (необязательно)" hint="После этой даты вход будет закрыт автоматически">
            <input className="input" type="datetime-local" value={f.expires} onChange={(e) => set({ expires: e.target.value })} />
          </Field>
          <Field label="Заметка (необязательно)">
            <input className="input" maxLength={255} value={f.note} placeholder="Ночная смена" onChange={(e) => set({ note: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------- account sheet

type PermState = 'role' | 'add' | 'deny'

function AccountSheet({ account: a, roles, catalog, onClose, onSaved, onDeleted, onConflict }: {
  account: StaffAccount; roles: StaffRole[] | null; catalog: Catalog | null
  onClose: () => void; onSaved: (a: StaffAccount) => void; onDeleted: () => void; onConflict: () => void
}) {
  const canAudit = useCan('system.audit')
  const toast = useToast()
  const confirm = useConfirm()
  const init = useMemo(() => ({
    role: a.role, display_name: a.display_name ?? '', telegram_id: a.telegram_id ? String(a.telegram_id) : '',
    telegram_username: a.telegram_username ?? '', note: a.note ?? '', expires: toLocalInput(a.expires_at),
    extra: [...a.extra_permissions].sort(), denied: [...a.denied_permissions].sort(),
  }), [a])
  const [f, setF] = useState(init)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [history, setHistory] = useState(false)
  useEffect(() => { setF(init); setPassword('') }, [init])
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }))

  const role = roles?.find((r) => r.slug === f.role)
  const rolePerms = useMemo(() => new Set(role?.permissions ?? []), [role])
  const stateOf = (code: string): PermState => (f.denied.includes(code) ? 'deny' : f.extra.includes(code) ? 'add' : 'role')
  const setPerm = (code: string, s: PermState) => {
    const extra = f.extra.filter((c) => c !== code)
    const denied = f.denied.filter((c) => c !== code)
    if (s === 'add') extra.push(code)
    if (s === 'deny') denied.push(code)
    set({ extra: extra.sort(), denied: denied.sort() })
  }
  const effectiveLocal = (code: string) => !f.denied.includes(code) && (rolePerms.has(code) || f.extra.includes(code))

  const patch: Record<string, unknown> = {}
  if (f.role !== init.role) patch.role = f.role
  if (f.display_name !== init.display_name) patch.display_name = f.display_name.trim()
  if (f.note !== init.note) patch.note = f.note.trim()
  if (f.telegram_username !== init.telegram_username) patch.telegram_username = f.telegram_username.trim().replace(/^@/, '')
  if (f.telegram_id !== init.telegram_id) patch.telegram_id = f.telegram_id ? Number(f.telegram_id) : 0
  if (f.expires !== init.expires) {
    if (f.expires) patch.expires_at = fromLocalInput(f.expires)
    else patch.clear_expiry = true
  }
  if (f.extra.join() !== init.extra.join()) patch.extra_permissions = f.extra
  if (f.denied.join() !== init.denied.join()) patch.denied_permissions = f.denied
  if (password) patch.password = password
  const dirty = Object.keys(patch).length > 0
  const pwdBad = password.length > 0 && password.length < 10

  const send = async (body: Record<string, unknown>, msg: string, key: string) => {
    setBusy(key)
    try {
      const out = await api<StaffAccount>(`/accounts/${a.id}`, { method: 'PATCH', body: { ...body, version: a.version } })
      toast(msg)
      onSaved(out)
    } catch (e) {
      toast(errMsg(e), 'error')
      if (e instanceof ApiError && e.status === 409) { onConflict(); onClose() }
    } finally { setBusy(null) }
  }

  const save = async () => {
    if (patch.telegram_id === 0 && !(await confirm({ title: 'Отвязать Telegram?', text: 'Сотрудник больше не сможет войти через Mini App, его сессии завершатся.', confirmLabel: 'Отвязать', danger: true }))) return
    await send(patch, 'Изменения сохранены', 'save')
  }

  const toggleActive = async () => {
    if (a.is_active && await confirm({
      title: `Приостановить доступ ${accountName(a)}?`, text: 'Все активные сессии завершатся сразу. Восстановить доступ можно в любой момент.',
      danger: true, confirmLabel: 'Приостановить',
    }) === false) return
    await send({ is_active: !a.is_active }, a.is_active ? 'Доступ приостановлен' : 'Доступ восстановлен', 'active')
  }

  const revoke = async () => {
    if (await confirm({ title: 'Завершить все сессии?', text: 'Сотруднику придётся войти заново на всех устройствах.', confirmLabel: 'Завершить' }) === false) return
    setBusy('revoke')
    try {
      await api(`/accounts/${a.id}/revoke-sessions`, { method: 'POST' })
      toast('Сессии завершены')
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(null) }
  }

  const remove = async () => {
    if (await confirm({
      title: `Удалить ${accountName(a)}?`, text: 'Учётная запись будет удалена навсегда, доступ закроется сразу. История действий в журнале сохранится.',
      danger: true, confirmLabel: 'Удалить',
    }) === false) return
    setBusy('delete')
    try {
      await api(`/accounts/${a.id}`, { method: 'DELETE' })
      toast('Сотрудник удалён')
      onDeleted()
    } catch (e) { toast(errMsg(e), 'error'); setBusy(null) }
  }

  return (
    <Modal open onClose={onClose} size="xl" title={accountName(a)}
      subtitle={<span className="flex flex-wrap items-center gap-2"><RoleChip name={a.role_name} color={a.role_color} /><AccountStatus a={a} /></span>}
      footer={<>
        {dirty && <Btn variant="ghost" onClick={() => { setF(init); setPassword('') }}>Отменить</Btn>}
        <Btn loading={busy === 'save'} disabled={!dirty || pwdBad || busy !== null} onClick={save}><Save className="h-4 w-4" /> Сохранить</Btn>
      </>}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KV label="Последний вход">{ago(a.last_login_at)}</KV>
          <KV label="Создан">{dt(a.created_at)}</KV>
          <KV label="Заказов">{a.orders_processed}</KV>
          <KV label="Тикетов закрыто">{a.tickets_closed}</KV>
        </div>

        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant={a.is_active ? 'danger' : 'success'} loading={busy === 'active'} disabled={busy !== null} onClick={toggleActive}>
            {a.is_active ? <><Ban className="h-4 w-4" /> Приостановить</> : <><ShieldCheck className="h-4 w-4" /> Восстановить</>}
          </Btn>
          <Btn size="sm" variant="secondary" loading={busy === 'revoke'} disabled={busy !== null} onClick={revoke}><LogOut className="h-4 w-4" /> Завершить сессии</Btn>
          {canAudit && <Btn size="sm" variant="secondary" onClick={() => setHistory(true)}><History className="h-4 w-4" /> История действий</Btn>}
          <Btn size="sm" variant="danger" loading={busy === 'delete'} disabled={busy !== null} onClick={remove}><Trash2 className="h-4 w-4" /> Удалить</Btn>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Имя для команды"><input className="input" maxLength={64} value={f.display_name} onChange={(e) => set({ display_name: e.target.value })} /></Field>
          <Field label="Роль" hint={role?.description}>
            <RoleSelect roles={roles} value={f.role} onChange={(v) => set({ role: v })} />
          </Field>
          <Field label="Telegram ID" hint="Пусто или 0 — отвязать. Кнопка «Админ-панель» появится в Mini App сама.">
            <input className="input font-mono" inputMode="numeric" value={f.telegram_id} placeholder="не привязан"
              onChange={(e) => set({ telegram_id: e.target.value.replace(/\D/g, '').replace(/^0+$/, '') })} />
          </Field>
          <Field label="Telegram @username">
            <input className="input" autoCapitalize="none" value={f.telegram_username} onChange={(e) => set({ telegram_username: e.target.value.replace(/[^@A-Za-z0-9_]/g, '') })} />
          </Field>
          <Field label="Доступ до" hint={f.expires ? undefined : 'Без ограничения по времени'}>
            <div className="flex gap-2">
              <input className="input" type="datetime-local" value={f.expires} onChange={(e) => set({ expires: e.target.value })} />
              {f.expires && <Btn variant="secondary" className="h-11 shrink-0" onClick={() => set({ expires: '' })}>Бессрочно</Btn>}
            </div>
          </Field>
          <Field label={a.has_password ? 'Новый пароль' : 'Пароль для входа в браузере'} hint={pwdBad ? 'Не короче 10 символов' : 'Оставьте пустым, чтобы не менять. Смена пароля завершает сессии.'}>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="input pl-10" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </Field>
          <Field label="Заметка" className="sm:col-span-2"><input className="input" maxLength={255} value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h4 className="font-display text-[15px] font-semibold">Права доступа</h4>
              <p className="mt-0.5 text-xs text-muted">«Роль» — как в роли, «Дать» — добавить сверх роли, «Запрет» — убрать даже если есть в роли.</p>
            </div>
            <Badge tone="violet">Действует сейчас: {a.effective_permissions.length}</Badge>
          </div>
          {!catalog ? <Skeleton className="h-48" /> : (
            <div className="grid gap-3 lg:grid-cols-2">
              {catalog.groups.map((g) => (
                <div key={g.name} className="rounded-xl bg-white/[0.03] p-3">
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{g.name}</div>
                  <div className="divide-y divide-white/[0.05]">
                    {g.permissions.map((p) => {
                      const st = stateOf(p.code)
                      const eff = effectiveLocal(p.code)
                      return (
                        <div key={p.code} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className={clsx('h-2 w-2 shrink-0 rounded-full', eff ? 'bg-success' : 'bg-white/15')} title={eff ? 'Будет действовать' : 'Не действует'} />
                            <div className="min-w-0">
                              <div className="text-[13px] leading-snug">{p.label}</div>
                              <div className="font-mono text-[10.5px] text-muted">{p.code}{rolePerms.has(p.code) ? ' · есть в роли' : ''}</div>
                            </div>
                          </div>
                          <div className="flex shrink-0 rounded-lg bg-white/[0.04] p-0.5 text-[11.5px] font-semibold">
                            {([['role', 'Роль'], ['add', 'Дать'], ['deny', 'Запрет']] as [PermState, string][]).map(([v, label]) => (
                              <button key={v} type="button" onClick={() => setPerm(p.code, v)}
                                className={clsx('rounded-md px-2.5 py-1 transition', st === v
                                  ? v === 'add' ? 'bg-success/20 text-success' : v === 'deny' ? 'bg-danger/20 text-danger' : 'bg-white/[0.1] text-ink'
                                  : 'text-muted hover:text-ink')}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {catalog && a.effective_permissions.length > 0 && (
            <details className="mt-3 rounded-xl bg-white/[0.02] px-3.5 py-2.5 text-sm">
              <summary className="cursor-pointer font-semibold text-muted">Действующие права по данным сервера ({a.effective_permissions.length})</summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {a.effective_permissions.map((c) => (
                  <Badge key={c} tone="gray">{catalog.groups.flatMap((g) => g.permissions).find((p) => p.code === c)?.label ?? c}</Badge>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
      {history && <HistoryModal account={a} onClose={() => setHistory(false)} />}
    </Modal>
  )
}

function HistoryModal({ account, onClose }: { account: StaffAccount; onClose: () => void }) {
  const { data, loading, error, reload } = useApi<HistoryRow[]>(`/accounts/${account.id}/history?limit=200`)
  return (
    <Modal open onClose={onClose} size="lg" title="История действий" subtitle={accountName(account)}>
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      {loading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        : !data?.length ? <Empty icon={History} title="Действий пока нет" />
        : (
          <div className="space-y-2">
            {data.map((r) => (
              <div key={r.id} className="rounded-xl bg-white/[0.03] px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">{r.action} · {r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}</span>
                  <span className="text-xs text-muted">{dt(r.created_at)}</span>
                </div>
                {r.details && Object.keys(r.details).length > 0 && (
                  <div className="mt-1 break-all font-mono text-[11px] text-muted">{JSON.stringify(r.details)}</div>
                )}
              </div>
            ))}
          </div>
        )}
    </Modal>
  )
}

// ------------------------------------------------------------------ roles

function RolesTab() {
  const { data, loading, error, reload, setData } = useApi<StaffRole[]>('/roles')
  const catalog = useApi<Catalog>('/staff/permissions')
  const [edit, setEdit] = useState<StaffRole | 'new' | null>(null)
  const toast = useToast()
  const confirm = useConfirm()
  const fail = useFail(() => void reload(true))

  const copy = async (r: StaffRole) => {
    try {
      const out = await api<StaffRole>(`/roles/${r.id}/copy`, { method: 'POST' })
      toast(`Создана роль «${out.name}»`)
      setData((s) => (s ? [...s, out] : [out]))
      setEdit(out)
    } catch (e) { fail(e) }
  }
  const remove = async (r: StaffRole) => {
    if (await confirm({ title: `Удалить роль «${r.name}»?`, text: 'Роль, назначенную сотрудникам, удалить нельзя — сначала смените им роль.', danger: true, confirmLabel: 'Удалить' }) === false) return
    try {
      await api(`/roles/${r.id}`, { method: 'DELETE' })
      toast('Роль удалена')
      setEdit(null)
      setData((s) => s?.filter((x) => x.id !== r.id) ?? s)
    } catch (e) { fail(e) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Встроенные роли можно настроить или скопировать как основу для своей.</p>
        <Btn onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Новая роль</Btn>
      </div>
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      <DataTable rows={data} loading={loading} rowKey={(r) => r.id} onRowClick={(r) => setEdit(r)} emptyText="Ролей нет"
        columns={[
          { header: 'Роль', cell: (r) => (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-sm font-semibold">{r.name}</div>
                <div className="truncate font-mono text-[11px] text-muted">{r.slug}</div>
              </div>
            </div>
          ) },
          { header: 'Описание', cell: (r) => <span className="block max-w-[320px] truncate text-muted">{r.description || '—'}</span> },
          { header: 'Прав', align: 'right', cell: (r) => <span className="tabular">{r.permissions.length}</span> },
          { header: 'Сотрудников', align: 'right', cell: (r) => <span className="tabular">{r.accounts}</span> },
          { header: '', cell: (r) => (
            <div className="flex flex-wrap gap-1.5">
              {r.is_system ? <Badge tone="gray">Встроенная</Badge> : <Badge tone="violet">Своя</Badge>}
              {r.expires_at && <Badge tone={new Date(r.expires_at) < new Date() ? 'red' : 'amber'}>до {dt(r.expires_at)}</Badge>}
            </div>
          ) },
          { header: '', align: 'right', cell: (r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Btn size="sm" variant="ghost" title="Копировать" onClick={() => copy(r)}><Copy className="h-4 w-4" /></Btn>
              {!r.is_system && <Btn size="sm" variant="ghost" title="Удалить" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Btn>}
            </div>
          ) },
        ]}
        card={(r) => (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
                <div className="min-w-0 leading-tight">
                  <div className="truncate font-semibold">{r.name}</div>
                  <div className="truncate text-xs text-muted">{r.description || r.slug}</div>
                </div>
              </div>
              {r.is_system ? <Badge tone="gray">Встроенная</Badge> : <Badge tone="violet">Своя</Badge>}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-3 text-xs text-muted">
              <span><UsersIcon className="mr-1 inline h-3.5 w-3.5" />{r.accounts} сотрудн.</span>
              <span><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />{r.permissions.length} прав</span>
              {r.expires_at && <span>до {dt(r.expires_at)}</span>}
            </div>
          </div>
        )} />
      {edit && (
        <RoleEditor key={edit === 'new' ? 'new' : edit.id} role={edit === 'new' ? null : edit} catalog={catalog.data}
          onClose={() => setEdit(null)} onCopy={copy} onDelete={remove}
          onSaved={(r, created) => {
            setData((s) => (created ? [...(s ?? []), r] : s?.map((x) => (x.id === r.id ? { ...r, accounts: x.accounts } : x)) ?? s))
            setEdit(null)
          }}
          onConflict={() => { void reload(true); setEdit(null) }} />
      )}
    </div>
  )
}

function RoleEditor({ role, catalog, onClose, onSaved, onCopy, onDelete, onConflict }: {
  role: StaffRole | null; catalog: Catalog | null; onClose: () => void; onSaved: (r: StaffRole, created: boolean) => void
  onCopy: (r: StaffRole) => void; onDelete: (r: StaffRole) => void; onConflict: () => void
}) {
  const toast = useToast()
  const [f, setF] = useState(() => ({
    slug: role?.slug ?? '', name: role?.name ?? '', description: role?.description ?? '', color: role?.color ?? SWATCHES[0],
    perms: new Set(role?.permissions ?? []),
    limits: Object.fromEntries(Object.entries(role?.limits ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])) as Record<string, string>,
    expires: toLocalInput(role?.expires_at ?? null),
  }))
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }))
  const togglePerm = (code: string, on: boolean) => {
    const next = new Set(f.perms)
    if (on) next.add(code)
    else next.delete(code)
    set({ perms: next })
  }
  const toggleGroup = (codes: string[]) => {
    const next = new Set(f.perms)
    const all = codes.every((c) => next.has(c))
    codes.forEach((c) => (all ? next.delete(c) : next.add(c)))
    set({ perms: next })
  }

  const slugOk = role !== null || SLUG_RE.test(f.slug)
  const colorOk = /^#[0-9A-Fa-f]{6}$/.test(f.color)
  const limitsOk = Object.values(f.limits).every((v) => v === '' || (/^\d+(\.\d+)?$/.test(v)))
  const valid = slugOk && f.name.trim().length >= 2 && colorOk && limitsOk

  const save = async () => {
    setBusy(true)
    const limits = Object.fromEntries(Object.entries(f.limits).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]))
    const base = {
      name: f.name.trim(), description: f.description.trim(), color: f.color.toUpperCase(),
      permissions: [...f.perms].sort(), limits,
    }
    try {
      if (role) {
        const body: Record<string, unknown> = { ...base, version: role.version }
        if (f.expires) body.expires_at = fromLocalInput(f.expires)
        else if (role.expires_at) body.clear_expiry = true
        const out = await api<StaffRole>(`/roles/${role.id}`, { method: 'PATCH', body })
        toast('Роль сохранена')
        onSaved(out, false)
      } else {
        const out = await api<StaffRole>('/roles', { method: 'POST', body: { ...base, slug: f.slug, expires_at: f.expires ? fromLocalInput(f.expires) : null } })
        toast('Роль создана')
        onSaved(out, true)
      }
    } catch (e) {
      toast(errMsg(e), 'error')
      if (e instanceof ApiError && e.status === 409 && role) onConflict()
    } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} size="xl" title={role ? `Роль «${role.name}»` : 'Новая роль'}
      subtitle={role ? <span className="font-mono text-xs">{role.slug}{role.updated_by ? ` · изменял ${role.updated_by}` : ''}</span> : 'Набор прав для группы сотрудников'}
      footer={<>
        {role && <Btn variant="ghost" className="mr-auto" onClick={() => onCopy(role)}><Copy className="h-4 w-4" /> Копировать</Btn>}
        {role && !role.is_system && <Btn variant="danger" onClick={() => onDelete(role)}><Trash2 className="h-4 w-4" /> Удалить</Btn>}
        <Btn loading={busy} disabled={!valid} onClick={save}><Save className="h-4 w-4" /> {role ? 'Сохранить' : 'Создать'}</Btn>
      </>}>
      <div className="space-y-5">
        {role && role.accounts > 0 && (
          <div className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-xs text-warning">Изменения сразу применятся к {role.accounts} сотрудн. с этой ролью — они получат уведомление.</div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {!role && (
            <Field label="Код роли" hint={f.slug && !slugOk ? 'Латиница в нижнем регистре, цифры и _, начинается с буквы, 2–32 символа' : 'Например: night_support. Изменить потом нельзя.'}>
              <input className="input font-mono" autoCapitalize="none" maxLength={32} value={f.slug}
                onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
            </Field>
          )}
          <Field label="Название"><input className="input" maxLength={64} value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Описание" className={clsx(!role && 'sm:col-span-2')}><input className="input" maxLength={255} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Цвет">
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => set({ color: c })}
                  className={clsx('h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition', f.color.toUpperCase() === c && 'ring-2 ring-white/70')}
                  style={{ background: c }} />
              ))}
              <input className="input h-9 w-28 font-mono text-sm" maxLength={7} value={f.color}
                onChange={(e) => set({ color: `#${e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6)}` })} />
            </div>
          </Field>
          <Field label="Роль действует до" hint={f.expires ? undefined : 'Без ограничения по времени'}>
            <div className="flex gap-2">
              <input className="input" type="datetime-local" value={f.expires} onChange={(e) => set({ expires: e.target.value })} />
              {f.expires && <Btn variant="secondary" className="h-11 shrink-0" onClick={() => set({ expires: '' })}>Бессрочно</Btn>}
            </div>
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-end justify-between gap-2">
            <h4 className="font-display text-[15px] font-semibold">Права</h4>
            <Badge tone="violet">Выбрано: {f.perms.size}</Badge>
          </div>
          {!catalog ? <Skeleton className="h-48" /> : (
            <div className="grid gap-3 lg:grid-cols-2">
              {catalog.groups.map((g) => {
                const codes = g.permissions.map((p) => p.code)
                const all = codes.every((c) => f.perms.has(c))
                return (
                  <div key={g.name} className="rounded-xl bg-white/[0.03] p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{g.name}</span>
                      <button type="button" className="text-xs font-semibold text-primary-soft hover:text-ink" onClick={() => toggleGroup(codes)}>
                        {all ? 'Снять группу' : 'Выбрать группу'}
                      </button>
                    </div>
                    {g.permissions.map((p) => (
                      <label key={p.code} className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-white/[0.03]">
                        <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={f.perms.has(p.code)} onChange={(e) => togglePerm(p.code, e.target.checked)} />
                        <span className="min-w-0">
                          <span className="block text-[13px] leading-snug">{p.label}</span>
                          <span className="block font-mono text-[10.5px] text-muted">{p.code}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {catalog && catalog.limits.length > 0 && (
          <div>
            <h4 className="font-display text-[15px] font-semibold">Лимиты</h4>
            <p className="mb-3 mt-0.5 text-xs text-muted">Пустое поле — без ограничения. Операции сверх лимита уходят на одобрение.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {catalog.limits.map((l) => (
                <Field key={l.key} label={l.label}>
                  <input className="input tabular" inputMode="decimal" value={f.limits[l.key] ?? ''} placeholder="без лимита"
                    onChange={(e) => set({ limits: { ...f.limits, [l.key]: e.target.value.replace(',', '.').replace(/[^\d.]/g, '') } })} />
                </Field>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// -------------------------------------------------------------- approvals

const APPROVAL_STATUS: Record<Approval['status'], { label: string; tone: 'amber' | 'green' | 'red' }> = {
  pending: { label: 'Ожидает', tone: 'amber' }, approved: { label: 'Одобрено', tone: 'green' }, rejected: { label: 'Отклонено', tone: 'red' },
}

function ApprovalsTab({ onChange }: { onChange: () => void }) {
  const canApprove = useCan('refunds.approve')
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const { data, loading, error, reload } = useApi<Approval[]>(`/approvals?status=${status}`)
  const [busy, setBusy] = useState<number | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const decide = async (r: Approval, approve: boolean) => {
    const note = await confirm({
      title: approve ? `Одобрить запрос #${r.id}?` : `Отклонить запрос #${r.id}?`,
      text: <>{r.kind_label}{r.amount !== null ? ` на ${money(r.amount)}` : ''}. {r.summary}{approve ? ' Операция будет выполнена сразу.' : ''}</>,
      input: { label: approve ? 'Комментарий (необязательно)' : 'Причина отказа', required: !approve, multiline: true },
      confirmLabel: approve ? 'Одобрить' : 'Отклонить', danger: !approve,
    })
    if (note === false) return
    setBusy(r.id)
    try {
      const out = await api<{ status: string; result: string | null }>(`/approvals/${r.id}/decide`, { method: 'POST', body: { approve, note } })
      toast(approve ? `Одобрено${out.result ? `: ${out.result}` : ''}` : 'Запрос отклонён')
      await reload(true)
      onChange()
    } catch (e) {
      toast(errMsg(e), 'error')
      void reload(true)
      onChange()
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      {!canApprove && <p className="text-sm text-muted">Здесь видны ваши запросы на операции сверх лимита и решения по ним.</p>}
      <Chips value={status} onChange={setStatus} options={[
        { value: 'pending', label: 'Ожидают' }, { value: 'approved', label: 'Одобренные' }, { value: 'rejected', label: 'Отклонённые' }, { value: 'all', label: 'Все' },
      ]} />
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      {loading ? <div className="card space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        : !data?.length ? <div className="card"><Empty icon={CheckCircle2} title={status === 'pending' ? 'Нет запросов на одобрение' : 'Ничего не найдено'} /></div>
        : (
          <div className="space-y-2">
            {data.map((r) => {
              const st = APPROVAL_STATUS[r.status] ?? { label: r.status, tone: 'amber' as const }
              return (
                <div key={r.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">#{r.id} · {r.kind_label}</span>
                        <Badge tone={st.tone} dot>{st.label}</Badge>
                      </div>
                      <p className="mt-1 text-sm">{r.summary}</p>
                      <div className="mt-1.5 text-xs text-muted">Запросил {r.requested_by} · {ago(r.created_at)}</div>
                      {r.decided_by && (
                        <div className="mt-1 text-xs text-muted">
                          Решение: {r.decided_by} · {dt(r.decided_at)}{r.decision_note ? ` — «${r.decision_note}»` : ''}
                        </div>
                      )}
                      {r.result && <div className="mt-1 text-xs text-muted">Результат: {r.result}</div>}
                    </div>
                    {r.amount !== null && <div className="tabular font-display text-lg font-bold">{money(r.amount)}</div>}
                  </div>
                  {r.can_decide && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Btn size="sm" variant="success" loading={busy === r.id} disabled={busy !== null} onClick={() => decide(r, true)}><CheckCircle2 className="h-4 w-4" /> Одобрить</Btn>
                      <Btn size="sm" variant="danger" disabled={busy !== null} onClick={() => decide(r, false)}><XCircle className="h-4 w-4" /> Отклонить</Btn>
                    </div>
                  )}
                  {r.status === 'pending' && !r.can_decide && canApprove && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Info className="h-3.5 w-3.5" /> Свой запрос одобряет другой сотрудник</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}
