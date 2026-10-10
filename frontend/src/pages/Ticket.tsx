import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ArrowLeft, SendHorizontal, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Badge, Skeleton } from '../components/ui'
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

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [t?.messages.length])

  if (isLoading || !t) return <Skeleton className="h-80 rounded-3xl" />
  return (
    <div className="flex min-h-[70vh] flex-col">
      <button onClick={() => navigate(-1)} className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-muted pressable">
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-bold">{t.subject}</div>
          <div className="text-[12px] text-muted">Обращение #{t.id}</div>
        </div>
        <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
      </div>
      <div className="flex-1 space-y-2.5">
        {t.messages.map((m) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={clsx('flex', m.is_admin ? 'justify-start' : 'justify-end')}>
            <div className={clsx('max-w-[82%] rounded-3xl px-4 py-2.5 text-[14px] leading-relaxed', m.is_admin ? 'rounded-bl-lg bg-card ring-1 ring-white/[0.07]' : 'rounded-br-lg bg-brand text-white')}>
              {m.is_admin && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-bold text-secondary"><ShieldCheck className="h-3 w-3" /> Поддержка</div>}
              <div className="whitespace-pre-line break-words">{m.text}</div>
              <div className={clsx('mt-1 text-right text-[10.5px]', m.is_admin ? 'text-muted' : 'text-white/70')}>
                {new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </motion.div>
        ))}
        <div ref={bottom} />
      </div>
      {t.status !== 'closed' ? (
        <div className="sticky mt-4 flex items-end gap-2" style={{ bottom: 'calc(var(--safe-bottom) + 92px)' }}>
          <textarea rows={1} className="input max-h-32 resize-none bg-card" placeholder="Сообщение…" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
          <motion.button whileTap={{ scale: 0.9 }} disabled={!text.trim() || send.isPending} onClick={() => send.mutate()} className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-glow disabled:opacity-50">
            <SendHorizontal className="h-5 w-5" />
          </motion.button>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-white/[0.04] p-3 text-center text-sm text-muted">Обращение закрыто</div>
      )}
    </div>
  )
}
