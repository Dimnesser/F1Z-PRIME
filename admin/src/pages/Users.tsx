import { Ban, Search, ShieldCheck, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Badge, Btn, Field, Modal, ORDER_STATUS, PageHead, Pager, Table, UserCell, useToast } from '../components/ui'
import { api, dt, money } from '../lib/api'
import type { Order, Transaction, User } from '../lib/types'
import { useApi } from '../lib/useApi'

export default function Users() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState('new')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const params = new URLSearchParams({ sort, page: String(page), size: '25' })
  if (q) params.set('search', q)
  if (filter === 'blocked') params.set('blocked', 'true')
  if (filter === 'buyers') params.set('has_orders', 'true')
  const { data, loading, reload } = useApi<{ total: number; items: User[] }>(`/users?${params}`)

  return (
    <div>
      <PageHead title="Users" subtitle="Пользователи Mini App и бота">
        <form onSubmit={(e) => { e.preventDefault(); setQ(search); setPage(1) }} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input w-64 pl-9" placeholder="ID, @username, имя" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <select className="input w-40" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1) }}>
          <option value="">Все</option><option value="buyers">С покупками</option><option value="blocked">Заблокированные</option>
        </select>
        <select className="input w-44" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="new">Сначала новые</option><option value="old">Сначала старые</option><option value="balance">По балансу</option>
          <option value="spent">По тратам</option><option value="orders">По покупкам</option>
        </select>
      </PageHead>
      <Table loading={loading} empty={data?.items.length === 0} head={['Пользователь', 'Telegram ID', 'Баланс', 'Потрачено', 'Покупок', 'Регистрация', '']}>
        {data?.items.map((u) => (
          <tr key={u.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setOpenId(u.id)}>
            <td className="td"><UserCell u={u} /></td>
            <td className="td font-mono text-muted">{u.telegram_id}</td>
            <td className="td font-bold">{money(u.balance)}</td>
            <td className="td">{money(u.total_spent)}</td>
            <td className="td">{u.orders_count}</td>
            <td className="td text-muted">{dt(u.created_at)}</td>
            <td className="td">{u.is_blocked && <Badge tone="red">Заблокирован</Badge>}</td>
          </tr>
        ))}
      </Table>
      {data && <Pager page={page} total={data.total} size={25} onPage={setPage} />}
      <UserModal id={openId} onClose={() => { setOpenId(null); reload() }} />
    </div>
  )
}

function UserModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const toast = useToast()
  const { data, reload } = useApi<{ user: User; orders: Order[]; transactions: Transaction[] }>(id ? `/users/${id}` : null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const u = data?.user

  const adjust = async () => {
    setBusy(true)
    try {
      await api(`/users/${id}/balance`, { method: 'POST', body: { amount, reason } })
      toast('Баланс изменён')
      setAmount('')
      setReason('')
      reload()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const block = async (v: boolean) => {
    try {
      await api(`/users/${id}`, { method: 'PATCH', body: { is_blocked: v } })
      toast(v ? 'Пользователь заблокирован' : 'Разблокирован')
      reload()
    } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <Modal open={id !== null} onClose={onClose} title="Пользователь" wide>
      {!u || u.id !== id ? <div className="py-10 text-center text-muted">Загрузка…</div> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-display text-xl font-bold">{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</div>
              <div className="text-sm text-muted">{u.username ? `@${u.username}` : 'без username'} · ID <span className="font-mono">{u.telegram_id}</span></div>
            </div>
            {u.is_blocked ? <Btn variant="success" onClick={() => block(false)}><ShieldCheck className="h-4 w-4" /> Разблокировать</Btn> : <Btn variant="danger" onClick={() => block(true)}><Ban className="h-4 w-4" /> Заблокировать</Btn>}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[['Баланс', money(u.balance)], ['Потрачено', money(u.total_spent)], ['Покупок', u.orders_count], ['Регистрация', dt(u.created_at)]].map(([k, v]) => (
              <div key={k as string} className="rounded-2xl bg-card p-3.5 ring-1 ring-white/[0.06]"><div className="text-[11px] font-semibold uppercase text-muted">{k}</div><div className="mt-1 font-bold">{v}</div></div>
            ))}
          </div>
          <div className="rounded-2xl bg-card p-4 ring-1 ring-white/[0.06]">
            <div className="mb-3 flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-primary-soft" /> Корректировка баланса</div>
            <div className="grid gap-3 md:grid-cols-[140px_1fr_auto]">
              <Field label="Сумма (±)"><input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100 или -50" /></Field>
              <Field label="Причина"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Компенсация, бонус…" /></Field>
              <div className="flex items-end"><Btn loading={busy} disabled={!amount || Number(amount) === 0 || reason.length < 3} onClick={adjust}>Применить</Btn></div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold text-muted">Заказы</div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {data.orders.length === 0 && <div className="text-sm text-muted">Нет заказов</div>}
                {data.orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-xl bg-card px-3 py-2 text-sm ring-1 ring-white/[0.05]">
                    <span>#{o.id} {o.item_title}</span>
                    <span className="flex items-center gap-2">{money(o.total)} <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge></span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-muted">Операции по балансу</div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {data.transactions.length === 0 && <div className="text-sm text-muted">Нет операций</div>}
                {data.transactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-xl bg-card px-3 py-2 text-sm ring-1 ring-white/[0.05]">
                    <span className="truncate pr-2">{t.description}</span>
                    <span className={t.amount > 0 ? 'font-bold text-success' : 'font-bold'}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
