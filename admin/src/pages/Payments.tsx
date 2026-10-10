import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { Badge, Btn, Field, METHOD, Modal, PAYMENT_STATUS, PageHead, Pager, Table, UserCell, useToast } from '../components/ui'
import { api, dt, money } from '../lib/api'
import type { Payment } from '../lib/types'
import { useApi } from '../lib/useApi'

export default function Payments() {
  const toast = useToast()
  const [status, setStatus] = useState('awaiting_confirmation')
  const [method, setMethod] = useState('')
  const [page, setPage] = useState(1)
  const qs = new URLSearchParams({ page: String(page), size: '25' })
  if (status) qs.set('status', status)
  if (method) qs.set('method', method)
  const { data, loading, reload } = useApi<{ total: number; items: Payment[] }>(`/payments?${qs}`)
  const [act, setAct] = useState<{ p: Payment; kind: 'confirm' | 'reject' } | null>(null)
  const [comment, setComment] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!act) return
    setBusy(true)
    try {
      await api(`/payments/${act.p.id}/${act.kind}`, { method: 'POST', body: { comment } })
      toast(act.kind === 'confirm' ? 'Платёж подтверждён' : 'Платёж отклонён')
      setAct(null)
      reload()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHead title="Payments" subtitle="Ручное подтверждение — только после фактической проверки поступления средств.">
        <select className="input w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">Все статусы</option>
          {Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-36" value={method} onChange={(e) => { setMethod(e.target.value); setPage(1) }}>
          <option value="">Все методы</option>
          {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </PageHead>
      <Table loading={loading} empty={data?.items.length === 0} head={['#', 'Пользователь', 'Тип', 'Метод', 'Сумма', 'Статус', 'Комментарий', 'Дата', '']}>
        {data?.items.map((p) => (
          <tr key={p.id} className="hover:bg-white/[0.02]">
            <td className="td font-mono text-muted">#{p.id}</td>
            <td className="td"><UserCell u={p.user} /></td>
            <td className="td">{p.kind === 'order' ? `Заказ #${p.order_id}` : 'Пополнение'}</td>
            <td className="td">{METHOD[p.method] ?? p.method} {p.is_test && <Badge tone="amber">TEST</Badge>}</td>
            <td className="td font-bold">{money(p.amount)}{p.stars_amount ? <span className="ml-1 text-xs text-muted">({p.stars_amount} ⭐)</span> : null}</td>
            <td className="td"><Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge></td>
            <td className="td max-w-[220px] truncate text-muted" title={p.user_comment ?? ''}>{p.user_comment || p.admin_comment || '—'}</td>
            <td className="td text-muted">{dt(p.created_at)}</td>
            <td className="td">
              {p.method === 'manual' && ['pending', 'awaiting_confirmation'].includes(p.status) && (
                <div className="flex gap-2">
                  <Btn variant="success" className="h-8 px-3" onClick={() => { setAct({ p, kind: 'confirm' }); setComment(''); setChecked(false) }}><Check className="h-3.5 w-3.5" /></Btn>
                  <Btn variant="danger" className="h-8 px-3" onClick={() => { setAct({ p, kind: 'reject' }); setComment(''); setChecked(true) }}><X className="h-3.5 w-3.5" /></Btn>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {data && <Pager page={page} total={data.total} size={25} onPage={setPage} />}

      <Modal open={act !== null} onClose={() => setAct(null)} title={act?.kind === 'confirm' ? `Подтвердить платёж #${act?.p.id}` : `Отклонить платёж #${act?.p.id}`}>
        {act && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-card p-4 text-sm ring-1 ring-white/[0.06]">
              <div className="flex justify-between"><span className="text-muted">Сумма</span><span className="font-bold">{money(act.p.amount)}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-muted">Ссылка в переводе</span><span className="font-mono">F1Z-{act.p.id}</span></div>
              <div className="mt-1 flex justify-between gap-4"><span className="text-muted">Комментарий клиента</span><span className="text-right">{act.p.user_comment || '—'}</span></div>
            </div>
            <Field label="Комментарий"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={act.kind === 'reject' ? 'Причина отклонения (увидит пользователь)' : 'Например, ID транзакции в банке'} /></Field>
            {act.kind === 'confirm' && (
              <label className="flex items-start gap-3 rounded-2xl bg-warning/10 p-3 text-sm text-warning">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-500" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                Я проверил выписку: {money(act.p.amount)} фактически поступили на счёт.
              </label>
            )}
            <Btn className="h-11 w-full" variant={act.kind === 'confirm' ? 'primary' : 'danger'} loading={busy} disabled={!checked} onClick={run}>
              {act.kind === 'confirm' ? 'Подтвердить оплату' : 'Отклонить'}
            </Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
