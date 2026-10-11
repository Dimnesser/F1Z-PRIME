import clsx from 'clsx'
import {
  Bell, CheckCheck, ChevronRight, ExternalLink, Headphones, KeyRound, PartyPopper, ShieldCheck, Sparkles, Undo2,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Chips, Empty, ErrorBox, PageHead, Skeleton, useToast } from '../components/ui'
import { ago, api, dt, errMsg, qs } from '../lib/api'
import { useApi } from '../lib/useApi'

interface Item { id: number; kind: string; title: string; body: string; link: string | null; created_at: string; read: boolean }
interface InboxData { unread: number; items: Item[] }

const KIND: Record<string, { icon: typeof Bell; cls: string }> = {
  approval: { icon: Undo2, cls: 'bg-warning/15 text-warning' },
  approval_decided: { icon: ShieldCheck, cls: 'bg-success/15 text-success' },
  ticket_assigned: { icon: Headphones, cls: 'bg-secondary/15 text-secondary' },
  permissions_changed: { icon: KeyRound, cls: 'bg-primary/15 text-primary-soft' },
  welcome: { icon: PartyPopper, cls: 'bg-primary/15 text-primary-soft' },
  rule: { icon: Sparkles, cls: 'bg-secondary/15 text-secondary' },
}

export default function Inbox({ onChange }: { onChange: () => void }) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const { data, loading, error, reload, setData } = useApi<InboxData>(`/inbox${qs({ unread: filter === 'unread' ? true : undefined })}`, { poll: 60_000 })
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const markRead = async (body: { ids: number[] } | { all: true }) => {
    // optimistic: update the list immediately, then sync with the server
    setData((d) => d && ({
      unread: 'all' in body ? 0 : Math.max(0, d.unread - d.items.filter((i) => !i.read && body.ids.includes(i.id)).length),
      items: filter === 'unread'
        ? d.items.filter((i) => !('all' in body) && !body.ids.includes(i.id))
        : d.items.map((i) => ('all' in body || body.ids.includes(i.id) ? { ...i, read: true } : i)),
    }))
    try {
      await api('/inbox/read', { method: 'POST', body })
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      onChange()
      void reload(true)
    }
  }
  const readAll = async () => {
    setBusy(true)
    await markRead({ all: true })
    setBusy(false)
  }

  const unread = data?.unread ?? 0
  return (
    <div className="fade-in">
      <PageHead title="Уведомления" subtitle={unread ? `Непрочитанных: ${unread}` : 'Все уведомления прочитаны'}>
        <Btn variant="secondary" disabled={!unread} loading={busy} onClick={readAll}><CheckCheck className="h-4 w-4" /> Прочитать все</Btn>
      </PageHead>
      <Chips className="mb-4" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Все' }, { value: 'unread', label: 'Непрочитанные', count: unread }]} />
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      {loading ? (
        <div className="card space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !data?.items.length ? (
        <div className="card"><Empty icon={Bell} title={filter === 'unread' ? 'Нет непрочитанных' : 'Уведомлений пока нет'} text="Здесь появятся назначения обращений, запросы на одобрение, срабатывания правил и изменения прав." /></div>
      ) : (
        <div className="card divide-y divide-white/[0.05] overflow-hidden">
          {data.items.map((n) => {
            const k = KIND[n.kind] ?? { icon: Bell, cls: 'bg-white/[0.07] text-muted' }
            const open = () => { if (!n.read) void markRead({ ids: [n.id] }) }
            const content = (
              <>
                <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', k.cls)}><k.icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className={clsx('min-w-0 text-sm', n.read ? 'text-muted' : 'font-semibold text-ink')}>{n.title}</span>
                    <span className="shrink-0 text-[11px] text-muted" title={dt(n.created_at)}>{ago(n.created_at)}</span>
                  </span>
                  {n.body && <span className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-muted">{n.body}</span>}
                </span>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Непрочитано" />}
              </>
            )
            const cls = clsx('flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.025]', !n.read && 'bg-primary/[0.04]')
            if (n.link?.startsWith('/')) {
              return (
                <Link key={n.id} to={n.link} onClick={open} className={cls}>
                  {content}<ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted" />
                </Link>
              )
            }
            if (n.link && /^https:\/\//i.test(n.link)) {
              return (
                <a key={n.id} href={n.link} target="_blank" rel="noopener noreferrer" onClick={open} className={cls}>
                  {content}<ExternalLink className="mt-2 h-4 w-4 shrink-0 text-muted" />
                </a>
              )
            }
            return (
              <button key={n.id} type="button" onClick={open} className={clsx(cls, n.read && 'cursor-default')}>{content}</button>
            )
          })}
        </div>
      )}
      {data && data.items.length >= 100 && <p className="mt-3 text-center text-xs text-muted">Показаны последние 100 уведомлений</p>}
    </div>
  )
}
