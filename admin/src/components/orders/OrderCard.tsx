import clsx from 'clsx'
import {
  AlertTriangle, Bell, CheckCircle2, CircleDot, CreditCard, ExternalLink, Headphones, KeyRound, PackageCheck, RefreshCw, RotateCcw,
  Send, Siren, Undo2, User as UserIcon, UserCog, XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge, Btn, ErrorBox, Field, KV, METHOD, Modal, PAYMENT_STATUS, Skeleton, UserCell, useConfirm, useToast,
} from '../ui'
import { api, dt, errMsg, money } from '../../lib/api'
import { useCan } from '../../lib/session'
import { useApi } from '../../lib/useApi'
import {
  CUSTOMER_EVENTS, FULFILLMENT_LABEL, JOB_STATUS, REFUND_METHOD, REFUND_STATUS, StageBadge, orderNo,
  type OrderDetailData, type TimelineItem,
} from './shared'

const TIMELINE_ICON: Record<string, { icon: typeof Bell; cls: string }> = {
  status: { icon: CircleDot, cls: 'bg-primary/15 text-primary-soft' },
  payment: { icon: CreditCard, cls: 'bg-secondary/15 text-secondary' },
  refund: { icon: Undo2, cls: 'bg-warning/15 text-warning' },
  notification: { icon: Bell, cls: 'bg-white/[0.07] text-muted' },
  error: { icon: XCircle, cls: 'bg-danger/15 text-danger' },
  incident: { icon: Siren, cls: 'bg-danger/15 text-danger' },
}
const ACTOR: Record<string, string> = { customer: 'покупатель', worker: 'автоматика', system: 'система' }
const actorLabel = (a: string | null) => {
  if (!a) return ''
  if (ACTOR[a]) return ACTOR[a]
  if (a.startsWith('admin:')) return a.slice(6)
  if (a.startsWith('auto')) return 'автоматика'
  return a
}
const MODE: Record<string, string> = { auto: 'Автовыдача', manual: 'Ручная выдача', review: 'С проверкой' }
const UNIT_STATUS: Record<string, string> = { available: 'свободен', reserved: 'в резерве', sold: 'выдан', delivered: 'выдан', defective: 'брак', returned: 'возвращён' }
const TICKET_STATUS: Record<string, string> = { open: 'открыто', answered: 'отвечено', closed: 'закрыто' }

/** status transitions → permission needed (mirrors STATUS_PERMISSION in backend api/admin.py) */
const STATUS_PERM: Record<string, string> = {
  cancelled: 'orders.cancel', expired: 'orders.cancel', completed: 'orders.fulfill', processing: 'orders.status',
  paid: 'orders.status', pending: 'orders.status',
}
const STATUS_ACTION: Record<string, string> = {
  processing: 'В обработку', completed: 'Выдать вручную / Завершить', cancelled: 'Отменить', paid: 'Вернуть в «Оплачен»', pending: 'Вернуть в ожидание',
}

export function OrderDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged?: () => void }) {
  const { data, loading, error, reload } = useApi<OrderDetailData>(`/orders/${id}`)
  const canStatus = useCan('orders.status')
  const canFulfill = useCan('orders.fulfill')
  const canCancel = useCan('orders.cancel')
  const canRefund = useCan('refunds.create')
  const confirm = useConfirm()
  const toast = useToast()
  const [delivery, setDelivery] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [event, setEvent] = useState('')
  const [refundOpen, setRefundOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const o = data?.order
  const permFor = (s: string) => ({ 'orders.status': canStatus, 'orders.fulfill': canFulfill, 'orders.cancel': canCancel } as Record<string, boolean>)[STATUS_PERM[s]] ?? false
  const transitions = (data?.allowed ?? []).filter((s) => s !== 'refunded' && s !== 'expired' && permFor(s))
  const editable = transitions.length > 0

  const after = async (msg: string) => {
    toast(msg)
    await reload(true)
    onChanged?.()
  }
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn() } catch (e) { toast(errMsg(e), 'error') } finally { setBusy('') }
  }

  const change = async (next: string) => {
    if (!o) return
    const ok = await confirm({
      title: `${STATUS_ACTION[next] ?? next} — ${orderNo(o)}?`,
      danger: next === 'cancelled',
      text: next === 'cancelled' ? 'Резерв товара будет снят, неподтверждённые платежи отменены. Покупатель получит уведомление.'
        : next === 'completed' ? 'Заказ будет отмечен выданным. Данные для выдачи придут покупателю.'
        : 'Покупатель получит уведомление в Telegram.',
      confirmLabel: STATUS_ACTION[next] ?? 'Подтвердить',
    })
    if (ok === false) return
    await run(next, async () => {
      await api(`/orders/${o.id}/status`, { method: 'POST', body: { status: next, delivery_data: delivery ?? undefined, admin_note: note ?? undefined } })
      await after(`Заказ ${orderNo(o)}: статус изменён`)
    })
  }

  const retry = () => run('retry', async () => {
    const r = await api<{ fulfillment_status: string | null }>(`/orders/${id}/fulfillment/retry`, { method: 'POST' })
    await after(`Выдача перезапущена: ${FULFILLMENT_LABEL[r.fulfillment_status ?? ''] ?? r.fulfillment_status ?? '—'}`)
  })

  const handOver = async () => {
    const text = await confirm({
      title: 'Передать заказ оператору?', text: 'Автовыдача остановится, заказ попадёт в очередь ручной выдачи.',
      confirmLabel: 'Передать', input: { label: 'Комментарий для оператора', placeholder: 'Необязательно', multiline: true },
    })
    if (text === false) return
    await run('manual', async () => {
      await api(`/orders/${id}/fulfillment/manual`, { method: 'POST', body: { note: text } })
      await after('Заказ передан оператору')
    })
  }

  const resend = () => {
    if (!event) return
    void run('notify', async () => {
      await api(`/orders/${id}/notify`, { method: 'POST', body: { event } })
      toast('Уведомление поставлено в очередь')
      await reload(true)
    })
  }

  const confirmManual = async (refundId: number) => {
    const text = await confirm({
      title: 'Подтвердить ручной перевод?', text: 'Подтверждайте только после того, как деньги фактически отправлены покупателю.',
      confirmLabel: 'Перевод выполнен', input: { label: 'Комментарий (номер перевода и т.п.)', placeholder: 'Необязательно' },
    })
    if (text === false) return
    await run(`refund-${refundId}`, async () => {
      await api(`/refunds/${refundId}/confirm-manual`, { method: 'POST', body: { note: text } })
      await after('Возврат отмечен выполненным')
    })
  }

  const fs = data?.fulfillment.status ?? null
  const paidLike = o ? o.status === 'paid' || o.status === 'processing' : false
  const canRetry = canFulfill && paidLike && ['failed', 'manual', 'review', 'pending'].includes(fs ?? '')
  const canHand = canFulfill && paidLike && fs !== 'manual' && fs !== 'delivered'
  const refundMethods = canRefund ? data?.refund_methods ?? [] : []
  const hasDiscount = Boolean(o && ((o.discount ?? 0) > 0 || o.promo_code))

  return (<>
    <Modal open onClose={onClose} size="lg"
      title={o ? <span className="font-mono">{orderNo(o)}</span> : 'Заказ'}
      subtitle={data && <span className="flex flex-wrap items-center gap-2"><StageBadge stage={data.stage} label={data.stage_label} /><span className="text-xs">внутр. №{data.order.id}</span></span>}
      footer={o && (transitions.length > 0 || refundMethods.length > 0) ? (<>
        {refundMethods.length > 0 && <Btn variant="danger" onClick={() => setRefundOpen(true)}><RotateCcw className="h-4 w-4" /> Возврат</Btn>}
        {transitions.map((s) => (
          <Btn key={s} variant={s === 'cancelled' ? 'danger' : s === 'completed' ? 'primary' : 'secondary'} loading={busy === s} onClick={() => change(s)}>
            {STATUS_ACTION[s] ?? s}
          </Btn>
        ))}
      </>) : undefined}>
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      {loading || !o || !data ? <Skeleton className="h-64" /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KV label="Сумма">{money(o.total)}</KV>
            <KV label="Кол-во">{o.quantity} × {money(o.unit_price)}</KV>
            <KV label="Оплата">{o.payment_method ? METHOD[o.payment_method] ?? o.payment_method : '—'}</KV>
            <KV label="Создан">{dt(o.created_at)}</KV>
            {hasDiscount && <KV label="Скидка">{money(o.discount ?? 0)}</KV>}
            {o.promo_code && <KV label="Промокод"><span className="font-mono">{o.promo_code}</span></KV>}
            {o.paid_at && <KV label="Оплачен">{dt(o.paid_at)}</KV>}
            {o.completed_at && <KV label="Завершён">{dt(o.completed_at)}</KV>}
          </div>

          <div className="rounded-2xl bg-white/[0.03] p-3.5">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted"><UserIcon className="h-3.5 w-3.5" /> Покупатель</div>
            <UserCell u={o.user} sub={`ID ${o.user.telegram_id} · баланс ${money(o.user.balance)}`} />
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-muted">Товар</div>
            <div className="font-semibold">{o.item_title}</div>
            {data.product && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone="gray">{MODE[data.product.fulfillment_mode] ?? data.product.fulfillment_mode}</Badge>
                {data.product.uses_inventory && <Badge tone="gray">Склад единиц</Badge>}
              </div>
            )}
          </div>

          {/* fulfillment */}
          <section className="rounded-2xl border border-white/[0.06] p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold"><PackageCheck className="h-4 w-4 text-primary-soft" /> Выдача</div>
              <Badge tone={fs === 'delivered' ? 'green' : fs === 'failed' ? 'red' : fs === 'manual' || fs === 'review' ? 'amber' : 'gray'}>
                {fs ? FULFILLMENT_LABEL[fs] ?? fs : 'не начиналась'}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <KV label="Попыток">{data.fulfillment.attempts}</KV>
              <KV label="Выдан">{dt(data.fulfillment.delivered_at)}</KV>
              {data.fulfillment.job && (
                <KV label="Задача">
                  <span className="flex items-center gap-1.5">
                    <Badge tone={JOB_STATUS[data.fulfillment.job.status]?.tone ?? 'gray'}>{JOB_STATUS[data.fulfillment.job.status]?.label ?? data.fulfillment.job.status}</Badge>
                    <span className="text-xs text-muted">×{data.fulfillment.job.attempts}</span>
                  </span>
                </KV>
              )}
            </div>
            {(data.fulfillment.error || data.fulfillment.job?.last_error) && (
              <div className="mt-2 break-words rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
                {data.fulfillment.error || data.fulfillment.job?.last_error}
              </div>
            )}
            {data.fulfillment.job?.status === 'pending' && <div className="mt-2 text-xs text-muted">Следующая попытка: {dt(data.fulfillment.job.run_at)}</div>}
            {(canRetry || canHand) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {canRetry && <Btn size="sm" variant="secondary" loading={busy === 'retry'} onClick={retry}><RefreshCw className="h-3.5 w-3.5" /> Повторить выдачу</Btn>}
                {canHand && <Btn size="sm" variant="secondary" loading={busy === 'manual'} onClick={handOver}><UserCog className="h-3.5 w-3.5" /> Передать оператору</Btn>}
              </div>
            )}
            {data.units.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted"><KeyRound className="h-3.5 w-3.5" /> Единицы товара (скрыты)</div>
                <div className="space-y-1">
                  {data.units.map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate font-mono text-xs">{u.label || `#${u.id}`}</span>
                      <span className="shrink-0 text-xs text-muted">{UNIT_STATUS[u.status] ?? u.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {o.delivery_data && (
            <div className="rounded-2xl bg-success/10 p-3.5 text-sm">
              <div className="mb-1 text-xs font-semibold text-success">Выдано покупателю</div>
              <div className="whitespace-pre-wrap break-words">{o.delivery_data}</div>
            </div>
          )}
          {transitions.includes('completed') && (
            <Field label="Данные для выдачи (придут покупателю при завершении)" hint={!o.premium_number_id && data.product?.delivery_note ? 'Пусто — покупатель увидит инструкцию товара.' : undefined}>
              <textarea className="input min-h-[80px]" value={delivery ?? o.delivery_data ?? ''} onChange={(e) => setDelivery(e.target.value)} placeholder="Например: код, ссылка или инструкция" />
            </Field>
          )}
          {editable && (
            <Field label="Заметка администратора (видна только в админке, сохраняется при смене статуса)">
              <input className="input" value={note ?? o.admin_note ?? ''} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          {!editable && o.admin_note && <KV label="Заметка">{o.admin_note}</KV>}

          {canStatus && (
            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted"><Send className="h-3.5 w-3.5" /> Отправить уведомление повторно</div>
              <div className="flex gap-2">
                <select className="input flex-1" value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Тип уведомления">
                  <option value="">Выберите уведомление…</option>
                  {CUSTOMER_EVENTS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                </select>
                <Btn variant="secondary" className="h-11" disabled={!event} loading={busy === 'notify'} onClick={resend}>Отправить</Btn>
              </div>
            </section>
          )}

          {data.payments.length > 0 && (
            <section>
              <div className="mb-2 text-xs font-semibold text-muted">Платежи</div>
              <div className="space-y-1.5">
                {data.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate">#{p.id} · {METHOD[p.method] ?? p.method}{p.user_comment ? ` · «${p.user_comment}»` : ''}</span>
                    <span className="flex shrink-0 items-center gap-2"><span className="tabular font-semibold">{money(p.amount)}</span><Badge tone={PAYMENT_STATUS[p.status]?.tone ?? 'gray'}>{PAYMENT_STATUS[p.status]?.label ?? p.status}</Badge></span>
                  </div>
                ))}
              </div>
              {data.payments.some((p) => p.status === 'awaiting_confirmation') && (
                <p className="mt-2 text-xs text-warning">Перевод ждёт проверки — подтвердите или отклоните его в разделе «Финансы → Платежи».</p>
              )}
            </section>
          )}

          {data.refunds.length > 0 && (
            <section>
              <div className="mb-2 text-xs font-semibold text-muted">Возвраты</div>
              <div className="space-y-1.5">
                {data.refunds.map((r) => (
                  <div key={r.id} className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">#{r.id} · {REFUND_METHOD[r.method] ?? r.method} · <span className="tabular font-semibold">{money(r.amount)}</span></span>
                      <Badge tone={REFUND_STATUS[r.status]?.tone ?? 'gray'}>{REFUND_STATUS[r.status]?.label ?? r.status}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted">{dt(r.created_at)} · {actorLabel(r.requested_by)} · {r.reason}</div>
                    {r.error && <div className="mt-1 text-xs text-danger">{r.error}</div>}
                    {r.status === 'manual_pending' && canRefund && (
                      <Btn size="sm" variant="success" className="mt-2" loading={busy === `refund-${r.id}`} onClick={() => confirmManual(r.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Подтвердить перевод
                      </Btn>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {(data.tickets.length > 0 || data.incidents.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.tickets.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted"><Headphones className="h-3.5 w-3.5" /> Обращения</div>
                  <div className="space-y-1">
                    {data.tickets.map((t) => (
                      <Link key={t.id} to={`/support?t=${t.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]">
                        <span className="min-w-0 truncate">#{t.id} · {t.subject}</span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted">{TICKET_STATUS[t.status] ?? t.status}<ExternalLink className="h-3 w-3" /></span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
              {data.incidents.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted"><AlertTriangle className="h-3.5 w-3.5" /> Инциденты</div>
                  <div className="space-y-1">
                    {data.incidents.map((i) => (
                      <div key={i.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">{i.title}</span>
                        <Badge tone={i.status === 'open' ? (i.severity === 'critical' ? 'red' : 'amber') : 'gray'}>{i.status === 'open' ? 'открыт' : 'решён'}</Badge>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          <Timeline items={data.timeline} />
        </div>
      )}
    </Modal>
    {o && refundOpen && (
      <RefundModal orderId={o.id} title={orderNo(o)} total={o.total} methods={refundMethods} onClose={() => setRefundOpen(false)}
        onDone={async (msg) => { setRefundOpen(false); await after(msg) }} />
    )}
  </>)
}

function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <section>
      <div className="mb-3 text-xs font-semibold text-muted">Хронология</div>
      {items.length === 0 ? <div className="text-sm text-muted">Событий пока нет.</div> : (
        <ol className="space-y-0">
          {items.map((e, i) => {
            const k = TIMELINE_ICON[e.kind] ?? TIMELINE_ICON.status
            const last = i === items.length - 1
            return (
              <li key={i} className="relative flex gap-3 pb-4">
                {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-white/10" />}
                <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full', k.cls)}><k.icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className={clsx('text-sm font-semibold', e.kind === 'error' && 'text-danger')}>{e.title}</div>
                  <div className="text-xs text-muted">{dt(e.at)}{e.actor ? ` · ${actorLabel(e.actor)}` : ''}</div>
                  {e.note && <div className="mt-1 whitespace-pre-wrap break-words text-xs text-muted/90">{e.note}</div>}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function RefundModal({ orderId, title, total, methods, onClose, onDone }: {
  orderId: number; title: string; total: number; methods: string[]; onClose: () => void; onDone: (msg: string) => void
}) {
  const [method, setMethod] = useState(methods[0] ?? 'balance')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const submit = async () => {
    setBusy(true)
    try {
      const r = await api<{ status: string; refund_id?: number | null; approval_id?: number }>(`/orders/${orderId}/refund`, { method: 'POST', body: { method, reason: reason.trim() } })
      onDone(r.status === 'approval_required' ? 'Запрос отправлен на одобрение'
        : r.status === 'manual_pending' ? 'Возврат создан — выполните перевод и нажмите «Подтвердить перевод»'
        : r.status === 'processing' ? 'Возврат отправлен в обработку'
        : 'Возврат выполнен')
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Возврат по заказу ${title}`} subtitle={`Сумма: ${money(total)}`}
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Отмена</Btn>
        <Btn variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={submit}>Оформить возврат</Btn>
      </>}>
      <div className="space-y-3">
        <Field label="Способ возврата">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => <option key={m} value={m}>{REFUND_METHOD[m] ?? m}</option>)}
          </select>
        </Field>
        <Field label="Причина" hint="Минимум 3 символа. Видна в истории заказа.">
          <textarea className="input min-h-[80px]" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <p className="text-xs text-muted">
          {method === 'manual' ? 'Ручной перевод: после отправки денег подтвердите его в карточке заказа.'
            : method === 'stars' ? 'Stars вернутся покупателю через Telegram.'
            : 'Сумма будет зачислена на баланс покупателя в магазине.'}
          {' '}Если сумма выше лимита вашей роли, будет создан запрос на одобрение.
        </p>
      </div>
    </Modal>
  )
}
