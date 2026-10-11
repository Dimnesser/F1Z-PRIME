# Legacy panel → F1Z PRIME: safe migration

The supplied old panel is a standalone SQLite/Telegram bot (`bot.py`, `accounts.db`), **not a documented HTTP API**. F1Z PRIME already provides inventory endpoints (`/api/admin/inventory/summary` and `/api/admin/products/{id}/inventory`) and order processing.

## Inventory reconciliation

Run `python tools/legacy_panel_audit.py /secure/path/accounts.db --output /secure/path/legacy-summary.csv` locally. The script reads only `region`, `price`, and `sold` aggregates; it does **not** read phone numbers, login codes, Telegram session files, or buyer data. Compare totals with the F1Z PRIME admin dashboard. The report is informational, not an automated stock import: importing unverified legacy records as deliverable inventory could produce undeliverable orders.

## Integration boundaries

- Keep the existing F1Z PRIME PostgreSQL database as the source of truth for orders and payments.
- Import only catalog metadata and approved digital products through the existing admin UI/API.
- Never run the old `bot.py` on production or upload its `.session` files, `.env`, login codes, or old `accounts.db` to the server.
- Do not assume the legacy panel exposes an API. If its developer provides a documented read-only inventory API, integrate it with explicit authentication, timeouts, reconciliation, and no account-login capabilities.
- Do not automate retrieval or forwarding of Telegram user-account authentication codes or session credentials.
- Use operator-assisted fulfillment for any account-related order; automatically deliver only approved, non-authentication digital goods.

## Release checklist

1. Back up PostgreSQL and confirm recovery works.
2. Compare the aggregate audit with the existing product list; reconcile manually.
3. Test duplicate imports, stock reservations, cancellations, refunds and operator notifications.
4. Review RBAC permissions and redact sensitive information from logs.
5. Deploy from a reviewed commit and run smoke tests before informing the customer.

## Generate import-ready hidden catalog drafts

Run `python tools/legacy_catalog_preview.py /secure/path/accounts.db --output /secure/path/catalog-preview.csv`.
The resulting CSV matches the existing F1Z PRIME **Products → Import** format and can be reviewed and imported as **hidden draft products with stock 0**. This deliberately does not activate listings, assign country IDs, or create deliverable inventory. Inspect titles, country mappings, prices, and categories before importing; remove duplicates against existing products. The import operation creates products if no ID is present, so **do not import the same file twice**.

## Duplicate-safe reconciliation against live F1Z catalog

Export products from the admin dashboard (Products → Export CSV), then run:

```bash
python tools/legacy_reconcile.py /secure/path/accounts.db /secure/path/f1z-products.csv --output /secure/path/reconciliation.csv
```

The resulting report marks existing matching draft titles and missing draft titles for human review. It **does not** modify the database, create live inventory, import phone numbers, or process Telegram authentication codes. A title match is not proof that two products are identical; staff must verify manually. Never publish `accounts.db` or session files.
