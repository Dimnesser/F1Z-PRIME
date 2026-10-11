import clsx from 'clsx'
import {
  Activity, AlarmClock, Bell, Bot, CheckCircle2, Clock, CreditCard, ExternalLink, Gauge, ListChecks, Play, RefreshCw, RotateCcw,
  Settings2, ShieldAlert, Siren, Timer, Workflow, Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SettingsSection, useSettings } from '../components/SettingsForm'
import { JOB_STATUS } from '../components/orders/shared'
import {
  Badge, Btn, Card, Chips, DataTable, Empty, ErrorBox, PageHead, Skeleton, Tabs, useConfirm, useToast,
} from '../components/ui'
import { ago, api, dt, errMsg, qs } from '../lib/api'
import { useCan } from '../lib/session'
import { useApi } from '../lib/useApi'

export interface SystemStatus {
  version: string; environment: string
  api: { ok: boolean }; database: { ok: boolean }
  worker: { ok: boolean; last_seen: string | null }
  bot: { ok: boolean; last_seen: string | null; configured: boolean }
  maintenance: boolean
  notifications: { pending: number; failed: number; sent: number }
  jobs: { pending: number; running: number; done: number; dead: number }
  unprocessed_orders: number; open_incidents: number
  errors: { total: number; last_24h: number; server_24h: number; client_24h: number }
  backups: { count: number; last: { name: string; size: number; created_at: string } | null }
  payments: { stars: { enabled: boolean; configured: boolean }; manual: { enabled: boolean } }
  admin_notify_ids: number; bot_configured: boolean
}
interface TaskRow {
  name: string; interval: number; last_started_at: string | null; last_success_at: string | null; last_error: string | null
  runs: number; failures: number; last_duration_ms: number | null
}
interface Overview {
  active_orders: Record<string, number>; fulfillment_queue: Record<string, number>; failed: number; overdue_reservations: number
  payments_review: number; avg_fulfillment_seconds: number | null; auto_rate: number | null; delivered_30d: number
  retries_24h: number; dead_jobs: number; open_incidents: number; worker_last_seen: string | null; worker_ok: boolean; tasks: TaskRow[]
}
interface JobRow {
  id: number; kind: string; status: string; attempts: number; max_attempts: number; last_error: string | null
  run_at: string; created_at: string; order_id: number | null; dedupe_key: string | null
}
interface IncidentRow {
  id: number; kind: string; severity: string; status: string; title: string; details: Record<string, unknown> | null
  order_id: number | null; payment_id: number | null; created_at: string; resolved_at: string | null; resolved_by: string | null
}

/** whitelist from backend admin_system.TASKS_ON_DEMAND */
const ON_DEMAND = ['expire_reservations', 'stuck_orders', 'payment_checks', 'low_stock', 'recover_jobs']
const TASK_LABEL: Record<string, string> = {
  recover_jobs: 'Восстановление зависших задач', expire_reservations: 'Снятие просроченных резервов', stuck_orders: 'Поиск застрявших заказов',
  payment_checks: 'Проверка платежей', low_stock: 'Контроль остатков', notification_outbox: 'Очередь уведомлений',
  backup: 'Резервное копирование', cleanup: 'Очистка старых данных', daily_summary: 'Ежедневная сводка',
}
const JOB_KIND: Record<string, string> = { fulfill: 'Выдача заказа', tg_message: 'Сообщение Telegram', refund_stars: 'Возврат Stars', rules: 'Правило' }
const SEVERITY: Record<string, { label: string; tone: 'red' | 'amber' | 'gray' }> = {
  critical: { label: 'Критично', tone: 'red' }, error: { label: 'Ошибка', tone: 'red' }, warning: { label: 'Внимание', tone: 'amber' }, info: { label: 'Инфо', tone: 'gray' },
}

const every = (s: number) => (s >= 86400 ? `${Math.round(s / 86400)} дн` : s >= 3600 ? `${Math.round(s / 3600)} ч` : s >= 60 ? `${Math.round(s / 60)} мин` : `${s} с`)
const duration = (s: number | null) => {
  if (s === null) return '—'
  if (s < 60) return `${Math.round(s)} с`
  if (s < 3600) return `${Math.round(s / 60)} мин`
  return `${(s / 3600).toFixed(1)} ч`
}
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

type Tab = 'jobs' | 'incidents' | 'tasks' | 'settings'

export default function Automation() {
  const [tab, setTab] = useState<Tab>('jobs')
  const overview = useApi<Overview>('/automation/overview', { poll: 30_000 })
  const status = useApi<SystemStatus>('/system/status', { poll: 30_000 })
  const o = overview.data
  const s = status.data
  const queue = o ? sum(Object.fromEntries(Object.entries(o.fulfillment_queue).filter(([k]) => k !== 'delivered'))) : 0

  return (
    <div className="fade-in space-y-4">
      <PageHead title="Центр автоматизации" subtitle="Выдача заказов, фоновые задачи, очередь ошибок и инциденты · обновляется каждые 30 с">
        <Btn variant="secondary" loading={overview.refreshing || status.refreshing} onClick={() => { void overview.reload(true); void status.reload(true) }}>
          <RefreshCw className="h-4 w-4" /> Обновить
        </Btn>
      </PageHead>
      {overview.error && <ErrorBox text={overview.error} onRetry={() => overview.reload()} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <Health icon={Activity} label="Воркер" ok={s ? s.worker.ok : o?.worker_ok} sub={s?.worker.last_seen ?? o?.worker_last_seen ?? null} />
        <Health icon={Bot} label="Бот" ok={s ? s.bot.ok && s.bot.configured : undefined} sub={s?.bot.last_seen ?? null}
          extra={s && !s.bot.configured ? 'BOT_TOKEN не настроен' : undefined} />
        <Health icon={Gauge} label="База данных" ok={s?.database.ok} extra={s ? (s.database.ok ? 'отвечает' : 'нет ответа') : undefined} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {!o ? Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />) : (<>
          <Tile icon={Workflow} label="Активные заказы" value={sum(o.active_orders)} sub={`ждут оплаты ${o.active_orders.pending ?? 0}`} to="/orders" />
          <Tile icon={ListChecks} label="Очередь выдачи" value={queue} sub={`ошибок выдачи ${o.failed}`} tone={o.failed ? 'red' : undefined} to="/orders?status=paid" />
          <Tile icon={AlarmClock} label="Просроченные резервы" value={o.overdue_reservations} tone={o.overdue_reservations ? 'amber' : undefined} sub="ждут снятия" />
          <Tile icon={CreditCard} label="Платежи на проверке" value={o.payments_review} tone={o.payments_review ? 'amber' : undefined} to="/finance" />
          <Tile icon={Timer} label="Среднее время выдачи" value={duration(o.avg_fulfillment_seconds)} sub="за 30 дней" />
          <Tile icon={Zap} label="Доля автовыдачи" value={o.auto_rate === null ? '—' : `${o.auto_rate}%`} sub={`выдано за 30 дн: ${o.delivered_30d}`} />
          <Tile icon={RotateCcw} label="Повторы за 24 ч" value={o.retries_24h} />
          <Tile icon={ShieldAlert} label="Задачи с ошибкой" value={o.dead_jobs} tone={o.dead_jobs ? 'red' : undefined} onClick={() => setTab('jobs')} />
          <Tile icon={Siren} label="Открытые инциденты" value={o.open_incidents} tone={o.open_incidents ? 'red' : undefined} onClick={() => setTab('incidents')} />
          <Tile icon={Bell} label="Уведомления в очереди" value={s?.notifications.pending ?? '—'} sub={s ? `не доставлено ${s.notifications.failed}` : undefined} onClick={() => setTab('settings')} />
        </>)}
      </div>

      <div className="pt-2">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'jobs', label: 'Очередь ошибок', icon: ShieldAlert },
          { value: 'incidents', label: 'Инциденты', icon: Siren },
          { value: 'tasks', label: 'Фоновые задачи', icon: Clock },
          { value: 'settings', label: 'Настройки', icon: Settings2 },
        ]} />
        {tab === 'jobs' && <JobsTab onChanged={() => overview.reload(true)} />}
        {tab === 'incidents' && <IncidentsTab onChanged={() => overview.reload(true)} />}
        {tab === 'tasks' && <TasksTab tasks={o?.tasks ?? null} onChanged={() => overview.reload(true)} />}
        {tab === 'settings' && <SettingsTab status={s} onChanged={() => status.reload(true)} />}
      </div>
    </div>
  )
}

function Health({ icon: Icon, label, ok, sub, extra }: { icon: typeof Bot; label: string; ok: boolean | undefined; sub?: string | null; extra?: string }) {
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl',
        ok === undefined ? 'bg-white/[0.05] text-muted' : ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger')}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {label}
          {ok !== undefined && <Badge tone={ok ? 'green' : 'red'} dot>{ok ? 'работает' : 'нет связи'}</Badge>}
        </div>
        <div className="truncate text-xs text-muted">{extra ?? (sub !== undefined ? `сигнал: ${ago(sub)}` : '…')}</div>
      </div>
    </div>
  )
}

function Tile({ icon: Icon, label, value, sub, tone, to, onClick }: {
  icon: typeof Bot; label: string; value: number | string; sub?: string; tone?: 'red' | 'amber'; to?: string; onClick?: () => void
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-semibold text-muted">{label}</span>
        <Icon className={clsx('h-4 w-4 shrink-0', tone === 'red' ? 'text-danger' : tone === 'amber' ? 'text-warning' : 'text-primary-soft')} />
      </div>
      <div className={clsx('tabular mt-1.5 truncate font-display text-xl font-bold', tone === 'red' && 'text-danger', tone === 'amber' && 'text-warning')}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </>
  )
  const cls = 'card block min-w-0 p-3.5 text-left transition'
  if (to) return <Link to={to} className={clsx(cls, 'hover:border-white/[0.12]')}>{body}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={clsx(cls, 'hover:border-white/[0.12]')}>{body}</button>
  return <div className={cls}>{body}</div>
}

// ------------------------------------------------------------------ jobs

function JobsTab({ onChanged }: { onChanged: () => void }) {
  const [st, setSt] = useState<'dead' | 'pending' | 'running' | 'done'>('dead')
  const { data, loading, error, reload } = useApi<JobRow[]>(`/automation/jobs${qs({ status: st })}`, { poll: 30_000 })
  const can = useCan('system.automation')
  const toast = useToast()
  const [busy, setBusy] = useState<number | null>(null)
  const retry = async (j: JobRow) => {
    setBusy(j.id)
    try {
      await api(`/automation/jobs/${j.id}/retry`, { method: 'POST' })
      toast(`Задача #${j.id} снова в очереди`)
      await reload(true)
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(null) }
  }
  const orderLink = (j: JobRow) => j.order_id
    ? <Link to={`/orders/${j.order_id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-semibold text-primary-soft">Заказ #{j.order_id}<ExternalLink className="h-3 w-3" /></Link>
    : <span className="text-muted">—</span>
  const action = (j: JobRow) => j.status === 'dead' && can
    ? <Btn size="sm" variant="secondary" loading={busy === j.id} onClick={() => retry(j)}><RotateCcw className="h-3.5 w-3.5" /> Повторить</Btn>
    : null
  return (
    <div>
      <Chips className="mb-3" value={st} onChange={setSt} options={(['dead', 'pending', 'running', 'done'] as const).map((v) => ({ value: v, label: JOB_STATUS[v].label }))} />
      {st === 'dead' && <p className="mb-3 text-xs text-muted">Задачи, остановленные после всех попыток. «Повторить» сбрасывает счётчик и ставит задачу в очередь заново.</p>}
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable rows={data} loading={loading} rowKey={(j) => j.id} emptyText={st === 'dead' ? 'Ошибок нет' : 'Задач нет'}
        columns={[
          { header: '#', cell: (j) => <span className="tabular font-mono text-muted">{j.id}</span> },
          { header: 'Тип', cell: (j) => <span className="font-semibold">{JOB_KIND[j.kind] ?? j.kind}</span> },
          { header: 'Заказ', cell: orderLink },
          { header: 'Попытки', cell: (j) => <span className="tabular">{j.attempts}/{j.max_attempts}</span> },
          { header: 'Ошибка', cell: (j) => <span className="block max-w-[320px] truncate text-xs text-muted" title={j.last_error ?? ''}>{j.last_error || '—'}</span> },
          { header: 'Запуск', cell: (j) => <span className="whitespace-nowrap text-muted">{dt(j.run_at)}</span> },
          { header: '', align: 'right', cell: action },
        ]}
        card={(j) => (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{JOB_KIND[j.kind] ?? j.kind} <span className="font-mono text-xs text-muted">#{j.id}</span></div>
                <div className="mt-0.5 text-xs text-muted">попытки {j.attempts}/{j.max_attempts} · {dt(j.run_at)}</div>
              </div>
              <Badge tone={JOB_STATUS[j.status]?.tone ?? 'gray'}>{JOB_STATUS[j.status]?.label ?? j.status}</Badge>
            </div>
            {j.last_error && <div className="mt-2 break-words rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{j.last_error}</div>}
            <div className="mt-2 flex items-center justify-between gap-2 text-sm">{orderLink(j)}{action(j)}</div>
          </div>
        )} />
    </div>
  )
}

// ------------------------------------------------------------- incidents

function IncidentsTab({ onChanged }: { onChanged: () => void }) {
  const [st, setSt] = useState<'open' | 'resolved' | 'all'>('open')
  const { data, loading, error, reload } = useApi<IncidentRow[]>(`/incidents${qs({ status: st })}`, { poll: 30_000 })
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState<number | null>(null)
  const resolve = async (i: IncidentRow) => {
    const note = await confirm({ title: 'Отметить инцидент решённым?', text: i.title, confirmLabel: 'Решено', input: { label: 'Что сделано', placeholder: 'Необязательно' } })
    if (note === false) return
    setBusy(i.id)
    try {
      await api(`/incidents/${i.id}/resolve`, { method: 'POST', body: { note } })
      toast('Инцидент закрыт')
      await reload(true)
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(null) }
  }
  return (
    <div>
      <Chips className="mb-3" value={st} onChange={setSt} options={[{ value: 'open', label: 'Открытые' }, { value: 'resolved', label: 'Решённые' }, { value: 'all', label: 'Все' }]} />
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      {loading ? <Skeleton className="h-40 rounded-2xl" /> : !data?.length ? (
        <div className="card"><Empty icon={CheckCircle2} title={st === 'open' ? 'Открытых инцидентов нет' : 'Инцидентов нет'} /></div>
      ) : (
        <div className="space-y-2">
          {data.map((i) => {
            const sev = SEVERITY[i.severity] ?? { label: i.severity, tone: 'gray' as const }
            const details = Object.entries(i.details ?? {})
            return (
              <div key={i.id} className="card p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={sev.tone}>{sev.label}</Badge>
                      {i.status === 'resolved' && <Badge tone="green">Решён</Badge>}
                      <span className="font-mono text-xs text-muted">{i.kind}</span>
                    </div>
                    <div className="mt-1.5 font-semibold">{i.title}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {dt(i.created_at)}
                      {i.resolved_at && ` · решён ${dt(i.resolved_at)}${i.resolved_by ? ` (${i.resolved_by})` : ''}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {i.order_id && <Link to={`/orders/${i.order_id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-soft">Заказ #{i.order_id}<ExternalLink className="h-3 w-3" /></Link>}
                    {i.status === 'open' && <Btn size="sm" variant="success" loading={busy === i.id} onClick={() => resolve(i)}><CheckCircle2 className="h-3.5 w-3.5" /> Решено</Btn>}
                  </div>
                </div>
                {details.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-muted">Подробности</summary>
                    <dl className="mt-1.5 space-y-1 rounded-lg bg-white/[0.03] p-2.5">
                      {details.map(([k, v]) => (
                        <div key={k} className="flex gap-2"><dt className="shrink-0 font-mono text-muted">{k}:</dt><dd className="min-w-0 break-words">{typeof v === 'string' ? v : JSON.stringify(v)}</dd></div>
                      ))}
                    </dl>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- tasks

function TasksTab({ tasks, onChanged }: { tasks: TaskRow[] | null; onChanged: () => void }) {
  const can = useCan('system.automation')
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const runNow = async (name: string) => {
    setBusy(name)
    try {
      const r = await api<{ result: unknown }>(`/automation/tasks/${name}/run`, { method: 'POST' })
      const text = typeof r.result === 'string' ? r.result : JSON.stringify(r.result)
      toast(`${TASK_LABEL[name] ?? name}: ${text || 'готово'}`)
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy('') }
  }
  const ok = (t: TaskRow) => !t.last_error || (t.last_success_at !== null && t.last_started_at !== null && t.last_success_at >= t.last_started_at)
  const action = (t: TaskRow) => can && ON_DEMAND.includes(t.name)
    ? <Btn size="sm" variant="secondary" loading={busy === t.name} onClick={() => runNow(t.name)}><Play className="h-3.5 w-3.5" /> Запустить сейчас</Btn>
    : null
  return (
    <DataTable rows={tasks} loading={tasks === null} rowKey={(t) => t.name} emptyText="Задачи ещё не запускались"
      columns={[
        { header: 'Задача', cell: (t) => <div><div className="font-semibold">{TASK_LABEL[t.name] ?? t.name}</div><div className="font-mono text-[11px] text-muted">{t.name} · каждые {every(t.interval)}</div></div> },
        { header: 'Последний запуск', cell: (t) => <span className="whitespace-nowrap text-muted">{ago(t.last_started_at)}</span> },
        { header: 'Успех', cell: (t) => <span className="whitespace-nowrap text-muted">{ago(t.last_success_at)}</span> },
        { header: 'Длительность', align: 'right', cell: (t) => <span className="tabular text-muted">{t.last_duration_ms === null ? '—' : `${t.last_duration_ms} мс`}</span> },
        { header: 'Запусков / ошибок', align: 'right', cell: (t) => <span className="tabular">{t.runs} / <span className={t.failures ? 'text-danger' : 'text-muted'}>{t.failures}</span></span> },
        { header: 'Состояние', cell: (t) => ok(t) ? <Badge tone="green" dot>ОК</Badge> : <span title={t.last_error ?? ''}><Badge tone="red" dot>Ошибка</Badge></span> },
        { header: '', align: 'right', cell: action },
      ]}
      card={(t) => (
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold">{TASK_LABEL[t.name] ?? t.name}</div>
              <div className="font-mono text-[11px] text-muted">{t.name} · каждые {every(t.interval)}</div>
            </div>
            {ok(t) ? <Badge tone="green" dot>ОК</Badge> : <Badge tone="red" dot>Ошибка</Badge>}
          </div>
          <div className="mt-1.5 text-xs text-muted">
            запуск {ago(t.last_started_at)} · успех {ago(t.last_success_at)}{t.last_duration_ms !== null ? ` · ${t.last_duration_ms} мс` : ''} · {t.runs} / {t.failures} ошиб.
          </div>
          {t.last_error && !ok(t) && <div className="mt-2 break-words rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{t.last_error}</div>}
          {action(t) && <div className="mt-2">{action(t)}</div>}
        </div>
      )} />
  )
}

// -------------------------------------------------------------- settings

function SettingsTab({ status: s, onChanged }: { status: SystemStatus | null; onChanged: () => void }) {
  const { rows, setRows, error } = useSettings()
  const canAuto = useCan('system.automation')
  const canSettings = useCan('system.settings')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const retry = async () => {
    setBusy(true)
    try {
      const r = await api<{ sent: number; failed: number }>('/system/notifications/retry', { method: 'POST' })
      toast(`Отправлено: ${r.sent}${r.failed ? `, не удалось: ${r.failed}` : ''}`)
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      {error && <ErrorBox text={error} />}
      <Card title="Недоставленные уведомления" action={canAuto && <Btn size="sm" variant="secondary" loading={busy} onClick={retry}><RefreshCw className="h-3.5 w-3.5" /> Отправить сейчас</Btn>}>
        {!s ? <Skeleton className="h-10" /> : (
          <div className="flex items-center gap-3 text-sm">
            <Bell className="h-5 w-5 shrink-0 text-muted" />
            <span>В очереди: <b>{s.notifications.pending}</b> · окончательно не доставлено: <b>{s.notifications.failed}</b> · доставлено повторно: <b>{s.notifications.sent}</b></span>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">«Не доставлено» — пользователь заблокировал бота или удалил чат; такие сообщения не повторяются.</p>
      </Card>

      <SettingsSection title="Режим технического обслуживания" rows={rows} onSaved={setRows} readOnly={!canSettings}
        description="Покупатели смогут просматривать каталог, но покупки и пополнения будут временно отключены (в Mini App и в боте)."
        fields={[
          { key: 'maintenance_mode', label: 'Технический режим', hint: 'Включайте на время работ с товарами или оплатой', danger: true },
          { key: 'maintenance_message', label: 'Сообщение для покупателей', multiline: true },
        ]} />

      <SettingsSection title="Заказы и склад" rows={rows} onSaved={setRows} readOnly={!canAuto} fields={[
        { key: 'auto_complete_digital', label: 'Автозавершение цифровых товаров', hint: 'Оплаченный заказ из категории «digital» с заполненной инструкцией сразу выдаётся покупателю' },
        { key: 'expire_reservations', label: 'Очистка просроченных резервов', hint: 'Неоплаченные заказы отменяются по таймеру, товар возвращается в продажу' },
        { key: 'low_stock_alerts', label: 'Уведомления о низких остатках', hint: 'Сообщение администраторам в Telegram, когда остаток опускается до порога' },
        { key: 'low_stock_threshold', label: 'Порог низкого остатка', suffix: 'шт' },
      ]} />

      <SettingsSection title="Надёжность" rows={rows} onSaved={setRows} readOnly={!canAuto} fields={[
        { key: 'notification_retry', label: 'Повторная отправка уведомлений', hint: 'Недоставленные сообщения Telegram повторяются с паузой до 6 раз' },
        { key: 'auto_backup', label: 'Автоматическое резервное копирование', hint: 'Копии создаются по расписанию; список — в разделе «Система»' },
        { key: 'backup_interval_hours', label: 'Интервал копирования', suffix: 'ч' },
        { key: 'error_monitoring', label: 'Мониторинг ошибок', hint: 'Сообщать администраторам об ошибках сервера и Mini App (не чаще раза в 10 минут)' },
      ]} />
    </div>
  )
}
