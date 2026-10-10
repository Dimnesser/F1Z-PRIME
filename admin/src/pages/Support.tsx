import clsx from 'clsx'
import { SendHorizontal, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Btn, PageHead, Skeleton, UserCell, useToast, type Tone } from '../components/ui'
import { api, dt } from '../lib/api'
import type { Ticket } from '../lib/types'
import { useApi } from '../lib/useApi'

const ST: Record<Ticket['status'], { l: string; t: Tone }> = { open: { l: 'Открыто', t: 'amber' }, answered: { l: 'Отвечено', t: 'green' }, closed: { l: 'Закрыто', t: 'gray' } }

export default function Support() {
  const toast = useToast()
  const [status, setStatus] = useState('')
  const { data: tickets, loading, reload } = useApi<Ticket[]>(`/support/tickets${status ? `?status=${status}` : ''}`)
  const [active, setActive] = useState<number | null>(null)
  const { data: t, setData } = useApi<Ticket>(active ? `/support/tickets/${active}` : null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!active && tickets?.length) setActive(tickets[0].id) }, [tickets, active])

  const reply = async () => {
    setBusy(true)
    try {
      setData(await api<Ticket>(`/support/tickets/${active}/reply`, { method: 'POST', body: { text } }))
      setText('')
      toast('Ответ отправлен пользователю в Telegram')
      reload()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const setTicketStatus = async (s: string) => {
    try { setData(await api<Ticket>(`/support/tickets/${active}/status`, { method: 'POST', body: { status: s } })); reload() } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div>
      <PageHead title="Support" subtitle="Обращения пользователей из Mini App и бота">
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все</option><option value="open">Открытые</option><option value="answered">Отвеченные</option><option value="closed">Закрытые</option>
        </select>
      </PageHead>
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="card max-h-[70vh] space-y-1 overflow-y-auto p-2">
          {loading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
          {tickets?.length === 0 && <div className="p-6 text-center text-sm text-muted">Обращений нет</div>}
          {tickets?.map((x) => (
            <button key={x.id} onClick={() => setActive(x.id)} className={clsx('w-full rounded-2xl p-3 text-left transition', active === x.id ? 'bg-brand-soft ring-1 ring-primary/30' : 'hover:bg-white/[0.03]')}>
              <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold">{x.subject}</span><Badge tone={ST[x.status].t}>{ST[x.status].l}</Badge></div>
              <div className="mt-1 text-xs text-muted">#{x.id} · {x.user.username ? '@' + x.user.username : x.user.telegram_id} · {dt(x.updated_at)}</div>
            </button>
          ))}
        </div>
        <div className="card flex min-h-[60vh] flex-col p-5">
          {!t ? <div className="m-auto text-sm text-muted">Выберите обращение</div> : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
                <div><div className="font-display text-lg font-semibold">{t.subject}</div><div className="mt-1"><UserCell u={t.user} /></div></div>
                <div className="flex gap-2">
                  {t.status !== 'closed' ? <Btn variant="ghost" onClick={() => setTicketStatus('closed')}>Закрыть</Btn> : <Btn variant="ghost" onClick={() => setTicketStatus('open')}>Открыть снова</Btn>}
                </div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto">
                {t.messages?.map((m) => (
                  <div key={m.id} className={clsx('flex', m.is_admin ? 'justify-end' : 'justify-start')}>
                    <div className={clsx('max-w-[75%] rounded-2xl px-4 py-2.5 text-sm', m.is_admin ? 'bg-brand text-white' : 'bg-white/[0.05] ring-1 ring-white/[0.06]')}>
                      {m.is_admin && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-bold text-white/80"><ShieldCheck className="h-3 w-3" /> Поддержка</div>}
                      <div className="whitespace-pre-line break-words">{m.text}</div>
                      <div className={clsx('mt-1 text-right text-[10.5px]', m.is_admin ? 'text-white/70' : 'text-muted')}>{dt(m.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <textarea className="input min-h-[52px] flex-1 resize-none" placeholder="Ответ пользователю (придёт в Telegram)" value={text} onChange={(e) => setText(e.target.value)} />
                <Btn className="h-auto px-5" loading={busy} disabled={!text.trim()} onClick={reply}><SendHorizontal className="h-4 w-4" /></Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
