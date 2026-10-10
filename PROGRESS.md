# F1Z PRIME — Admin Panel v2: progress

## Stage 1 — Backend ✅
- Migration `0002`: `admin_users` (roles owner/admin/support), `order_events` (order history),
  `categories`, `notification_outbox` (undelivered Telegram notifications), `support_tickets.assigned_to`.
- Roles: `.env` admin = owner; extra accounts (admin/support) in DB. Role checked on every request
  (changes and deactivation apply immediately). Bearer token in header → no CSRF surface. Rate limit:
  120 mutating requests/min per account + login limit.
- Dashboard: revenue total/today/period, orders, users, stock, pending orders, failed payments,
  open tickets, sales & new-user series (7/30/90 days, Europe/Kyiv days), popular categories,
  low stock, last 10 orders.
- Users: search/filters/sort/pagination, profile with orders/payments/transactions, block, balance
  adjustments journaled with reason + admin, CSV export (formula-injection safe).
- Products: CRUD, bulk (status, price set/±%/±, stock, category), CSV import (dry-run, all-or-nothing) / export,
  categories CRUD. Premium numbers keep display masks; full numbers never go to the audit log.
- Orders: filters (status incl. `awaiting_payment`, method, dates, search), detail with payments and
  status history, CSV export. Manual payment confirmation only for buyer-submitted transfers.
- Finance: summary by confirmed money movements (paid orders, refunds, top-ups, by method, failures),
  transactions journal, CSV reports.
- Support: list with last message, filters, assignment to operators.
- Settings: store profile, links, banner, payments, notifications, maintenance (blocks purchases in
  Mini App and bot), automation toggles (auto-complete digital, low-stock alerts, notification retry,
  reservation expiry, daily backup, error monitoring). Backups: JSON.gz to `backups` volume, owner download.
- Tests: `tests/test_admin_panel.py` (18 tests); whole suite 69 passed.

## Stage 2 — Admin frontend ⏳
## Stage 3 — Mini App (maintenance screen, store profile) ⏳
## Stage 4 — Deploy to vps4 ⏳
