import { KeyRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Premium } from '../../lib/types'
import { useApi } from '../../lib/useApi'
import { Badge, Card, ErrorBox, SearchInput } from '../ui'
import { PremiumSessionBox } from './PremiumSessionBox'

type PremiumSession = { premium_number_id: number; delivered_at: string | null }

/** «Аккаунты и файлы» → «Красивые номера»: pick a number, upload / see its bound .session. */
export function PremiumSessionsTab() {
  const { data, error, reload } = useApi<Premium[]>('/premium-numbers')
  const { data: sessions } = useApi<PremiumSession[]>('/premium-sessions')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const bound = useMemo(() => new Map((sessions ?? []).map((s) => [s.premium_number_id, s])), [sessions])
  const digits = search.replace(/\D/g, '')
  const rows = useMemo(() => (data ?? []).filter((n) => !search || n.display_mask.includes(search)
    || (digits && n.number.includes(digits))), [data, search, digits])
  const current = data?.find((n) => n.id === selected) ?? null

  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary-soft" />Красивые номера: сессии для выдачи</span>}>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Выберите номер и загрузите его .session. Сессия хранится отдельно от склада номеров; после оплаты в карточке
        заказа появится кнопка «Выдать аккаунт в бот».
      </p>
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
        <div className="mt-4">
          <PremiumSessionBox key={current.id} numberId={current.id} sold={current.status === 'sold'} />
        </div>
      )}
    </Card>
  )
}
