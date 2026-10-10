export type Role = 'owner' | 'admin' | 'support'
export interface Me { username: string; role: Role; role_label: string; dev_mode: boolean; environment: string }

export interface Country { id: number; code: string; name: string; flag: string; dial_code: string; sort_order: number; is_active: boolean }
export interface Category { id: number; slug: string; title: string; icon: string; sort_order: number; is_active: boolean }
export interface User {
  id: number; telegram_id: number; username: string | null; first_name: string | null; last_name: string | null; photo_url: string | null
  balance: number; total_spent: number; orders_count: number; created_at: string; is_blocked: boolean; language_code: string | null; last_seen_at: string | null
}
export type ProductStatus = 'active' | 'hidden' | 'archived'
export interface Product {
  id: number; title: string; description: string; category: string; price: number; stock: number; is_popular: boolean
  country: Country | null; status: ProductStatus; sort_order: number; country_id: number | null; delivery_note: string
  created_at: string; updated_at: string
}
export interface Premium {
  id: number; title: string; tier: string; display_mask: string; description: string; price: number
  status: 'available' | 'reserved' | 'sold' | 'hidden'; country: Country | null; number: string; country_id: number | null; created_at: string
}
export type OrderStatus = 'pending' | 'paid' | 'processing' | 'completed' | 'cancelled' | 'expired' | 'refunded'
export interface Order {
  id: number; item_title: string; quantity: number; unit_price: number; total: number; status: OrderStatus; payment_method: string | null
  delivery_data: string | null; expires_at: string | null; paid_at: string | null; completed_at: string | null; created_at: string
  user: User; admin_note: string | null; idempotency_key: string; product_id: number | null; premium_number_id: number | null
  in_review?: boolean
}
export interface OrderEvent { id: number; from_status: string | null; to_status: string; actor: string; note: string | null; created_at: string }
export type PaymentStatus = 'pending' | 'awaiting_confirmation' | 'confirmed' | 'rejected' | 'cancelled'
export interface Payment {
  id: number; kind: 'order' | 'topup'; method: string; status: PaymentStatus
  amount: number; stars_amount: number | null; is_test: boolean; order_id: number | null; created_at: string; confirmed_at: string | null
  user: User; payload: string; external_id: string | null; user_comment: string | null; admin_comment: string | null; confirmed_by: string | null
}
export interface Message { id: number; is_admin: boolean; text: string; created_at: string }
export interface Ticket {
  id: number; subject: string; status: 'open' | 'answered' | 'closed'; created_at: string; updated_at: string; user: User
  assigned_to: string | null; messages?: Message[]
  last_message?: { text: string; is_admin: boolean; created_at: string } | null; messages_count?: number
}
export interface Transaction { id: number; type: string; amount: number; balance_after: number; description: string; order_id: number | null; created_at: string }
export interface Paged<T> { total: number; items: T[] }
export interface SettingRow { key: string; value: string; description: string; is_public: boolean; type: 'bool' | 'number' | 'text' }
export interface Account { id: number; username: string; role: Role; is_active: boolean; last_login_at: string | null; created_at: string }
export interface AuditRow { id: number; admin: string; action: string; entity: string; entity_id: number | null; details: Record<string, unknown>; created_at: string }
export interface SeriesPoint { date: string; revenue?: number; orders?: number; users?: number }
