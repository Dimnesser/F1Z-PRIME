# F1Z PRIME

Telegram Mini App + Telegram-бот + веб-админка для магазина цифровых товаров: каталог по странам с ценами и остатками, красивые номера с масками, заказы, платежи (Telegram Stars, баланс, ручная проверка), профили, поддержка.

```
f1z-prime/
├── backend/            FastAPI API, SQLAlchemy-модели, сервисы, Alembic-миграции (backend/migrations), seed
│   ├── app/api/        public.py (Mini App), admin.py (админка)
│   ├── app/services/   заказы, платежи, маски, настройки, Telegram API
│   └── Dockerfile      единый образ для API и бота
├── bot/                aiogram 3 бот (та же БД и те же сервисы, что у API)
├── frontend/           Telegram Mini App (React, TS, Vite, Tailwind, Framer Motion, Lucide)
├── admin/              Админ-панель (React, TS, Vite, Tailwind) — /admin
├── docker/             Caddyfile (HTTPS), web.Dockerfile (Mini App + админка), entrypoint, branding/
├── tests/              pytest: API, безопасность, бот, маски (реальный PostgreSQL)
├── docker-compose.yml
└── .env.example
```

## Быстрый старт (продакшен, VPS)

Требования: Linux VPS 1 vCPU / 1 GB RAM / 10+ GB SSD, Docker + Docker Compose, домен с A-записью на IP сервера, открыты порты 80/443.

```bash
git clone <repo> f1z-prime && cd f1z-prime
cp .env.example .env
nano .env        # BOT_TOKEN, SITE_ADDRESS, WEBAPP_URL, CORS_ORIGINS, POSTGRES_PASSWORD, SECRET_KEY, ADMIN_*
docker compose up -d --build
docker compose ps            # все сервисы healthy
docker compose logs -f api bot
```

* Mini App: `https://<домен>/`
* Админка: `https://<домен>/admin/`
* API docs (только не в production): `/api/docs`

При старте контейнер `api` сам применяет миграции (`alembic upgrade head`) и выполняет идемпотентный seed (8 стран, цены, остатки, настройки).

Хэш пароля админа (рекомендуется вместо `ADMIN_PASSWORD`):

```bash
docker compose run --rm --entrypoint python api -c "from app.security import hash_password; print(hash_password('ВАШ_ПАРОЛЬ'))"
# результат -> ADMIN_PASSWORD_HASH в .env, затем: docker compose up -d
```

### Настройка бота в @BotFather

1. `/newbot` → получить `BOT_TOKEN`.
2. `/setuserpic` → загрузить `docker/branding/bot-avatar.jpg` (аватарка бота — через Bot API её поставить нельзя).
3. `/newapp` (или Bot Settings → Configure Mini App) → URL `https://<домен>/` — для ссылок вида `t.me/<bot>/<app>?startapp=product_5`.
4. Telegram Stars: дополнительных токенов не нужно (`currency=XTR`, пустой `provider_token`).

Бот при запуске сам выставляет список команд и кнопку меню «F1Z PRIME», открывающую Mini App.

### Обслуживание

```bash
docker compose exec db pg_dump -U f1z f1z | gzip > backup_$(date +%F).sql.gz   # бэкап
docker compose pull && docker compose up -d --build                            # обновление
docker compose exec api python -m app.seed --demo                              # демо красивые номера
```

Данные хранятся в volume `pgdata` (Postgres) и `caddy_data` (сертификаты) — переживают перезапуски и пересборки.

## Локальная разработка

```bash
# PostgreSQL (любой способ), например:
docker run -d --name f1z-pg -e POSTGRES_USER=f1z -e POSTGRES_PASSWORD=f1z -e POSTGRES_DB=f1z -p 5432:5432 postgres:16-alpine

# backend
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements-dev.txt
cd backend
export DATABASE_URL=postgresql+asyncpg://f1z:f1z@localhost:5432/f1z DEV_MODE=true ADMIN_PASSWORD=admin12345
alembic upgrade head && python -m app.seed --demo
uvicorn app.main:app --reload --port 8000

# Mini App (http://localhost:5173, /api проксируется на :8000)
cd frontend && npm install && npm run dev
# Админка (http://localhost:5174/admin/, логин admin / admin12345)
cd admin && npm install && npm run dev

# Бот (нужен BOT_TOKEN; кнопки Mini App появляются только при https WEBAPP_URL)
cd backend && BOT_TOKEN=... PYTHONPATH=.:.. python -m bot.main
```

**DEV_MODE** (`DEV_MODE=true`, `ENVIRONMENT=development`): запросы без Telegram `initData` авторизуются как тестовый пользователь `dev_tester`, доступен способ оплаты «Тестовая оплата» (помечается `is_test`, бейдж «ТЕСТОВЫЙ ПЛАТЁЖ»). При `ENVIRONMENT=production` DEV_MODE принудительно выключается.

### Тесты

```bash
createdb f1z_test   # или: CREATE DATABASE f1z_test OWNER f1z;
TEST_DATABASE_URL=postgresql+asyncpg://f1z:f1z@localhost:5432/f1z_test pytest -q
```

Тесты пересоздают схему через Alembic-миграции и покрывают: проверку подписи и срока initData, защиту админки, изменение цены админом и отображение в Mini App, CRUD товаров/стран/красивых номеров, создание и идемпотентность заказов, резерв и возврат остатков, лимит неоплаченных заказов, оплату с баланса без двойного списания, ручные платежи и защиту от повторного подтверждения, Telegram Stars (pre-checkout + повторная доставка `successful_payment`), переходы статусов, выдачу красивого номера, поддержку, `/start` и все кнопки бота.

## Как устроено

**Авторизация.** Mini App шлёт `Authorization: tma <initData>`; backend проверяет HMAC-SHA256 подпись (`secret = HMAC("WebAppData", BOT_TOKEN)`) и `auth_date` (по умолчанию 24 ч). `user_id`, цена, баланс никогда не берутся с фронтенда. Админка — логин/пароль → JWT (HS256, 12 ч), rate limit на вход, журнал действий `admin_actions`.

**Заказ.** Клиент присылает только id товара, количество и `idempotency_key`. Сервер под `SELECT … FOR UPDATE` блокирует пользователя и товар, проверяет остаток, резервирует его (или бронирует красивый номер) и создаёт заказ `pending` на 30 минут. Повтор того же ключа возвращает тот же заказ. Неоплаченные заказы истекают фоновой задачей, остаток возвращается.

**Оплата.**
* *Баланс* — атомарное списание + транзакция в `balance_transactions`.
* *Telegram Stars* — `createInvoiceLink` (XTR) → `WebApp.openInvoice`; бот валидирует `pre_checkout_query` (сумма, пользователь, статус заказа) и обрабатывает `successful_payment`; `telegram_payment_charge_id` уникален → повторная обработка невозможна. Курс `uah_per_star` задаётся в Settings.
* *Перевод на карту* — пользователь нажимает «Я оплатил», админ подтверждает в Payments только после проверки выписки (обязательный чекбокс).
* Оплата, пришедшая к уже закрытому заказу, зачисляется на баланс.

**Статусы заказа:** `pending → paid | cancelled | expired`; `paid → processing | completed | refunded`; `processing → completed | refunded`; `completed → refunded`. В `paid` — только через подтверждённый платёж. Возврат зачисляет сумму на баланс.

**Красивые номера.** Полный номер хранится на сервере и не отдаётся публичным API; покупатели видят `display_mask` (задаётся админом вручную или генерируется кнопкой «Авто»). После оплаты номер выдаётся в заказе.

**Ограничения.** Система продаёт только разрешённые цифровые товары: нет передачи Telegram-сессий, кодов авторизации, паролей и обхода ограничений платформ.

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `ENVIRONMENT` | `production` / `development` / `test` |
| `DEV_MODE` | тестовый пользователь и тестовые платежи (выключается в production) |
| `BOT_TOKEN`, `BOT_USERNAME` | бот из @BotFather |
| `WEBAPP_URL` | https-адрес Mini App (для кнопок бота) |
| `SITE_ADDRESS` | домен для HTTPS (Caddy сам получает сертификат Let's Encrypt) |
| `CORS_ORIGINS` | разрешённые origin через запятую |
| `POSTGRES_DB/USER/PASSWORD` | база данных (`DATABASE_URL` собирается в compose) |
| `SECRET_KEY` | подпись JWT админки, ≥ 32 символов |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` / `ADMIN_PASSWORD` | вход в админку |
| `ADMIN_TELEGRAM_IDS` | кому бот шлёт уведомления о заказах/платежах/обращениях |
| `INIT_DATA_TTL_SECONDS`, `ORDER_TTL_MINUTES`, `MAX_PENDING_ORDERS` | безопасность и резервы |
| `SEED_ON_START`, `SEED_DEMO_PREMIUM` | seed при старте, демо красивые номера |

## Хостинг и ресурсы

Стек укладывается в ~0.5 GB RAM: Postgres ≤256 MB (настроен под малую память), API ≤256 MB (1 worker uvicorn), бот ≤192 MB, Caddy ≤96 MB (раздаёт статику и HTTPS, отдельный nginx не нужен). Подходит VPS 1 vCPU / 1 GB RAM; добавьте swap 1 GB:

```bash
fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Тарифы около 100 грн/мес встречаются у недорогих VPS-провайдеров (1 GB RAM); цены меняются — сверяйтесь с актуальными тарифами.
