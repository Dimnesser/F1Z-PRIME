import type { OrderStage, OrderStatus, Payment } from './types'

export const money = (v: number | null | undefined, currency = 'грн') =>
  v === null || v === undefined
    ? '—'
    : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v)} ${currency}`

export const date = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: 'violet' | 'cyan' | 'green' | 'amber' | 'red' | 'gray' }> = {
  pending: { label: 'Ожидает оплаты', tone: 'amber' },
  paid: { label: 'Оплачен', tone: 'cyan' },
  processing: { label: 'В обработке', tone: 'violet' },
  completed: { label: 'Выполнен', tone: 'green' },
  cancelled: { label: 'Отменён', tone: 'gray' },
  expired: { label: 'Истёк', tone: 'gray' },
  refunded: { label: 'Возврат', tone: 'red' },
}

type Tone = 'violet' | 'cyan' | 'green' | 'amber' | 'red' | 'gray'
/** explicit order lifecycle stage computed on the server */
export const ORDER_STAGE: Record<OrderStage, { label: string; tone: Tone; hint: string }> = {
  pending_payment: { label: 'Ожидает оплаты', tone: 'amber', hint: 'Товар зарезервирован за вами до конца таймера.' },
  payment_review: { label: 'Платёж на проверке', tone: 'amber', hint: 'Администратор проверяет поступление средств. Мы сообщим в Telegram.' },
  paid: { label: 'Оплачен', tone: 'cyan', hint: 'Оплата подтверждена, заказ передан на выдачу.' },
  fulfillment_pending: { label: 'Готовим выдачу', tone: 'cyan', hint: 'Оплата подтверждена, товар выдаётся автоматически.' },
  processing: { label: 'Выдаётся', tone: 'violet', hint: 'Выдача товара в процессе.' },
  delivered: { label: 'Выполнен', tone: 'green', hint: 'Товар выдан — данные ниже.' },
  manual_review: { label: 'У оператора', tone: 'violet', hint: 'Заказ оплачен и передан оператору — выдача в ближайшее время.' },
  failed: { label: 'Задержка выдачи', tone: 'red', hint: 'Оплата сохранена, мы уже разбираемся. Можно написать в поддержку.' },
  cancelled: { label: 'Отменён', tone: 'gray', hint: 'Заказ отменён или резерв истёк.' },
  refunded: { label: 'Возврат', tone: 'red', hint: 'По заказу выполнен возврат.' },
}

export const PAYMENT_STATUS: Record<Payment['status'], string> = {
  pending: 'Ожидает оплаты',
  awaiting_confirmation: 'На проверке',
  confirmed: 'Подтверждён',
  rejected: 'Отклонён',
  cancelled: 'Отменён',
}

export const METHOD_LABEL: Record<string, string> = {
  balance: 'Баланс',
  stars: 'Telegram Stars',
  manual: 'Перевод на карту',
  test: 'Тестовая оплата',
}

export const TX_LABEL: Record<string, string> = {
  topup: 'Пополнение',
  purchase: 'Покупка',
  refund: 'Возврат',
  admin_adjust: 'Корректировка',
}

export const plural = (n: number, forms: [string, string, string]) => {
  const n10 = n % 10, n100 = n % 100
  if (n10 === 1 && n100 !== 11) return forms[0]
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1]
  return forms[2]
}
