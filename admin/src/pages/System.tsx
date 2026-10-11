import clsx from 'clsx'
import {
  Archive, Bot, Database, Download, Eye, FileText, HardDrive, Info, MessageSquareText, RefreshCw, RotateCcw, Save, Send, Server,
  ShieldAlert, Workflow,
} from 'lucide-react'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn, Card, ErrorBox, Field, KV, Modal, PageHead, Skeleton, Toggle, useConfirm, useToast } from '../components/ui'
import { ago, api, download, dt, errMsg } from '../lib/api'
import { useCan, useMe } from '../lib/session'
import { useApi } from '../lib/useApi'
import type { SystemStatus } from './Automation'

interface ErrorRow { at: string; source: string; message: string; path: string; detail: string }
interface Backup { name: string; size: number; created_at: string }
interface Template {
  key: string; audience: 'customer' | 'staff'; title: string; enabled: boolean; text: string; button_text: string
  customized: boolean; default_text: string; variables: string[]
}

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`)

export default function System() {
  const me = useMe()
  const canBackups = useCan('system.backups')
  const canTemplates = useCan('notifications.manage')
  const status = useApi<SystemStatus>('/system/status', { poll: 30_000 })
  const errors = useApi<ErrorRow[]>('/system/errors?limit=50')
  const s = status.data

  return (
    <div className="fade-in space-y-4">
      <PageHead title="Система" subtitle={s ? `Версия ${s.version} · окружение ${s.environment}` : 'Состояние сервера, копии данных и шаблоны уведомлений'}>
        <Btn variant="secondary" loading={status.refreshing} onClick={() => { void status.reload(true); void errors.reload(true) }}><RefreshCw className="h-4 w-4" /> Обновить</Btn>
      </PageHead>
      {status.error && <ErrorBox text={status.error} onRetry={() => status.reload()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {!s ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[76px] rounded-2xl" />) : (<>
          <HealthTile icon={Server} label="API" ok={s.api.ok} sub={`версия ${s.version}`} />
          <HealthTile icon={Database} label="База данных" ok={s.database.ok} sub={s.database.ok ? 'отвечает' : 'нет ответа'} />
          <HealthTile icon={Workflow} label="Воркер" ok={s.worker.ok} sub={`сигнал ${ago(s.worker.last_seen)}`} />
          <HealthTile icon={Bot} label="Бот" ok={s.bot.ok && s.bot.configured} sub={s.bot.configured ? `сигнал ${ago(s.bot.last_seen)}` : 'BOT_TOKEN не задан'} />
          <HealthTile icon={ShieldAlert} label="Магазин" ok={!s.maintenance} sub={s.maintenance ? 'техобслуживание' : 'работает'} okText="открыт" badText="закрыт" />
        </>)}
      </div>

      {s && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Фоновые задачи" action={<Link to="/automation" className="text-sm font-semibold text-primary-soft">Центр →</Link>}>
            <div className="grid grid-cols-2 gap-2">
              <KV label="В очереди">{s.jobs.pending}</KV>
              <KV label="Выполняются">{s.jobs.running}</KV>
              <KV label="С ошибкой"><span className={s.jobs.dead ? 'text-danger' : ''}>{s.jobs.dead}</span></KV>
              <KV label="Готово">{s.jobs.done}</KV>
            </div>
          </Card>
          <Card title="Заказы и инциденты">
            <div className="grid grid-cols-2 gap-2">
              <KV label="Не выданы">{s.unprocessed_orders}</KV>
              <KV label="Инциденты"><span className={s.open_incidents ? 'text-danger' : ''}>{s.open_incidents}</span></KV>
              <KV label="Уведомл. в очереди">{s.notifications.pending}</KV>
              <KV label="Не доставлено">{s.notifications.failed}</KV>
            </div>
          </Card>
          <Card title="Приём оплаты">
            <div className="space-y-2 text-sm">
              <Row label="Telegram Stars">
                {!s.payments.stars.enabled ? <Badge tone="gray">выключено</Badge> : s.payments.stars.configured ? <Badge tone="green" dot>работает</Badge> : <Badge tone="red" dot>нет токена бота</Badge>}
              </Row>
              <Row label="Ручной перевод">{s.payments.manual.enabled ? <Badge tone="green" dot>включено</Badge> : <Badge tone="gray">выключено</Badge>}</Row>
              <Row label="Ошибки за 24 ч"><span className="tabular font-semibold">{s.errors.last_24h} <span className="font-normal text-muted">(сервер {s.errors.server_24h}, Mini App {s.errors.client_24h})</span></span></Row>
              <Row label="Получатели алертов"><span className="tabular font-semibold">{s.admin_notify_ids}</span></Row>
            </div>
          </Card>
        </div>
      )}

      <Card title="Последние ошибки" action={<Btn size="sm" variant="ghost" onClick={() => errors.reload(true)} aria-label="Обновить"><RefreshCw className="h-3.5 w-3.5" /></Btn>}>
        {errors.error && <ErrorBox text={errors.error} />}
        {!errors.data ? <Skeleton className="h-20" /> : errors.data.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted"><ShieldAlert className="h-4 w-4 text-success" /> Ошибок с последнего перезапуска сервера нет</div>
        ) : (
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
            {errors.data.map((e, i) => (
              <details key={i} className="rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                <summary className="flex cursor-pointer list-none items-center gap-2">
                  <Badge tone={e.source === 'server' ? 'red' : 'amber'}>{e.source === 'server' ? 'Сервер' : 'Mini App'}</Badge>
                  <span className="min-w-0 flex-1 truncate">{e.message}</span>
                  <span className="shrink-0 text-xs text-muted">{ago(e.at)}</span>
                </summary>
                <div className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-muted">{e.path}{e.detail ? `\n${e.detail}` : ''}</div>
              </details>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">Журнал хранится в памяти сервера и очищается при перезапуске.</p>
      </Card>

      {canBackups && <Backups isOwner={me.is_owner} onChanged={() => status.reload(true)} />}
      {canTemplates && <Templates />}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-muted">{label}</span>{children}</div>
}

function HealthTile({ icon: Icon, label, ok, sub, okText = 'в норме', badText = 'сбой' }: { icon: typeof Bot; label: string; ok: boolean; sub: string; okText?: string; badText?: string }) {
  return (
    <div className="card min-w-0 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-muted" />{label}</span>
        <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', ok ? 'bg-success shadow-[0_0_10px_rgba(34,197,94,0.7)]' : 'bg-danger shadow-[0_0_10px_rgba(239,68,68,0.7)]')} />
      </div>
      <div className={clsx('mt-1 text-xs font-semibold', ok ? 'text-success' : 'text-danger')}>{ok ? okText : badText}</div>
      <div className="truncate text-xs text-muted">{sub}</div>
    </div>
  )
}

// ---------------------------------------------------------------- backups

function Backups({ isOwner, onChanged }: { isOwner: boolean; onChanged: () => void }) {
  const { data, error, reload } = useApi<Backup[]>('/system/backups')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const r = await api<Backup>('/system/backups', { method: 'POST' })
      toast(`Копия создана: ${r.name}`)
      await reload(true)
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  return (
    <Card title="Резервные копии" action={<Btn size="sm" loading={busy} onClick={create}><Archive className="h-3.5 w-3.5" /> Создать копию</Btn>}>
      {error && <ErrorBox text={error} />}
      {!data ? <Skeleton className="h-20" /> : data.length === 0 ? <div className="text-sm text-muted">Копий пока нет</div> : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {data.map((b) => (
            <div key={b.name} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.03]">
              <span className="flex min-w-0 items-center gap-2.5">
                <HardDrive className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0"><span className="block truncate font-mono text-xs">{b.name}</span><span className="text-xs text-muted">{dt(b.created_at)} · {size(b.size)}</span></span>
              </span>
              {isOwner && (
                <Btn size="sm" variant="ghost" aria-label="Скачать" onClick={() => download(`/system/backups/${encodeURIComponent(b.name)}`, b.name).catch((e) => toast(errMsg(e), 'error'))}>
                  <Download className="h-4 w-4" /><span className="hidden sm:inline">Скачать</span>
                </Btn>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 text-xs text-muted">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          {isOwner ? 'Скачивание копий доступно только владельцу.' : 'Скачать копию может только владелец магазина.'}
          {' '}Восстановление выполняется только владельцем на сервере, через панель не делается.
        </span>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------- templates

function Templates() {
  const { data, error, loading, reload } = useApi<Template[]>('/notification-templates')
  const [edit, setEdit] = useState<Template | null>(null)
  const groups: { key: Template['audience']; title: string }[] = [{ key: 'customer', title: 'Покупателям' }, { key: 'staff', title: 'Сотрудникам' }]
  return (
    <Card title="Шаблоны уведомлений" action={<span className="text-xs text-muted">Telegram HTML</span>}>
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      {loading || !data ? <Skeleton className="h-40" /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{g.title}</div>
              <div className="space-y-1">
                {data.filter((t) => t.audience === g.key).map((t) => (
                  <button key={t.key} type="button" onClick={() => setEdit(t)}
                    className="flex w-full items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-left text-sm transition hover:bg-white/[0.06]">
                    <MessageSquareText className={clsx('h-4 w-4 shrink-0', t.enabled ? 'text-primary-soft' : 'text-muted/50')} />
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block truncate font-semibold', !t.enabled && 'text-muted')}>{t.title}</span>
                      <span className="block truncate font-mono text-[11px] text-muted">{t.key}</span>
                    </span>
                    {t.customized && <Badge tone="violet">изменён</Badge>}
                    {!t.enabled && <Badge tone="gray">выкл</Badge>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <TemplateEditor key={edit.key} t={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(true) }} />}
    </Card>
  )
}

function TemplateEditor({ t, onClose, onSaved }: { t: Template; onClose: () => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(t.enabled)
  const [text, setText] = useState(t.text)
  const [button, setButton] = useState(t.button_text)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const dirty = enabled !== t.enabled || text !== t.text || button !== t.button_text

  useEffect(() => { setPreview(null) }, [text])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn() } catch (e) { toast(errMsg(e), 'error') } finally { setBusy('') }
  }
  const doPreview = () => run('preview', async () => {
    const r = await api<{ html: string }>(`/notification-templates/${t.key}/preview`, { method: 'POST', body: { text } })
    setPreview(r.html)
  })
  const save = () => run('save', async () => {
    await api(`/notification-templates/${t.key}`, { method: 'PUT', body: { enabled, text, button_text: button } })
    toast('Шаблон сохранён')
    onSaved()
  })
  const reset = async () => {
    if (await confirm({ title: 'Сбросить шаблон?', text: 'Текст, кнопка и включение вернутся к стандартным.', danger: true, confirmLabel: 'Сбросить' }) === false) return
    await run('reset', async () => {
      await api(`/notification-templates/${t.key}`, { method: 'DELETE' })
      toast('Шаблон сброшен к стандартному')
      onSaved()
    })
  }
  const test = () => run('test', async () => {
    await api(`/notification-templates/${t.key}/test`, { method: 'POST', body: { text } })
    toast('Тест отправлен в ваш Telegram')
  })
  const insert = (v: string) => setText((s) => `${s}{${v}}`)

  return (
    <Modal open onClose={onClose} size="lg" title={t.title}
      subtitle={<span className="font-mono text-xs">{t.key} · {t.audience === 'customer' ? 'покупателю' : 'сотрудникам'}</span>}
      footer={<>
        {t.customized && <Btn variant="ghost" loading={busy === 'reset'} onClick={reset}><RotateCcw className="h-4 w-4" /> Сбросить</Btn>}
        <Btn variant="secondary" loading={busy === 'test'} disabled={!text.trim()} onClick={test}><Send className="h-4 w-4" /> Тест себе</Btn>
        <Btn loading={busy === 'save'} disabled={!dirty || !text.trim()} onClick={save}><Save className="h-4 w-4" /> Сохранить</Btn>
      </>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Отправлять это уведомление</div>
            <div className="text-xs text-muted">Выключенный шаблон не отправляется совсем</div>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Отправлять" />
        </div>
        <Field label="Текст сообщения" hint={<>Разрешённые теги: <code>&lt;b&gt;</code> <code>&lt;i&gt;</code> <code>&lt;u&gt;</code> <code>&lt;s&gt;</code> <code>&lt;code&gt;</code> <code>&lt;pre&gt;</code> <code>&lt;a href&gt;</code>. Переменные подставляются в фигурных скобках.</>}>
          <textarea className="input min-h-[160px] font-mono text-[13px]" value={text} maxLength={3500} onChange={(e) => setText(e.target.value)} />
        </Field>
        {t.variables.length > 0 && (
          <div>
            <div className="label">Переменные (нажмите, чтобы вставить)</div>
            <div className="flex flex-wrap gap-1.5">
              {t.variables.map((v) => (
                <button key={v} type="button" onClick={() => insert(v)} className="rounded-lg bg-white/[0.06] px-2 py-1 font-mono text-xs text-primary-soft hover:bg-white/[0.1]">{`{${v}}`}</button>
              ))}
            </div>
          </div>
        )}
        {t.audience === 'customer' && (
          <Field label="Текст кнопки" hint="Кнопка открывает заказ в Mini App. Пусто — без кнопки.">
            <input className="input" value={button} maxLength={64} onChange={(e) => setButton(e.target.value)} />
          </Field>
        )}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="label !mb-0">Предпросмотр (пример данных)</span>
            <Btn size="sm" variant="secondary" loading={busy === 'preview'} disabled={!text.trim()} onClick={doPreview}><Eye className="h-3.5 w-3.5" /> Предпросмотр</Btn>
          </div>
          {preview === null ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs text-muted"><FileText className="h-4 w-4" /> Нажмите «Предпросмотр», чтобы увидеть сообщение с подставленными данными</div>
          ) : (
            <div className="rounded-2xl bg-[#0E1621] p-3">
              <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-[#182533] px-3.5 py-2.5 text-[14px] leading-relaxed text-white shadow">
                <div className="whitespace-pre-wrap break-words">{renderTelegram(preview)}</div>
                <div className="mt-1 text-right text-[11px] text-white/40">F1Z PRIME</div>
              </div>
              {t.audience === 'customer' && button.trim() && (
                <div className="mt-1 max-w-[92%] rounded-xl bg-[#182533]/80 py-2 text-center text-[13px] font-semibold text-[#6AB2F2]">{button}</div>
              )}
            </div>
          )}
        </div>
        {t.customized && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Стандартный текст</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-white/[0.03] p-3 font-mono text-[11px] text-muted">{t.default_text}</pre>
          </details>
        )}
      </div>
    </Modal>
  )
}

// --------------------------------------------- safe Telegram-HTML renderer
// Builds React elements from the server-rendered preview. No innerHTML: only a small set of formatting
// tags becomes elements, every other tag is dropped and all text is rendered as plain text.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' }
const decode = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  const k = e.toLowerCase()
  if (ENTITIES[k]) return ENTITIES[k]
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16) || 0xfffd)
  if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)) || 0xfffd)
  return m
})
const FORMAT: Record<string, string> = {
  b: 'font-bold', strong: 'font-bold', i: 'italic', em: 'italic', u: 'underline', s: 'line-through',
  code: 'rounded bg-black/30 px-1 font-mono text-[13px]', pre: 'block rounded-lg bg-black/30 p-2 font-mono text-[13px]',
  a: 'text-[#6AB2F2] underline', 'tg-spoiler': 'rounded bg-white/20 px-0.5', blockquote: 'block border-l-2 border-[#6AB2F2] pl-2',
}

interface Node { tag: string | null; children: (Node | string)[] }

function renderTelegram(src: string): ReactNode {
  const root: Node = { tag: null, children: [] }
  const stack: Node[] = [root]
  const re = /<\s*(\/?)\s*([a-zA-Z0-9-]+)[^>]*>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index > last) stack[stack.length - 1].children.push(decode(src.slice(last, m.index)))
    last = re.lastIndex
    const tag = m[2].toLowerCase()
    if (!FORMAT[tag]) continue
    if (m[1]) {
      const idx = stack.map((n) => n.tag).lastIndexOf(tag)
      if (idx > 0) stack.length = idx
    } else {
      const node: Node = { tag, children: [] }
      stack[stack.length - 1].children.push(node)
      stack.push(node)
    }
  }
  if (last < src.length) stack[stack.length - 1].children.push(decode(src.slice(last)))
  const draw = (n: Node | string, k: number): ReactNode => {
    if (typeof n === 'string') return <Fragment key={k}>{n}</Fragment>
    return <span key={k} className={n.tag ? FORMAT[n.tag] : undefined}>{n.children.map(draw)}</span>
  }
  return root.children.map(draw)
}
