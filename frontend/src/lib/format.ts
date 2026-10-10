import type { OrderStatus, Payment } from './types'

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
