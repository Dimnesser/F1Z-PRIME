import clsx from 'clsx'
import { AlertTriangle, Ban, CheckCircle2, Coins, Link2, Smartphone, TrendingUp, Wallet } from 'lucide-react'
import { useState } from 'react'
import {
  Badge, Btn, Card, Chips, DataTable, Empty, ErrorBox, PageHead, Pager, Skeleton, StatCard, Tabs, useConfirm, useToast,
  type Column, type Tone,
} from '../components/ui'
import { api, dt, errMsg, money, num, qs } from '../lib/api'
import { useCan } from '../lib/session'
import { useApi } from '../lib/useApi'

type Status = 'RESERVED' | 'API_PENDING' | 'WAITING' | 'COMPLETED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'TIMEOUT' | 'FAILED' | 'RECONCILIATION_REQUIRED'
interface Activation {
  id: number; user_id: number; status: Status; service: string; country: string; phone_number: string | null
  activation_id: string | null; code: string | null; cost: number; provider_cost: number; refunded: boolean
  created_at: string | null; expires_at: string | null; chat_id: number
}
interface Page { total: number; items: Activation[] }
interface Summary {
  by_status: Record<string, number>; reconciliation_required: number; active: number; completed: number
  revenue: number; provider_cost: number; profit: number; refunded: number
}
interface CatalogRow { country: string; service: string; cost: number; count: number; price: number | null; profit: number | null; priced: boolean; disabled: boolean }
interface AdminCatalog { markups: { global: string; country: Record<string, unknown>; service: Record<string, unknown>; min_profit: number }; rows: CatalogRow[] }

const META: Record<Status, { label: string; tone: Tone }> = {
  RESERVED: { label: 'Резерв', tone: 'gray' },
  API_PENDING: { label: 'Запрос', tone: 'amber' },
  WAITING: { label: 'Ожидает SMS', tone: 'cyan' },
  COMPLETED: { label: 'Выдан', tone: 'green' },
  CANCEL_REQUESTED: { label: 'Отмена…', tone: 'amber' },
  CANCELLED: { label: 'Отменён', tone: 'gray' },
  TIMEOUT: { label: 'Таймаут', tone: 'red' },
  FAILED: { label: 'Ошибка', tone: 'red' },
  RECONCILIATION_REQUIRED: { label: 'Нужна сверка', tone: 'red' },
}

type Tab = 'activations' | 'reconcile' | 'catalog'
const SIZE = 50

export default function SmsActivations() {
  const canFulfill = useCan('orders.fulfill')
  const [tab, setTab] = useState<Tab>('activations')
  const [rev, setRev] = useState(0)
  const bump = () => setRev((v) => v + 1)
  const summary = useApi<Summary>(`/sms/summary${qs({ rev })}`, { poll: 30_000 })

  return (
    <div>
      <PageHead title="SMS-активации" subtitle="Виртуальные номера: мониторинг, очередь сверки, каталог и прибыль. Наценки задаются в Настройках (раздел SMS)." />
      <div className="stagger mb-5 grid grid-cols-2 gap-3 xl:grid-cols-6">
        <StatCard size="sm" icon={Smartphone} label="Активные" value={fmt(summary.data?.active)} tone="amber" />
        <StatCard size="sm" icon={CheckCircle2} label="Выдано" value={fmt(summary.data?.completed)} tone="green" />
        <StatCard size="sm" icon={AlertTriangle} label="Нужна сверка" value={fmt(summary.data?.reconciliation_required)}
          tone={summary.data?.reconciliation_required ? 'red' : 'gray'} sub={summary.data?.reconciliation_required ? 'см. вкладку «Сверка»' : 'очередь пуста'} />
        <StatCard size="sm" icon={Wallet} label="Выручка" value={fmt(summary.data?.revenue, true)} tone="violet" />
        <StatCard size="sm" icon={Coins} label="Себестоимость" value={fmt(summary.data?.provider_cost, true)} tone="cyan" sub={summary.data ? `возвраты: ${money(summary.data.refunded)}` : undefined} />
        <StatCard size="sm" icon={TrendingUp} label="Прибыль" value={fmt(summary.data?.profit, true)} tone={summary.data && summary.data.profit < 0 ? 'red' : 'green'} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'activations', label: 'Активации', icon: Smartphone },
        { value: 'reconcile', label: 'Сверка', icon: AlertTriangle },
        { value: 'catalog', label: 'Каталог и наценки', icon: Link2 },
      ]} />
      {tab === 'activations' && <Table rev={rev} canFulfill={canFulfill} onChange={() => { bump(); void summary.reload(true) }} filter={null} />}
      {tab === 'reconcile' && <Table rev={rev} canFulfill={canFulfill} onChange={() => { bump(); void summary.reload(true) }} filter="RECONCILIATION_REQUIRED" reconcile />}
      {tab === 'catalog' && <Catalog rev={rev} />}
    </div>
  )
}

const fmt = (v: number | undefined, isMoney = false) => (v === undefined ? '…' : isMoney ? money(v) : num(v))

function Table({ rev, canFulfill, onChange, filter, reconcile }: {
  rev: number; canFulfill: boolean; onChange: () => void; filter: string | null; reconcile?: boolean
}) {
  const [status, setStatus] = useState<string>(filter ?? '')
  const [page, setPage] = useState(1)
  const effective = filter ?? status
  const { data, loading, error, reload } = useApi<Page>(`/sms/activations${qs({ status: effective, page, size: SIZE, rev })}`)
  const toast = useToast()
  const confirm = useConfirm()

  const act = async (row: Activation, action: 'bind' | 'cancel' | 'cancel-plain') => {
    try {
      if (action === 'bind') {
        const pid = await confirm({ title: `Привязать активацию ${row.id}`, confirmLabel: 'Привязать',
          input: { label: 'ID активации у провайдера', required: true, placeholder: 'например 123456789' } })
        if (pid === false) return
        await api(`/sms/activations/${row.id}/reconcile`, { method: 'POST', body: { action: 'bind', activation_id: pid } })
      } else if (action === 'cancel') {
        const ok = await confirm({ title: `Отменить и вернуть деньги по ${row.id}?`, danger: true, confirmLabel: 'Отменить' })
        if (ok === false) return
        await api(`/sms/activations/${row.id}/reconcile`, { method: 'POST', body: { action: 'cancel' } })
      } else {
        const ok = await confirm({ title: `Отменить активацию ${row.id}?`, danger: true, confirmLabel: 'Отменить' })
        if (ok === false) return
        await api(`/sms/activations/${row.id}/cancel`, { method: 'POST' })
      }
      toast('Готово'); void reload(true); onChange()
    } catch (e) { toast(errMsg(e), 'error') }
  }

  const columns: Column<Activation>[] = [
    { header: '#', cell: (a) => <span className="tabular text-sm">{a.id}</span> },
    { header: 'Номер', cell: (a) => <span className="font-mono text-sm">{a.phone_number ?? '—'}</span> },
    { header: 'Страна/сервис', cell: (a) => <span className="text-sm">{a.country} · {a.service}</span> },
    { header: 'Статус', cell: (a) => <Badge tone={META[a.status]?.tone ?? 'gray'}>{META[a.status]?.label ?? a.status}</Badge> },
    { header: 'Цена/себест.', align: 'right', cell: (a) => <span className="tabular text-sm">{a.cost.toFixed(2)} / {a.provider_cost.toFixed(2)}</span> },
    { header: 'Создан', cell: (a) => <span className="whitespace-nowrap text-xs text-muted">{dt(a.created_at)}</span> },
  ]
  if (canFulfill) columns.push({ header: '', align: 'right', cell: (a) => (
    <div className="flex justify-end gap-1">
      {a.status === 'RECONCILIATION_REQUIRED' && <>
        <Btn size="sm" variant="ghost" onClick={() => act(a, 'bind')}><Link2 className="h-3.5 w-3.5" /> Привязать</Btn>
        <Btn size="sm" variant="danger" onClick={() => act(a, 'cancel')}><Ban className="h-3.5 w-3.5" /> Вернуть</Btn>
      </>}
      {['WAITING', 'API_PENDING', 'RESERVED'].includes(a.status) && <Btn size="sm" variant="danger" onClick={() => act(a, 'cancel-plain')}>Отменить</Btn>}
    </div>
  ) })

  return (
    <div className="space-y-4">
      {!filter && (
        <Chips value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[
          { value: '', label: 'Все' }, { value: 'active', label: 'Активные' },
          { value: 'COMPLETED', label: 'Выданные' }, { value: 'TIMEOUT', label: 'Таймаут' },
          { value: 'CANCELLED', label: 'Отменённые' }, { value: 'FAILED', label: 'Ошибки' },
        ]} />
      )}
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      {reconcile && data && data.items.length === 0 && !loading
        ? <div className="card"><Empty icon={CheckCircle2} title="Очередь сверки пуста" text="Нет неоднозначных покупок, требующих ручного решения." /></div>
        : <DataTable rows={data?.items} columns={columns} loading={loading} rowKey={(a) => a.id} emptyText="Активаций нет"
            card={(a) => (
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{a.phone_number ?? `#${a.id}`}</span>
                  <Badge tone={META[a.status]?.tone ?? 'gray'} className="ml-auto">{META[a.status]?.label ?? a.status}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted">{a.country} · {a.service} · {a.cost.toFixed(2)} грн · {dt(a.created_at)}</div>
                {canFulfill && a.status === 'RECONCILIATION_REQUIRED' && (
                  <div className="mt-2 flex gap-2">
                    <Btn size="sm" variant="ghost" onClick={() => act(a, 'bind')}>Привязать</Btn>
                    <Btn size="sm" variant="danger" onClick={() => act(a, 'cancel')}>Вернуть</Btn>
                  </div>
                )}
              </div>
            )} />}
      {data && !filter && <Pager page={page} total={data.total} size={SIZE} onPage={setPage} />}
    </div>
  )
}

function Catalog({ rev }: { rev: number }) {
  const { data, loading, error, reload } = useApi<AdminCatalog>(`/sms/catalog${qs({ rev })}`)
  if (loading) return <Skeleton className="h-64 rounded-2xl" />
  if (error) return <ErrorBox text={error} onRetry={() => reload()} />
  if (!data) return null
  const unpriced = data.rows.filter((r) => !r.priced).length
  const columns: Column<CatalogRow>[] = [
    { header: 'Страна/сервис', cell: (r) => <span className="text-sm">{r.country} · {r.service}</span> },
    { header: 'Себест.', align: 'right', cell: (r) => <span className="tabular text-sm text-muted">{r.cost.toFixed(2)}</span> },
    { header: 'Цена', align: 'right', cell: (r) => <span className="tabular text-sm font-semibold">{r.price === null ? '—' : r.price.toFixed(2)}</span> },
    { header: 'Прибыль', align: 'right', cell: (r) => <span className={clsx('tabular text-sm', (r.profit ?? 0) > 0 ? 'text-success' : 'text-muted')}>{r.profit === null ? '—' : r.profit.toFixed(2)}</span> },
    { header: 'В наличии', align: 'right', cell: (r) => <span className="tabular text-sm">{r.count}</span> },
    { header: '', cell: (r) => r.disabled ? <Badge tone="gray">откл.</Badge> : !r.priced ? <Badge tone="red">нет наценки</Badge> : <Badge tone="green">продаётся</Badge> },
  ]
  return (
    <div className="space-y-4">
      <Card title="Наценки">
        <div className="text-sm text-muted">
          Глобальная: <b className="text-ink">{data.markups.global || 'не задана'}</b>{data.markups.global ? '%' : ''} ·
          мин. прибыль: <b className="text-ink">{data.markups.min_profit.toFixed(2)}</b> грн ·
          по странам: {Object.keys(data.markups.country).length} · по сервисам: {Object.keys(data.markups.service).length}
          {unpriced > 0 && <span className="text-danger"> · {unpriced} позиций без наценки не продаются</span>}
        </div>
        <div className="mt-1 text-xs text-muted">Изменить наценки: Настройки → раздел «SMS».</div>
      </Card>
      <DataTable rows={data.rows} columns={columns} rowKey={(r) => `${r.country}:${r.service}`} emptyText="Каталог провайдера пуст"
        card={(r) => (
          <div>
            <div className="flex items-center gap-2"><span className="text-sm font-semibold">{r.country} · {r.service}</span>
              <span className="ml-auto">{r.disabled ? <Badge tone="gray">откл.</Badge> : !r.priced ? <Badge tone="red">нет наценки</Badge> : <Badge tone="green">продаётся</Badge>}</span></div>
            <div className="mt-1 text-xs text-muted">себест. {r.cost.toFixed(2)} · цена {r.price === null ? '—' : r.price.toFixed(2)} · в наличии {r.count}</div>
          </div>
        )} />
    </div>
  )
}
