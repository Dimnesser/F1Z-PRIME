import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, SendHorizontal, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Badge, IconButton, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { useBack } from '../lib/useBack'
import { TICKET_STATUS } from './Support'

export default function Ticket() {
  useBack('/support')
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const { data: t, isLoading } = useQuery({ queryKey: ['ticket', id], queryFn: () => api.ticket(Number(id)), refetchInterval: 10000 })

  const send = useMutation({
    mutationFn: () => api.replyTicket(Number(id), text.trim()),
    onSuccess: (data) => {
      setText('')
      qc.setQueryData(['ticket', id], data)
    },
    onError: (e) => toast((e as Error).message, 'error'),
  })

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [t?.messages.length])

  if (isLoading || !t) return <div className="space-y-3"><Skeleton className="h-11 w-11 rounded-[14px]" /><Skeleton className="h-80 rounded-[24px]" /></div>
  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="mb-4 flex items-center gap-3">
        <IconButton label="Назад" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold tracking-tight">{t.subject}</h1>
          <div className="text-[12px] text-muted">Обращение #{t.id}</div>
        </div>
        <Badge tone={TICKET_STATUS[t.status].tone} dot>{TICKET_STATUS[t.status].label}</Badge>
      </div>
      <div className="flex-1 space-y-2.5">
        {t.messages.map((m) => (
          <div key={m.id} className={clsx('fade-in flex', m.is_admin ? 'justify-start' : 'justify-end')}>
            <div className={clsx('max-w-[82%] rounded-[20px] px-4 py-2.5 text-[14px] leading-relaxed', m.is_admin ? 'rounded-bl-md bg-surface ring-1 ring-inset ring-line/80' : 'rounded-br-md bg-primary text-primary-ink')}>
              {m.is_admin && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-accent"><ShieldCheck className="h-3 w-3" /> Поддержка</div>}
              <div className="whitespace-pre-line break-words">{m.text}</div>
              <div className={clsx('mt-1 text-right text-[10.5px]', m.is_admin ? 'text-muted' : 'text-primary-ink/70')}>
                {new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {t.status !== 'closed' ? (
        <div className="sticky-cta sticky mt-4 flex items-end gap-2 rounded-[20px] border border-line/80 bg-surface/90 p-2 shadow-pop backdrop-blur-xl">
          <textarea rows={1} aria-label="Сообщение" className="input max-h-32 min-h-[48px] resize-none border-transparent bg-transparent focus:ring-0" placeholder="Сообщение…" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
          <button type="button" aria-label="Отправить" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()} className="pressable grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-ink shadow-glow disabled:opacity-45">
            <SendHorizontal className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-ov/[0.04] p-3 text-center text-sm text-muted">Обращение закрыто</div>
      )}
    </div>
  )
}
