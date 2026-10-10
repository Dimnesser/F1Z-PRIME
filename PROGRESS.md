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

## Stage 2 — Admin frontend ✅
- New design system (palette from the brief, Manrope/Unbounded, Lucide icons): collapsible sidebar,
  mobile bottom navigation + "Ещё" sheet, skeletons, toasts, confirm dialogs (danger actions, reasons),
  modals as bottom sheets on phones, tables → cards on small screens, SVG charts with touch tooltips.
- Pages: Обзор, Заказы, Пользователи, Товары (+категории), Красивые номера, Страны, Финансы,
  Поддержка (messenger UI), Автоматизация, Настройки (магазин, оплата, уведомления, команда, журнал).
- Tab-switch crash safety: no expression-bodied effects, stale responses dropped, error boundary per
  page with auto-reload on stale chunks after deploy; admin index.html served with `no-cache`.
- framer-motion removed from the admin (CSS animations only); pages lazy-loaded.

## Stage 3 — Mini App ✅
- Maintenance notice, store description, banner image and links (support/channel/rules) from settings.
  Purchases/top-ups return 503 during maintenance (Mini App and bot).

## Verification
- `pytest`: 69 passed. `npm run build` (admin, Mini App): OK.
- Playwright E2E (desktop 1440 + mobile 390): login, all pages, rapid tab switching ×2, add product,
  inline price/stock, bulk +10%, user search/profile, complete order (history shown), confirm manual
  payment, support reply, maintenance on→503→off, store settings in public config;
  no page errors, no horizontal scroll on mobile.

## Stage 4 — Deploy to vps4 ⏳
