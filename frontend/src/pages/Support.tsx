import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Headphones, MessageCirclePlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Badge, Button, EmptyState, ErrorState, PageTitle, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { date } from '../lib/format'
import { StoreLinks } from '../components/StoreInfo'
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
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['tickets'], queryFn: api.tickets })
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
        subtitle={config?.settings.support_contact ? `Ответим в Telegram. Контакт: ${config.settings.support_contact}` : 'Ответим прямо в Telegram'}
        right={<div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-success/12 text-success ring-1 ring-inset ring-success/20"><Headphones className="h-6 w-6" /></div>}
      />
      <div className="mb-3"><StoreLinks /></div>
      <Button className="mb-5 w-full" onClick={() => setOpen(true)}><MessageCirclePlus className="h-5 w-5" /> Новое обращение</Button>
      {isLoading ? (
        <div className="space-y-2.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px] rounded-[20px]" />)}</div>
      ) : error ? (
        <ErrorState text={(error as Error).message} onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState icon={<Headphones className="h-7 w-7" />} title="Обращений нет" text="Если возник вопрос — напишите нам, мы поможем" />
      ) : (
        <div className="card hairline stagger overflow-hidden">
          {data.map((t) => (
            <button key={t.id} type="button" onClick={() => navigate(`/support/${t.id}`)} className="pressable flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{t.subject}</div>
                <div className="num mt-0.5 text-[12px] text-muted">#{t.id} · {date(t.updated_at)}</div>
              </div>
              <Badge tone={TICKET_STATUS[t.status].tone} dot>{TICKET_STATUS[t.status].label}</Badge>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
            </button>
          ))}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="Новое обращение">
        <div className="space-y-3">
          <input className="input" aria-label="Тема обращения" placeholder="Тема, например «Вопрос по заказу #12»" maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className="input min-h-[140px] resize-none" aria-label="Текст обращения" placeholder="Опишите ситуацию подробно" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          <Button className="w-full" loading={create.isPending} disabled={subject.trim().length < 3 || text.trim().length < 2} onClick={() => create.mutate()}>
            Отправить
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
