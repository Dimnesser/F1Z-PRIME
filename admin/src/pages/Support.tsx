import clsx from 'clsx'
import { ArrowLeft, CheckCheck, ExternalLink, MessageSquare, RotateCcw, SendHorizontal, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Avatar, Badge, Btn, Chips, Empty, ErrorBox, IconBtn, PageHead, SearchInput, Skeleton, useConfirm, useToast, type Tone } from '../components/ui'
import { ago, api, dt, errMsg } from '../lib/api'
import { useMe } from '../lib/session'
import type { Ticket } from '../lib/types'
import { useApi, useDebounced, useMedia } from '../lib/useApi'

const ST: Record<Ticket['status'], { l: string; t: Tone }> = { open: { l: 'Новое', t: 'amber' }, answered: { l: 'Отвечено', t: 'green' }, closed: { l: 'Закрыто', t: 'gray' } }
const QUICK = [
  'Здравствуйте! Уже проверяем ваш вопрос.',
  'Ваш заказ в обработке, выдадим в ближайшее время.',
  'Платёж получен, спасибо за покупку!',
  'Уточните, пожалуйста, номер заказа.',
]

export default function Support({ onChange }: { onChange?: () => void }) {
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [assigned, setAssigned] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const path = `/support/tickets?${new URLSearchParams(Object.entries({ status, assigned, search: q }).filter(([, v]) => v))}`
  const { data: tickets, loading, error, reload } = useApi<Ticket[]>(path, { poll: 15_000 })
  const active = Number(params.get('t')) || null
  const desktop = useMedia('(min-width: 1024px)')
  const open = (id: number | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('t', String(id))
    else next.delete('t')
    setParams(next, { replace: !desktop })
  }
  // desktop: open the newest ticket automatically
  useEffect(() => {
    if (desktop && !active && tickets?.length) open(tickets[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, tickets, active])

  const list = (
    <div className="flex min-h-0 flex-col">
      <SearchInput className="mb-3" value={search} onChange={setSearch} placeholder="Тема, @username, ID" />
      <Chips className="mb-2" value={status} onChange={setStatus} options={[
        { value: '', label: 'Все' }, { value: 'open', label: 'Новые' }, { value: 'answered', label: 'Отвеченные' }, { value: 'closed', label: 'Закрытые' },
      ]} />
      <Chips className="mb-3" value={assigned} onChange={setAssigned} options={[{ value: '', label: 'Любой оператор' }, { value: 'me', label: 'Мои' }, { value: 'none', label: 'Не назначены' }]} />
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      <div className="card min-h-0 flex-1 divide-y divide-white/[0.05] overflow-y-auto lg:max-h-[calc(100vh-300px)]">
        {loading && <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
        {tickets?.length === 0 && <Empty icon={MessageSquare} title="Обращений нет" />}
        {tickets?.map((t) => (
          <button key={t.id} type="button" onClick={() => open(t.id)} className={clsx('flex w-full gap-3 p-3.5 text-left transition', active === t.id ? 'bg-primary/10' : 'hover:bg-white/[0.025]')}>
            <Avatar u={t.user} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold">{t.subject}</span>
                <span className="shrink-0 text-[11px] text-muted">{ago(t.updated_at)}</span>
              </div>
              <div className="mt-0.5 truncate text-[13px] text-muted">
                {t.last_message?.is_admin && <CheckCheck className="mr-1 inline h-3.5 w-3.5 text-secondary" />}{t.last_message?.text ?? '—'}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Badge tone={ST[t.status].t} dot>{ST[t.status].l}</Badge>
                <span className="truncate text-[11px] text-muted">#{t.id} · {t.user.username ? `@${t.user.username}` : t.user.telegram_id}{t.assigned_to ? ` · ${t.assigned_to}` : ''}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="fade-in">
      <PageHead title="Поддержка" subtitle="Ответы приходят пользователю в Telegram" />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {list}
        {desktop ? (
          <div className="card flex h-[calc(100vh-190px)] min-h-[480px] flex-col overflow-hidden">
            {active ? <Chat key={active} id={active} onChanged={() => { reload(true); onChange?.() }} /> : <Empty icon={MessageSquare} title="Выберите обращение" />}
          </div>
        ) : active && (
          <div className="fixed inset-0 z-50 flex flex-col bg-bg">
            <Chat key={active} id={active} onBack={() => open(null)} onChanged={() => { reload(true); onChange?.() }} />
          </div>
        )}
      </div>
    </div>
  )
}

function Chat({ id, onBack, onChanged }: { id: number; onBack?: () => void; onChanged: () => void }) {
  const { data: t, error, setData } = useApi<Ticket>(`/support/tickets/${id}`, { poll: 10_000 })
  const { data: operators } = useApi<{ username: string; role: string }[]>('/operators')
  const me = useMe()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const confirm = useConfirm()
  const count = t?.messages?.length ?? 0

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [count])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    try {
      setData(await api<Ticket>(`/support/tickets/${id}/reply`, { method: 'POST', body: { text: body } }))
      setText('')
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const setStatus = async (s: Ticket['status']) => {
    if (s === 'closed' && await confirm({ title: 'Закрыть обращение?', text: 'Пользователь получит уведомление. Обращение можно открыть снова.' }) === false) return
    try { setData(await api<Ticket>(`/support/tickets/${id}/status`, { method: 'POST', body: { status: s } })); onChanged() } catch (e) { toast(errMsg(e), 'error') }
  }
  const assign = async (who: string) => {
    try { setData(await api<Ticket>(`/support/tickets/${id}/assign`, { method: 'POST', body: { assigned_to: who || null } })); onChanged() } catch (e) { toast(errMsg(e), 'error') }
  }

  if (error) return <div className="p-4"><ErrorBox text={error} />{onBack && <Btn className="mt-3" variant="secondary" onClick={onBack}>Назад</Btn>}</div>
  if (!t) return <div className="p-4"><Skeleton className="h-full min-h-[300px]" /></div>
  const canAssignOthers = me.role !== 'support'
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-surface/80 px-3 py-3 backdrop-blur sm:px-5" style={{ paddingTop: onBack ? 'max(12px, env(safe-area-inset-top))' : undefined }}>
        {onBack && <IconBtn label="Назад" onClick={onBack}><ArrowLeft className="h-5 w-5" /></IconBtn>}
        <Avatar u={t.user} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{t.subject}</div>
          <div className="truncate text-xs text-muted">#{t.id} · {[t.user.first_name, t.user.username && `@${t.user.username}`].filter(Boolean).join(' ')} · {t.user.telegram_id}</div>
        </div>
        {t.user.username && <a href={`https://t.me/${t.user.username}`} target="_blank" rel="noreferrer" className="hidden sm:block"><IconBtn label="Открыть в Telegram"><ExternalLink className="h-4 w-4" /></IconBtn></a>}
        {t.status !== 'closed'
          ? <Btn size="sm" variant="secondary" onClick={() => setStatus('closed')}><CheckCheck className="h-4 w-4" /><span className="hidden sm:inline">Закрыть</span></Btn>
          : <Btn size="sm" variant="secondary" onClick={() => setStatus('open')}><RotateCcw className="h-4 w-4" /><span className="hidden sm:inline">Открыть</span></Btn>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-xs sm:px-5">
        <Badge tone={ST[t.status].t} dot>{ST[t.status].l}</Badge>
        <span className="text-muted">Оператор:</span>
        <select className="h-8 rounded-lg border border-white/[0.08] bg-surface px-2 text-xs outline-none" value={t.assigned_to ?? ''} onChange={(e) => assign(e.target.value)}>
          <option value="">не назначен</option>
          {(operators ?? []).filter((o) => canAssignOthers || o.username === me.username || o.username === t.assigned_to)
            .map((o) => <option key={o.username} value={o.username}>{o.username}{o.username === me.username ? ' (я)' : ''}</option>)}
        </select>
        <span className="ml-auto text-muted">создано {dt(t.created_at)}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-4 sm:px-5">
        {t.messages?.map((m, i) => {
          const prev = t.messages![i - 1]
          const day = new Date(m.created_at).toDateString() !== (prev ? new Date(prev.created_at).toDateString() : '')
          return (
            <div key={m.id}>
              {day && <div className="my-3 text-center text-[11px] text-muted">{new Date(m.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>}
              <div className={clsx('flex', m.is_admin ? 'justify-end' : 'justify-start')}>
                <div className={clsx('max-w-[85%] rounded-2xl px-3.5 py-2 text-[14.5px] leading-relaxed sm:max-w-[70%]', m.is_admin ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-elevated')}>
                  {m.is_admin && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-bold text-white/75"><ShieldCheck className="h-3 w-3" /> Поддержка</div>}
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                  <div className={clsx('mt-0.5 text-right text-[10.5px]', m.is_admin ? 'text-white/65' : 'text-muted')}>{new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>
      <div className="pb-safe shrink-0 border-t border-white/[0.06] bg-surface/80 px-3 py-3 sm:px-5">
        <div className="no-scrollbar -mx-3 mb-2 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          {QUICK.map((qr) => <button key={qr} type="button" className="chip h-8 text-xs" onClick={() => setText(qr)}>{qr.length > 34 ? `${qr.slice(0, 34)}…` : qr}</button>)}
        </div>
        <div className="flex items-end gap-2">
          <textarea className="input max-h-40 min-h-[44px] flex-1 resize-none py-2.5" rows={1} placeholder={t.status === 'closed' ? 'Ответ откроет обращение снова' : 'Сообщение пользователю'}
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send() }} />
          <Btn className="h-11 w-11 shrink-0 px-0" loading={busy} disabled={!text.trim()} onClick={send} aria-label="Отправить">{!busy && <SendHorizontal className="h-5 w-5" />}</Btn>
        </div>
        <div className="mt-1.5 hidden text-[11px] text-muted sm:block">Ctrl + Enter — отправить</div>
      </div>
    </>
  )
}
