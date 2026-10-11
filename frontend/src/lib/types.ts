export interface Country {
  id: number
  code: string
  name: string
  flag: string
  dial_code: string
  sort_order: number
  is_active: boolean
}

export interface CountryCatalog extends Country {
  product_id: number | null
  price: number | null
  /** prices are set separately by the shop (not converted by a rate) */
  price_usd: number | null
  price_stars: number | null
  stars_enabled: boolean
  stock: number
}

export interface Product {
  id: number
  title: string
  description: string
  category: string
  price: number
  /** regular price, shown crossed out while a sale is active */
  old_price: number | null
  stock: number
  is_popular: boolean
  country: Country | null
  tags: string[]
  attributes: Record<string, string>
  max_per_order: number | null
  price_usd: number | null
  price_stars: number | null
  stars_enabled: boolean
  fulfillment_mode: 'auto' | 'manual' | 'review'
  /** delivered automatically right after payment (confirmed stock + auto mode) */
  instant: boolean
}

export interface PremiumNumber {
  id: number
  title: string
  tier: string
  display_mask: string
  description: string
  price: number
  status: string
  country: Country | null
}

export interface Me {
  id: number
  telegram_id: number
  username: string | null
  first_name: string | null
  last_name: string | null
  photo_url: string | null
  balance: number
  total_spent: number
  orders_count: number
  created_at: string
}

export type OrderStatus = 'pending' | 'paid' | 'processing' | 'completed' | 'cancelled' | 'expired' | 'refunded'

export interface Payment {
  id: number
  kind: string
  method: PayMethod
  status: 'pending' | 'awaiting_confirmation' | 'confirmed' | 'rejected' | 'cancelled'
  amount: number
  stars_amount: number | null
  is_test: boolean
  order_id: number | null
  created_at: string
  confirmed_at: string | null
}

export interface Order {
  id: number
  item_title: string
  quantity: number
  unit_price: number
  total: number
  status: OrderStatus
  payment_method: string | null
  delivery_data: string | null
  expires_at: string | null
  paid_at: string | null
  completed_at: string | null
  created_at: string
  product_id: number | null
  premium_number_id: number | null
  public_id: string | null
  fulfillment_status: string | null
  stage: OrderStage
  discount: number
  promo_code: string | null
  stars_total: number | null
  usd_total: number | null
}

export type OrderStage =
  | 'pending_payment' | 'payment_review' | 'paid' | 'fulfillment_pending' | 'processing'
  | 'delivered' | 'manual_review' | 'failed' | 'cancelled' | 'refunded'

export interface OrderDetail extends Order {
  payments: Payment[]
  delivery_note: string | null
  /** keys / codes — only present once the order is delivered */
  delivered_items: string[]
  delivered_kind: string | null
  support_ticket_id: number | null
}

export interface SupportCategory { key: string; label: string; text: string }
export interface PromoPreview { code: string; discount: number; total: number; subtotal: number }

export type PayMethod = 'balance' | 'stars' | 'manual' | 'test'

export interface PayResponse {
  payment: Payment
  order: Order | null
  invoice_link: string | null
  instructions: string | null
}

export interface Transaction {
  id: number
  type: 'topup' | 'purchase' | 'refund' | 'admin_adjust'
  amount: number
  balance_after: number
  description: string
  order_id: number | null
  created_at: string
}

export interface Category {
  slug: string
  title: string
  icon: string
  count: number
  stock: number
}

export interface PublicConfig {
  settings: Record<string, string>
  dev_mode: boolean
  bot_username: string
  payment_methods: PayMethod[]
}

export interface Ticket {
  id: number
  subject: string
  status: 'open' | 'answered' | 'closed'
  created_at: string
  updated_at: string
}

export interface TicketDetail extends Ticket {
  messages: { id: number; is_admin: boolean; text: string; created_at: string }[]
}
