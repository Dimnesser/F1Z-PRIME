import { KeyRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Premium } from '../../lib/types'
import { useApi } from '../../lib/useApi'
import { Badge, Card, ErrorBox, SearchInput, Tabs } from '../ui'
import { PremiumNewNumber } from './PremiumNewNumber'
import { PremiumSessionBox } from './PremiumSessionBox'
import { SessionWizard } from './SessionWizard'

type PremiumSession = { premium_number_id: number; delivered_at: string | null }

/** «Аккаунты и файлы» → «Красивые номера»: add a new number with its session, or pick one from the base. */
export function PremiumSessionsTab({ onSaved }: { onSaved: () => void }) {
  const { data, error, reload } = useApi<Premium[]>('/premium-numbers')
  const { data: sessions, reload: reloadSessions } = useApi<PremiumSession[]>('/premium-sessions')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<'create' | 'upload'>('create')
  const [revision, setRevision] = useState(0)
  const [section, setSection] = useState<'new' | 'base'>('new')
  const bound = useMemo(() => new Map((sessions ?? []).map((s) => [s.premium_number_id, s])), [sessions])
  const digits = search.replace(/\D/g, '')
  const rows = useMemo(() => (data ?? []).filter((n) => !search || n.display_mask.includes(search)
    || (digits && n.number.includes(digits))), [data, search, digits])
  const current = data?.find((n) => n.id === selected) ?? null
  const hasSession = current ? bound.has(current.id) : false
  const saved = () => { reload(true); reloadSessions(true); setRevision((n) => n + 1); onSaved() }

  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary-soft" />Красивые номера: сессии для выдачи</span>}>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        База красивых номеров: создайте сессию по коду из Telegram — новый номер сам добавится в базу вместе с сессией.
        Для номера, который уже есть в базе, выберите его в списке. Сессии хранятся отдельно от склада «номер + код»;
        после оплаты в карточке заказа появится кнопка «Выдать аккаунт в бот».
      </p>
      <Tabs value={section} onChange={(value) => setSection(value as 'new' | 'base')}
        tabs={[{ value: 'new', label: 'Новый номер' }, { value: 'base', label: `Номера в базе${data ? ` (${data.length})` : ''}` }]} />
      <div className="mt-4">
      {section === 'new' ? <PremiumNewNumber onSaved={saved} /> : <>
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <SearchInput className="mb-3" value={search} onChange={setSearch} placeholder="Поиск по цифрам" />
      <ul className="max-h-80 space-y-2 overflow-y-auto">
        {rows.map((n) => {
          const s = bound.get(n.id)
          return (
            <li key={n.id}>
              <button type="button" onClick={() => setSelected(n.id === selected ? null : n.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left text-sm ${n.id === selected ? 'border-primary' : 'border-line'}`}>
                <span className="min-w-0 truncate font-mono font-bold">{n.country?.flag ?? '🌐'} {n.display_mask}</span>
                {s ? <Badge tone={s.delivered_at ? 'violet' : 'green'} dot>{s.delivered_at ? 'Выдана' : 'Сессия есть'}</Badge>
                  : n.status === 'sold' ? <Badge tone="gray">Продан</Badge> : <Badge tone="amber">Нет сессии</Badge>}
              </button>
            </li>
          )
        })}
        {data && rows.length === 0 && <li className="text-sm text-muted">Номера не найдены.</li>}
      </ul>
      {current && (
        <div className="mt-4 space-y-4">
          {!hasSession && current.status !== 'sold' && (
            <Tabs value={mode} onChange={(value) => setMode(value as 'create' | 'upload')}
              tabs={[{ value: 'create', label: 'Создать по номеру' }, { value: 'upload', label: 'Загрузить .session' }]} />
          )}
          {!hasSession && current.status !== 'sold' && mode === 'create'
            ? <SessionWizard key={`wizard:${current.id}`} target={{ kind: 'premium', premiumNumberId: current.id, phone: current.number }} onSaved={saved} />
            : <PremiumSessionBox key={`${current.id}:${revision}`} numberId={current.id} sold={current.status === 'sold'} />}
        </div>
      )}
      </>}
      </div>
    </Card>
  )
}
