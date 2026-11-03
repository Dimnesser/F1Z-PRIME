import type { Tone } from '../ui'
import type { Product } from '../../lib/types'

export type FulfillmentMode = Product['fulfillment_mode']

export const FULFILLMENT: Record<FulfillmentMode, { label: string; short: string; hint: string; tone: Tone }> = {
  auto: { label: 'Автовыдача', short: 'Авто', tone: 'cyan', hint: 'Бот выдаёт товар сразу после оплаты, без участия сотрудников.' },
  manual: { label: 'Оператор выдаёт вручную', short: 'Вручную', tone: 'gray', hint: 'Заказ ждёт сотрудника — он выдаёт товар из карточки заказа.' },
  review: { label: 'Проверка перед выдачей', short: 'Проверка', tone: 'amber', hint: 'Выдача только после того, как сотрудник проверит и одобрит заказ.' },
}

export const UNIT_STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: 'Свободно', tone: 'green' },
  reserved: { label: 'Резерв', tone: 'amber' },
  sold: { label: 'Продано', tone: 'violet' },
  void: { label: 'Списано', tone: 'gray' },
}

export const STOCK_REASON: Record<string, string> = {
  initial: 'Начальный остаток', import: 'Загрузка', manual: 'Корректировка', void: 'Списание единицы', mode: 'Смена режима остатка',
  reserved: 'Резерв заказа', sold_extra: 'Выдача заказа', released: 'Снятие резерва', expired: 'Заказ истёк', cancelled: 'Заказ отменён',
  refunded: 'Возврат',
}

/** sale price is shown only while it's set and not expired (same rule as the server) */
export const saleActive = (p: Pick<Product, 'sale_price' | 'sale_ends_at'>, now = Date.now()) =>
  p.sale_price !== null && p.sale_price !== undefined && (!p.sale_ends_at || new Date(p.sale_ends_at).getTime() > now)

/** sale window state for list badges */
export function schedule(p: Pick<Product, 'available_from' | 'available_until'>, now = Date.now()): { label: string; tone: Tone } | null {
  if (p.available_until && new Date(p.available_until).getTime() <= now) return { label: 'Снят с продажи', tone: 'red' }
  if (p.available_from && new Date(p.available_from).getTime() > now) return { label: `Не в продаже до ${shortDate(p.available_from)}`, tone: 'amber' }
  if (p.available_until) return { label: `В продаже до ${shortDate(p.available_until)}`, tone: 'gray' }
  return null
}

const shortDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const pad = (n: number) => String(n).padStart(2, '0')
/** ISO (UTC) → value for <input type="datetime-local"> in the admin's local time */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** datetime-local value → ISO; empty = no limit (null clears the field on the server) */
export function localToIso(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const decimal = (v: string) => v.replace(',', '.').replace(/[^\d.]/g, '')
