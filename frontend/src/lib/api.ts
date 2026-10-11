import { initData } from './telegram'
import type {
  Category, CountryCatalog, Me, Order, OrderDetail, PayMethod, PayResponse, Payment, PremiumNumber, Product,
  PromoPreview, PublicConfig, SupportCategory, Ticket, TicketDetail, Transaction,
} from './types'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const data = initData()
  if (data) headers.Authorization = `tma ${data}`
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } })
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером')
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const detail = body && typeof body.detail === 'string' ? body.detail : `Ошибка ${res.status}`
    throw new ApiError(res.status, detail)
  }
  return body as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  config: () => request<PublicConfig>('/api/config'),
  me: () => request<Me>('/api/me'),
  transactions: () => request<Transaction[]>('/api/me/transactions'),
  adminAccess: () => request<{ allowed: boolean; role: string | null }>('/api/me/admin-access'),
  countries: () => request<CountryCatalog[]>('/api/countries'),
  categories: () => request<Category[]>('/api/categories'),
  products: (params: { category?: string; popular?: boolean; country_id?: number } = {}) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => v !== undefined && q.set(k, String(v)))
    return request<Product[]>(`/api/products?${q}`)
  },
  product: (id: number) => request<Product>(`/api/products/${id}`),
  premium: (country_id?: number) =>
    request<PremiumNumber[]>(`/api/premium-numbers${country_id ? `?country_id=${country_id}` : ''}`),
  premiumOne: (id: number) => request<PremiumNumber>(`/api/premium-numbers/${id}`),
  orders: () => request<Order[]>('/api/orders'),
  order: (id: number) => request<OrderDetail>(`/api/orders/${id}`),
  createOrder: (body: { product_id?: number; premium_number_id?: number; quantity?: number; idempotency_key: string; promo_code?: string }) =>
    post<Order>('/api/orders', body),
  checkPromo: (code: string, product_id: number, quantity: number) =>
    post<PromoPreview>('/api/promo/check', { code, product_id, quantity }),
  supportCategories: () => request<SupportCategory[]>('/api/support/categories'),
  orderSupport: (orderId: number, category: string, text = '') =>
    post<TicketDetail>(`/api/orders/${orderId}/support`, { category, text }),
  pay: (orderId: number, method: PayMethod) => post<PayResponse>(`/api/orders/${orderId}/pay`, { method }),
  cancel: (orderId: number) => post<Order>(`/api/orders/${orderId}/cancel`),
  topup: (amount: number, method: PayMethod) => post<PayResponse>('/api/balance/topup', { amount, method }),
  payment: (id: number) => request<Payment>(`/api/payments/${id}`),
  submitManual: (id: number, comment: string) => post<Payment>(`/api/payments/${id}/submit`, { comment }),
  tickets: () => request<Ticket[]>('/api/support/tickets'),
  ticket: (id: number) => request<TicketDetail>(`/api/support/tickets/${id}`),
  createTicket: (subject: string, text: string) => post<TicketDetail>('/api/support/tickets', { subject, text }),
  replyTicket: (id: number, text: string) => post<TicketDetail>(`/api/support/tickets/${id}/messages`, { text }),
}

export function newIdempotencyKey(): string {
  const rnd = crypto.getRandomValues(new Uint8Array(12))
  return 'mk_' + Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('')
}
