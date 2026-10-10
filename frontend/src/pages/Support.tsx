import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ChevronRight, Headphones, MessageCirclePlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Badge, Button, EmptyState, PageTitle, Skeleton, stagger } from '../components/ui'
import { api } from '../lib/api'
import { date } from '../lib/format'
import { useConfig } from '../lib/queries'
import { useBack } from '../lib/useBack'

export const TICKET_STATUS = {
  open: { label: 'Открыто', tone: 'amber' as const },
  answered: { label: 'Есть ответ', tone: 'green' as const },
  closed: { label: 'Закрыто', tone: 'gray' as const },
}

export default function Support() {
  useBack('/profile')
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: config } = useConfig()
  const { data, isLoading } = useQuery({ queryKey: ['tickets'], queryFn: api.tickets })
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')

  const create = useMutation({
    mutationFn: () => api.createTicket(subject.trim(), text.trim()),
    onSuccess: (t) => {
      toast('Обращение отправлено', 'success')
      setOpen(false)
      setSubject('')
      setText('')
      qc.invalidateQueries({ queryKey: ['tickets'] })
      navigate(`/support/${t.id}`)
    },
    onError: (e) => toast((e as Error).message, 'error'),
  })

  return (
    <div>
      <PageTitle
        title="Поддержка"
        subtitle={`Ответим в Telegram. Контакт: ${config?.settings.support_contact ?? ''}`}
        right={<div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-secondary/15 text-secondary"><Headphones className="h-6 w-6" /></div>}
      />
      <Button className="mb-5 w-full" onClick={() => setOpen(true)}><MessageCirclePlus className="h-5 w-5" /> Новое обращение</Button>
      {isLoading ? (
        <Skeleton className="h-40 rounded-3xl" />
      ) : !data?.length ? (
        <EmptyState icon={<Headphones className="h-7 w-7" />} title="Обращений нет" text="Если возник вопрос — напишите нам, мы поможем" />
      ) : (
        <motion.div variants={stagger.container} initial="hidden" animate="show" className="space-y-3">
          {data.map((t) => (
            <motion.button key={t.id} variants={stagger.item} whileTap={{ scale: 0.98 }} onClick={() => navigate(`/support/${t.id}`)} className="card flex w-full items-center gap-3 p-4 text-left">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">{t.subject}</div>
                <div className="mt-0.5 text-[12px] text-muted">#{t.id} · {date(t.updated_at)}</div>
              </div>
              <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
              <ChevronRight className="h-4 w-4 text-muted" />
            </motion.button>
          ))}
        </motion.div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="Новое обращение">
        <div className="space-y-3">
          <input className="input" placeholder="Тема, например «Вопрос по заказу #12»" maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className="input min-h-[140px] resize-none" placeholder="Опишите ситуацию подробно" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          <Button className="w-full" loading={create.isPending} disabled={subject.trim().length < 3 || text.trim().length < 2} onClick={() => create.mutate()}>
            Отправить
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
