import { BookOpen, Megaphone, MessageCircle, Wrench } from 'lucide-react'
import { useConfig } from '../lib/queries'
import { openExternal } from '../lib/telegram'

/** Technical-mode notice controlled from the admin panel (purchases are paused server-side). */
export function MaintenanceNotice() {
  const { data } = useConfig()
  const s = data?.settings
  if (s?.maintenance_mode !== 'true') return null
  return (
    <div className="fade-in flex items-start gap-3 rounded-3xl bg-warning/10 p-4 ring-1 ring-warning/25">
      <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
      <div className="text-[13.5px] leading-snug">
        <div className="font-bold text-warning">Технические работы</div>
        <div className="mt-0.5 text-white/75">{s.maintenance_message || 'Покупки временно недоступны. Скоро вернёмся!'}</div>
      </div>
    </div>
  )
}

/** Links set in the admin panel (support, channel, rules). Hidden when none are set. */
export function StoreLinks() {
  const { data } = useConfig()
  const s = data?.settings
  const links = [
    { url: s?.support_url, label: 'Поддержка', icon: MessageCircle },
    { url: s?.channel_url, label: 'Канал', icon: Megaphone },
    { url: s?.rules_url, label: 'Правила', icon: BookOpen },
  ].filter((l): l is { url: string; label: string; icon: typeof BookOpen } => Boolean(l.url && l.url.startsWith('https://')))
  if (!links.length) return null
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}>
      {links.map((l) => (
        <button key={l.label} type="button" onClick={() => openExternal(l.url)} className="card flex items-center justify-center gap-2 px-3 py-3 text-[13px] font-semibold">
          <l.icon className="h-4 w-4 text-primary-soft" /> {l.label}
        </button>
      ))}
    </div>
  )
}
