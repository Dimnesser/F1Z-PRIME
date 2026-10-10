import clsx from 'clsx'
import { Ban, Download, ShieldCheck, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge, Btn, Chips, DataTable, ErrorBox, Field, KV, METHOD, Modal, OrderBadge, PAYMENT_STATUS, PageHead, Pager, SearchInput,
  Skeleton, TX_TYPE, Tabs, UserCell, useConfirm, useToast,
} from '../components/ui'
import { ago, api, download, dt, errMsg, money, num, qs } from '../lib/api'
import { useCanManage } from '../lib/session'
import type { Order, Paged, Payment, Transaction, User } from '../lib/types'
import { useApi, useDebounced } from '../lib/useApi'
import { OrderDetail } from './Orders'

const SIZE = 25
type Filter = 'all' | 'buyers' | 'balance' | 'blocked' | 'new'
const FILTERS: Record<Filter, Record<string, string>> = {
  all: {}, buyers: { has_orders: 'true' }, balance: { has_balance: 'true' }, blocked: { blocked: 'true' }, new: { has_orders: 'false' },
}

export default function Users() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState('new')
  const [page, setPage] = useState(1)
  const q = useDebounced(search)
  const manage = useCanManage()
  const toast = useToast()
  const query = { search: q, sort, ...FILTERS[filter] }
  const { data, loading, error, reload } = useApi<Paged<User>>(`/users${qs({ ...query, page, size: SIZE })}`)
  const openId = Number(params.get('open')) || null
  useEffect(() => { setPage(1) }, [q, filter, sort])
  const open = (id: number | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('open', String(id))
    else next.delete('open')
    setParams(next, { replace: true })
  }

  return (
    <div className="fade-in">
      <PageHead title="Пользователи" subtitle={data ? `${num(data.total)} найдено` : 'Покупатели магазина'}>
        {manage && (
          <Btn variant="secondary" onClick={() => download(`/users/export.csv${qs(query)}`, 'users.csv').catch((e) => toast(errMsg(e), 'error'))}>
            <Download className="h-4 w-4" /> CSV
          </Btn>
        )}
      </PageHead>
      <div className="mb-3 flex gap-2">
        <SearchInput className="flex-1" value={search} onChange={setSearch} placeholder="Telegram ID, @username или имя" />
        <select className="input w-auto shrink-0" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
          <option value="new">Новые</option><option value="seen">Активные</option><option value="spent">Потратили больше</option>
          <option value="orders">Больше заказов</option><option value="balance">Больше баланс</option><option value="old">Старые</option>
        </select>
      </div>
      <Chips className="mb-4" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'Все' }, { value: 'buyers', label: 'Покупатели' }, { value: 'balance', label: 'С балансом' },
        { value: 'new', label: 'Без заказов' }, { value: 'blocked', label: 'Заблокированные' },
      ]} />
      {error && <div className="mb-3"><ErrorBox text={error} onRetry={() => reload()} /></div>}
      <DataTable
        rows={data?.items} loading={loading} rowKey={(u) => u.id} onRowClick={(u) => open(u.id)}
        columns={[
          { header: 'Пользователь', cell: (u) => <UserCell u={u} /> },
          { header: 'Telegram ID', cell: (u) => <span className="tabular font-mono text-muted">{u.telegram_id}</span> },
          { header: 'Баланс', align: 'right', cell: (u) => <span className="tabular font-semibold">{money(u.balance)}</span> },
          { header: 'Потрачено', align: 'right', cell: (u) => <span className="tabular">{money(u.total_spent)}</span> },
          { header: 'Заказов', align: 'right', cell: (u) => <span className="tabular">{u.orders_count}</span> },
          { header: 'Регистрация', cell: (u) => <span className="whitespace-nowrap text-muted">{dt(u.created_at)}</span> },
          { header: 'Активность', cell: (u) => <span className="whitespace-nowrap text-muted">{ago(u.last_seen_at)}</span> },
          { header: 'Статус', cell: (u) => u.is_blocked ? <Badge tone="red" dot>Заблокирован</Badge> : <Badge tone="green" dot>Активен</Badge> },
        ]}
        card={(u) => (
          <div>
            <div className="flex items-center justify-between gap-3">
              <UserCell u={u} />
              {u.is_blocked && <Badge tone="red">Блок</Badge>}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-white/[0.03] py-1.5"><div className="text-muted">Баланс</div><div className="tabular font-semibold text-ink">{money(u.balance)}</div></div>
              <div className="rounded-lg bg-white/[0.03] py-1.5"><div className="text-muted">Потрачено</div><div className="tabular font-semibold text-ink">{money(u.total_spent)}</div></div>
              <div className="rounded-lg bg-white/[0.03] py-1.5"><div className="text-muted">Заказов</div><div className="tabular font-semibold text-ink">{u.orders_count}</div></div>
            </div>
          </div>
        )}
      />
      {data && <Pager page={page} total={data.total} size={SIZE} onPage={setPage} />}
      {openId && <UserProfile key={openId} id={openId} onClose={() => open(null)} onChanged={() => reload(true)} />}
    </div>
  )
}

interface UserDetail { user: User; orders: Order[]; payments: Payment[]; transactions: Transaction[]; tickets_count: number }

function UserProfile({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data, loading, error, reload } = useApi<UserDetail>(`/users/${id}`)
  const [tab, setTab] = useState<'orders' | 'payments' | 'tx'>('orders')
  const [adjust, setAdjust] = useState<{ amount: string; reason: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [order, setOrder] = useState<number | null>(null)
  const manage = useCanManage()
  const confirm = useConfirm()
  const toast = useToast()
  const u = data?.user

  const toggleBlock = async () => {
    if (!u) return
    const ok = await confirm({
      title: u.is_blocked ? 'Разблокировать пользователя?' : 'Заблокировать пользователя?',
      text: u.is_blocked ? 'Пользователь снова сможет покупать в магазине.' : 'Пользователь не сможет открыть магазин и оформлять заказы.',
      danger: !u.is_blocked, confirmLabel: u.is_blocked ? 'Разблокировать' : 'Заблокировать',
    })
    if (ok === false) return
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body: { is_blocked: !u.is_blocked } })
      toast(u.is_blocked ? 'Пользователь разблокирован' : 'Пользователь заблокирован')
      await reload(true)
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') }
  }

  const saveBalance = async () => {
    if (!u || !adjust) return
    const amount = Number(adjust.amount.replace(',', '.'))
    if (!amount || adjust.reason.trim().length < 3) { toast('Укажите сумму и причину (от 3 символов)', 'error'); return }
    const ok = await confirm({
      title: `${amount > 0 ? 'Начислить' : 'Списать'} ${money(Math.abs(amount))}?`,
      text: `Баланс станет ${money(u.balance + amount)}. Запись попадёт в финансовый журнал с причиной и вашим именем.`,
      danger: amount < 0,
    })
    if (ok === false) return
    setBusy(true)
    try {
      await api(`/users/${u.id}/balance`, { method: 'POST', body: { amount: amount.toFixed(2), reason: adjust.reason.trim() } })
      toast('Баланс изменён, пользователь уведомлён')
      setAdjust(null)
      await reload(true)
      onChanged()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Профиль пользователя">
      {error && <ErrorBox text={error} />}
      {loading || !u ? <Skeleton className="h-72" /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <UserCell u={u} sub={`ID ${u.telegram_id}${u.language_code ? ` · ${u.language_code}` : ''}`} />
            {u.is_blocked ? <Badge tone="red" dot>Заблокирован</Badge> : <Badge tone="green" dot>Активен</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KV label="Баланс">{money(u.balance)}</KV>
            <KV label="Потрачено">{money(u.total_spent)}</KV>
            <KV label="Заказов">{u.orders_count}</KV>
            <KV label="Обращений">{data!.tickets_count}</KV>
            <KV label="Регистрация">{dt(u.created_at)}</KV>
            <KV label="Был в сети">{ago(u.last_seen_at)}</KV>
          </div>
          {manage && (
            <div className="flex flex-wrap gap-2">
              <Btn variant="secondary" onClick={() => setAdjust(adjust ? null : { amount: '', reason: '' })}><Wallet className="h-4 w-4" /> Изменить баланс</Btn>
              <Btn variant={u.is_blocked ? 'success' : 'danger'} onClick={toggleBlock}>
                {u.is_blocked ? <><ShieldCheck className="h-4 w-4" /> Разблокировать</> : <><Ban className="h-4 w-4" /> Заблокировать</>}
              </Btn>
              {u.username && <a className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-primary-soft hover:bg-white/[0.05]" href={`https://t.me/${u.username}`} target="_blank" rel="noreferrer">Написать в Telegram</a>}
            </div>
          )}
          {adjust && (
            <div className="grid gap-3 rounded-2xl bg-white/[0.03] p-4 sm:grid-cols-[140px_1fr_auto]">
              <Field label="Сумма, грн" hint="«-» чтобы списать">
                <input className="input tabular" inputMode="decimal" value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} placeholder="100 или -50" autoFocus />
              </Field>
              <Field label="Причина (обязательно)"><input className="input" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder="Компенсация, бонус…" /></Field>
              <div className="flex items-end"><Btn className="h-11 w-full" loading={busy} onClick={saveBalance}>Сохранить</Btn></div>
            </div>
          )}
          <div>
            <Tabs value={tab} onChange={setTab} tabs={[
              { value: 'orders', label: `Покупки (${data!.orders.length})` },
              { value: 'payments', label: `Платежи (${data!.payments.length})` },
              { value: 'tx', label: `Баланс (${data!.transactions.length})` },
            ]} />
            <div className="space-y-1.5">
              {tab === 'orders' && (data!.orders.length === 0 ? <Muted>Покупок нет</Muted> : data!.orders.map((o) => (
                <button key={o.id} type="button" onClick={() => setOrder(o.id)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-left text-sm hover:bg-white/[0.05]">
                  <span className="min-w-0"><span className="block truncate font-semibold">#{o.id} {o.item_title}</span><span className="text-xs text-muted">{dt(o.created_at)}</span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1"><span className="tabular font-semibold">{money(o.total)}</span><OrderBadge status={o.status} /></span>
                </button>
              )))}
              {tab === 'payments' && (data!.payments.length === 0 ? <Muted>Платежей нет</Muted> : data!.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm">
                  <span className="min-w-0"><span className="block truncate font-semibold">#{p.id} {p.kind === 'topup' ? 'Пополнение' : `Заказ #${p.order_id}`} · {METHOD[p.method] ?? p.method}</span><span className="text-xs text-muted">{dt(p.created_at)}</span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1"><span className="tabular font-semibold">{money(p.amount)}</span><Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge></span>
                </div>
              )))}
              {tab === 'tx' && (data!.transactions.length === 0 ? <Muted>Движений по балансу нет</Muted> : data!.transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm">
                  <span className="min-w-0"><span className="block truncate font-semibold">{t.description}</span><span className="text-xs text-muted">{dt(t.created_at)} · <Badge tone={TX_TYPE[t.type]?.tone ?? 'gray'}>{TX_TYPE[t.type]?.label ?? t.type}</Badge></span></span>
                  <span className="shrink-0 text-right"><span className={clsx('tabular block font-bold', t.amount > 0 ? 'text-success' : 'text-ink')}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</span><span className="tabular text-xs text-muted">= {money(t.balance_after)}</span></span>
                </div>
              )))}
            </div>
          </div>
        </div>
      )}
      {order && <OrderDetail key={order} id={order} onClose={() => setOrder(null)} onChanged={() => reload(true)} />}
    </Modal>
  )
}

function Muted({ children }: { children: string }) {
  return <div className="py-6 text-center text-sm text-muted">{children}</div>
}
