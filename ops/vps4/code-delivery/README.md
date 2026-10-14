# Исправление доставки кода входа в мастере сессий (vps4)

Мастер «Создать .session» (`backend/app/services/session_wizard.py`, `admin/src/components/files/SessionWizard.tsx`)
есть только на vps4 в `/opt/f1z-prime`, в git его нет. Поэтому исправление оформлено как патч по точным
якорям: `apply_patch.py` сначала проверяет все якоря и только потом пишет файлы (либо всё, либо ничего).

## Причина зависания на +380

Раньше тип отправки определялся по подстроке в `type(sent.type).__name__`:

- `SentCodeTypeSetUpEmailRequired` («сначала привяжите почту для входа») попадал в `email`, и UI просил
  «проверить почту». Код при этом не отправлялся вообще, и вход висел до истечения 10 минут.
- `SentCodeTypeFirebaseSms`/`SentCodeTypeApp` без альтернативы: не было способа запросить другой канал
  (`auth.resendCode`), хотя Telegram отдаёт `next_type` и `timeout`.

## Что меняется

Бэкенд (`session_wizard.py`, `admin_sessions.py`):
- `delivery_medium(sent.type)`: `SentCodeTypeApp` → `"app"`, `SentCodeTypeSms`/`FirebaseSms`/`SmsWord`/`SmsPhrase` →
  `"sms"`, звонки → `"call"`, `EmailCode` → `"email"`, `FragmentSms` → `"fragment"`.
- Ответ API содержит `delivery_medium`, `code_length`, `next_delivery_medium`, `resend_in`; старое поле
  `delivery` сохранено.
- `phone_code_hash` сохраняется во flow на сервере (как и раньше) и в браузер **не** отдаётся: он нужен только
  для `sign_in`, а существующий тест проверяет, что хеш не утекает в ответы.
- `SetUpEmailRequired` → сразу 409 с инструкцией, вместо бесконечного ожидания.
- `POST /api/admin/telegram-sessions/{id}/resend` → `auth.ResendCodeRequest` (например, «приложение → SMS»),
  с учётом `timeout` от Telegram.
- `FloodWaitError`: «Telegram временно ограничил отправку кодов на этот номер, повторите через X секунд»
  (и при отправке кода, и при повторной отправке, и при `sign_in`). `PhoneNumberFloodError` → понятный 429.
- После кода/2FA, как и раньше, вызывается `client.get_me()`. Номер +380 определяется как `UA` и через
  `session_registry.register` → `phones._product_for_country('UA')` попадает в `phone_inventory` товара
  «Номер Украина» (id 2, категория `numbers`, цена 140).

Админка: на шаге «Код» подсказка по `delivery_medium`:
- `app` — «Код отправлен в официальное приложение Telegram на ваших других устройствах (в чат «Служебные уведомления» / Telegram)»;
- `sms` — «Код отправлен по SMS»;
- кнопка «Отправить код по SMS / звонком» с обратным отсчётом, если Telegram предлагает другой канал.

## Развёртывание

```bash
mkdir -p /opt/f1z-deploy/code-delivery/patch
# скопировать сюда apply_patch.py и test_session_code_delivery.py
bash deploy.sh
```

`deploy.sh`: патч на копии → сборка образов (web-сборка проверяет TypeScript) → тесты мастера на временной БД
→ дамп БД, rollback-теги образов → замена api/bot/worker/web → проверки HTTPS; при ошибке — автоматический откат.
