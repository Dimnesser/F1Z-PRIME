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

## Stage 4 — Deploy to vps4 ✅
- Delivery: git clone over a read-only deploy key (`github-f1z`), pinned to `890c261`; site kept serving
  while images were built. `/opt/f1z-prime/DEPLOYED_COMMIT` = `890c261 PROGRESS: deploy status`.
- Backups before update: `/root/f1z-backup/db-20261010-173257.sql.gz` (pg_dump, 12 tables),
  `/root/f1z-backup/code-20261010-173257.tgz`. `.env` checksum identical before/after.
- Migration 0001 → 0002 applied; data kept (users 3, orders 3, products 8, settings 28).
- Checks: HTTPS 200 (cert valid to 2027-01-08), Mini App + deep link 200, /api/health ok, admin panel 200
  (`Cache-Control: no-cache`), owner login OK, all admin sections 200, bot polling @prime_f1z_bot,
  no errors in API logs, bot token not present in logs.

## Stage 5 — Admin panel inside the Telegram Mini App ✅
- Profile page of the Mini App: «🛡 Админ-панель» card (below the stats, above «Мои покупки»), shown only
  when `GET /api/me/admin-access` (signed initData) confirms owner/admin.
- Roles from Telegram id, server-side only: OWNER_TELEGRAM_ID → owner; staff account with linked Telegram ID
  → its role; ADMIN_TELEGRAM_IDS → admin. Support role is not allowed from the Mini App.
- The existing /admin/ opens in the same WebView (`location.assign('/admin/')`); Telegram's script keeps
  initData for same-origin pages. The panel exchanges it via `POST /api/admin/telegram-login`
  (`Authorization: tma …`) for a 1-hour token kept in sessionStorage — never in a URL. Role is re-checked on
  every request; expired token → silent re-exchange; revoked access → 401.
- «← Магазин» in the header, «В магазин» in the menu, Telegram BackButton → shop. No-access screen for others.
- Caddy: admin uses `frame-ancestors 'self' https://web.telegram.org https://*.telegram.org` instead of
  `X-Frame-Options: DENY`, so web/desktop Telegram can show it too.
- Settings → Команда: link a staff account to a Telegram ID. Migration 0003.
- Tests: 77 passed (8 new in tests/test_miniapp_admin.py). E2E with the real telegram-web-app.js: owner sees
  the button, panel opens without login form, token only in sessionStorage, no JWT in any URL, back to shop
  keeps the session; regular user: no button, /admin/ → «Нет доступа», admin API 401, exchange 403.
- Deployed to vps4: DEPLOYED_COMMIT `97a99e9` (feature in `0e09c04` + CSP quoting). Backups:
  `/root/f1z-backup/db-20261010-174445.sql.gz`, `db-20261010-174755.sql.gz` + code archives. Migration 0003 applied,
  data kept (users 3, orders 3, products 8); owner token exchange OK, non-admin 403, forged 401, bot polling, no API errors.

## Stage 6 — Full order automation + extended admin (IN PROGRESS, not deployed yet)
Branch `ccr-27c43927-xio4pi`. Live on vps4 is still `97a99e9`.

Done (backend, committed, 106 tests pass):
- Migrations 0004 (inventory units, stock movements, jobs, task runs, incidents, refunds, templates, order
  public_id / fulfillment fields, ticket order/category/priority) and 0005 (roles, admin RBAC columns,
  approvals, staff inbox, admin prefs). Additive only; existing data mapped.
- Worker process `python -m app.worker` (docker-compose service `worker`): durable job queue (SKIP LOCKED,
  backoff 30s·2^n ≤ 1h, dead letter), periodic tasks (reservations expiry, stuck orders, payment checks,
  low stock, outbox, backups, cleanup, daily summary), heartbeat. Bot heartbeat too.
- Fulfillment per product: auto (encrypted units AES-GCM / delivery text) / manual / review; fast path
  `run_now` after payment + durable job fallback; failure → incident + manual queue; admin retry/handover.
- Refunds: balance / Stars (refundStarPayment via worker) / manual (operator confirms); no double refund.
- Notifications from editable templates (customer + staff), dedupe per order+event, quiet hours.
- RBAC: permission catalog, 8 built-in roles + custom roles, extra/denied permissions, limits,
  two-person approvals, expiry, revoke sessions, no self-escalation, owner untouchable; staff inbox, prefs.
- Mini App API: order `stage`, `delivered_items` only after delivery, one-tap support ticket per order.
- Admin API: inventory units (masked), stock history/adjust with reason, order timeline from server records.

Stage C ✅ (commit 67ab448, 116 tests pass): migration 0006 — promo codes (server-side validation under row
lock, per-user and total limits, scope, window, released on cancel/expiry), product sale price / tags /
attributes / sale window / per-order & per-user limits / price history / copy / bulk sale & tags, storefront
settings (sort, out-of-stock) applied, rules engine WHEN→IF→THEN (`services/rules.py`, `api/admin_rules.py`).

Stage D ✅: admin UI moved from fixed roles to permissions; new pages Team (staff/roles/approvals), Promo, Rules
(builder + dry-run + run history), System (status, backups, notification templates), Inbox, Automation center
(health, metrics, dead jobs, incidents, tasks), order card with server timeline / fulfillment / refunds, products
with sale/schedule/tags/attributes/inventory units/price & stock history, dashboard widget prefs + compact mode.
Mini App: promo code at checkout, sale prices, tags/attributes, order stage, delivered keys, one-tap order support.
Checks: backend 117 passed; admin + Mini App tsc and vite builds clean; Playwright E2E against the local API
(built admin, embedded worker): 17 pages × desktop/phone without console errors or 5xx, and 14 real click
scenarios OK (key upload with duplicate skipped, auto-delivery, key masked for staff, order timeline, invite by
Telegram ID, new role, promo code, rule + dry-run + save, template preview, inbox, run task now).

Remaining: Stage E (deploy via deploy key with backups, verify).

Continue with: `cd /home/user/F1Z-PRIME && service postgresql start && python3 -m pytest -q` then
implement the remaining stages listed above (see task list in this file).

## Stage E — Deploy 21fecb1 to vps4 (IN PROGRESS, waiting for the server build)
- Deploy script `f1z-deploy-21fecb1` (Webdock user script 415659) ran 2026-10-11 08:02 (UTC+2):
  cloned branch `ccr-27c43927-xio4pi` over the read-only deploy key, commit verified `21fecb1`.
  Backups: `/root/f1z-backup/db-20261011-060218.sql.gz` (16 tables), `/root/f1z-backup/code-20261011-060218.tgz`.
  `.env` sha256 identical before/after. Build runs in background (`/root/f1z/run-v3.sh`, log `/root/f1z/v3.log`);
  the old version (97a99e9) keeps serving until `docker compose up -d` swaps containers.
- A background waiter (`/root/f1z/wait-verify-v3.sh`, launched by user script 415662) waits for `V3_FINISHED`,
  then runs the read-only check `/root/f1z/f1z-verify-v3.sh` and writes `/root/f1z/verify-v3-result.txt`
  (ends with `DONE`). No rebuild, no new deploy.
- Next step: read `/root/f1z/verify-v3-result.txt` once (Webdock fetch file) and report DEPLOYED_COMMIT,
  containers (incl. new `worker`), alembic=0006, HTTPS/API/Mini App/admin/bot checks, worker heartbeat, log errors.
