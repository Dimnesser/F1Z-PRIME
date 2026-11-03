import { ChevronLeft, ChevronRight, Download, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { SettingsSection, useSettings } from '../components/SettingsForm'
import { Btn, Card, Chips, DataTable, ErrorBox, Field, IconBtn, PageHead, Tabs, useToast } from '../components/ui'
import { download, dt, errMsg, qs } from '../lib/api'
import { useCan } from '../lib/session'
import type { AuditRow } from '../lib/types'
import { useApi, useDebounced } from '../lib/useApi'

type Tab = 'store' | 'orders' | 'payments' | 'notify' | 'audit'

const LANGUAGES = [{ value: 'ru', label: 'Русский' }, { value: 'uk', label: 'Українська' }, { value: 'en', label: 'English' }]
const CATALOG_SORT = [
  { value: 'manual', label: 'Ручной порядок' }, { value: 'popular', label: 'Сначала популярные' }, { value: 'new', label: 'Сначала новые' },
  { value: 'price_asc', label: 'Сначала дешевле' }, { value: 'price_desc', label: 'Сначала дороже' },
]

export default function Settings() {
  const manage = useCan('system.settings')
  const canAutomation = useCan('system.automation')
  const canNotify = useCan('notifications.manage', 'system.settings')
  const canAudit = useCan('system.audit')
  const canTeam = useCan('staff.manage')
  const [params, setParams] = useSearchParams()
  const { rows, setRows, error } = useSettings()
  const tabs: { value: Tab; label: string }[] = [
    { value: 'store', label: 'Магазин' },
    ...(manage || canAutomation ? [{ value: 'orders' as Tab, label: 'Заказы' }] : []),
    ...(manage ? [{ value: 'payments' as Tab, label: 'Оплата' }] : []),
    ...(canNotify ? [{ value: 'notify' as Tab, label: 'Уведомления' }] : []),
    ...(canAudit ? [{ value: 'audit' as Tab, label: 'Журнал действий' }] : []),
  ]
  const requested = params.get('tab')
  // approvals moved to the Team page; keep old notification links working
  if (requested === 'approvals') return <Navigate to="/team?tab=approvals" replace />
  const tab: Tab = tabs.some((t) => t.value === requested) ? (requested as Tab) : 'store'
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    setParams(next, { replace: true })
  }
  const sect = { rows, onSaved: setRows }
  return (
    <div className="fade-in">
      <PageHead title="Настройки" subtitle="Изменения отображаются в Mini App сразу, без правки кода" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {error && <div className="mb-4"><ErrorBox text={error} /></div>}
      <div className="space-y-4">
        {tab === 'store' && (<>
          <SettingsSection title="Профиль магазина" {...sect} fields={[
            { key: 'shop_name', label: 'Название магазина' },
            { key: 'currency', label: 'Валюта отображения' },
            { key: 'shop_logo_url', label: 'Логотип (URL)', placeholder: 'https://…/logo.png', hint: 'Квадратное изображение, от 256×256' },
            { key: 'language', label: 'Язык Mini App', options: LANGUAGES },
            { key: 'shop_description', label: 'Описание', multiline: true, placeholder: 'Пара предложений о магазине — показывается на главной Mini App' },
          ]} />
          <SettingsSection title="Витрина и каталог" {...sect} fields={[
            { key: 'show_out_of_stock', label: 'Показывать товары без остатка', hint: 'С пометкой «нет в наличии»; иначе такие товары скрыты' },
            { key: 'catalog_sort', label: 'Сортировка каталога', options: CATALOG_SORT },
          ]} />
          <SettingsSection title="Баннер на главной" {...sect} fields={[
            { key: 'banner_title', label: 'Заголовок' },
            { key: 'banner_image_url', label: 'Изображение (URL)', placeholder: 'https://…/banner.jpg', hint: 'Необязательно. Рекомендуемый размер 1200×600.' },
            { key: 'banner_subtitle', label: 'Подзаголовок', multiline: true },
          ]} />
          <SettingsSection title="Промо-баннер" description="Короткая полоса с акцией над каталогом. Пустой текст — баннер скрыт." {...sect} fields={[
            { key: 'promo_banner_text', label: 'Текст', placeholder: '−10% на все номера до воскресенья' },
            { key: 'promo_banner_url', label: 'Ссылка', placeholder: 'https://t.me/f1z_news/123' },
          ]} />
          <SettingsSection title="Контакты и ссылки" {...sect} fields={[
            { key: 'support_contact', label: 'Контакт поддержки', placeholder: '@f1z_support' },
            { key: 'support_url', label: 'Ссылка на поддержку', placeholder: 'https://t.me/f1z_support' },
            { key: 'channel_url', label: 'Канал / новости', placeholder: 'https://t.me/f1z_news' },
            { key: 'rules_url', label: 'Правила магазина', placeholder: 'https://telegra.ph/…' },
            { key: 'refund_policy', label: 'Правила возвратов', multiline: true, hint: 'Показываются покупателю в Mini App' },
          ]} />
          <SettingsSection title="Гарантия" {...sect} fields={[
            { key: 'guarantee_enabled', label: 'Показывать блок гарантии', hint: 'На странице товара, в каталоге стран и при оформлении заказа' },
            { key: 'guarantee_title', label: 'Заголовок', placeholder: 'Гарантия 14 дней' },
            { key: 'guarantee_days', label: 'Срок, дней' },
            { key: 'guarantee_text', label: 'Условия', multiline: true, hint: 'Например: замена или возврат 80% стоимости после проверки обращения' },
            { key: 'guarantee_categories', label: 'Категории с гарантией', placeholder: 'numbers,accounts', hint: 'Коды категорий через запятую (см. Товары → Категории)' },
          ]} />
          <SettingsSection title="Заказ стран вне каталога" {...sect} fields={[
            { key: 'country_requests_enabled', label: 'Кнопка «Нет нужной страны?» в Mini App', hint: 'Создаёт обращение в поддержку с категорией «Заказ страны вне каталога»; оплата не списывается' },
          ]} />
          {!manage && <p className="text-xs text-muted">У вашей роли нет права менять настройки магазина — они доступны только для просмотра.</p>}
          {canTeam && (
            <Link to="/team" className="card flex items-center gap-3 p-4 transition hover:bg-white/[0.03] sm:p-5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary-soft"><Users className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Команда и права доступа</div>
                <div className="mt-0.5 text-xs text-muted">Сотрудники, роли, одобрения — в разделе «Команда»</div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
            </Link>
          )}
        </>)}
        {tab === 'orders' && (<>
          <SettingsSection title="Ограничения заказов" description="0 — без ограничения." {...sect} fields={[
            { key: 'min_order_total', label: 'Мин. сумма заказа', suffix: 'грн' },
            { key: 'max_order_total', label: 'Макс. сумма заказа', suffix: 'грн' },
            { key: 'max_items_per_user_day', label: 'Покупок одного товара в сутки на пользователя', suffix: 'шт.' },
            { key: 'big_order_threshold', label: 'Крупный заказ от', suffix: 'грн', hint: 'О таких заказах владелец получает отдельное уведомление' },
          ]} />
          <SettingsSection title="Обработка" {...sect} fields={[
            { key: 'auto_complete_digital', label: 'Автоматическая выдача', danger: true,
              hint: 'Глобальный переключатель: товары с режимом выдачи «auto» выдаются сразу после подтверждённой оплаты' },
            { key: 'expire_reservations', label: 'Снимать резерв с неоплаченных заказов', hint: 'По истечении времени на оплату товар возвращается в продажу' },
          ]} />
        </>)}
        {tab === 'payments' && (<>
          <SettingsSection title="Способы оплаты" {...sect} fields={[
            { key: 'stars_enabled', label: 'Telegram Stars', hint: 'Оплата подтверждается Telegram автоматически', danger: true },
            { key: 'manual_enabled', label: 'Ручной перевод на карту', hint: 'Покупатель отмечает оплату, администратор подтверждает в «Финансах»', danger: true },
          ]} />
          <SettingsSection title="Параметры" {...sect} fields={[
            { key: 'uah_per_star', label: 'Курс: грн за 1 Star' },
            { key: 'min_topup', label: 'Мин. пополнение', suffix: 'грн' },
            { key: 'max_topup', label: 'Макс. пополнение', suffix: 'грн' },
            { key: 'manual_payment_details', label: 'Реквизиты для ручной оплаты', multiline: true },
          ]} />
        </>)}
        {tab === 'notify' && (<>
          <SettingsSection title="Кому отправлять" {...sect} fields={[
            { key: 'notify_customers', label: 'Покупателям', hint: 'Сообщения в Telegram о статусе заказа и выдаче' },
            { key: 'notify_staff', label: 'Сотрудникам', hint: 'Владельцу и сотрудникам с привязанным Telegram ID' },
            { key: 'daily_summary', label: 'Ежедневная сводка продаж владельцу' },
          ]} />
          <SettingsSection title="События для сотрудников" {...sect} fields={[
            { key: 'notify_orders', label: 'Новые и оплаченные заказы' },
            { key: 'notify_payments', label: 'Платежи (ручные переводы, Stars)' },
            { key: 'notify_tickets', label: 'Обращения в поддержку' },
          ]} />
          <SettingsSection title="Тихие часы" description="Некритичные уведомления сотрудникам в это время не отправляются (время по Киеву)." {...sect} fields={[
            { key: 'quiet_hours_enabled', label: 'Включить тихие часы' },
            { key: 'quiet_hours_start', label: 'Начало', placeholder: '23:00' },
            { key: 'quiet_hours_end', label: 'Конец', placeholder: '08:00' },
          ]} />
        </>)}
        {tab === 'audit' && <Audit />}
      </div>
    </div>
  )
}

const ENTITY: Record<string, string> = {
  product: 'Товар', order: 'Заказ', payment: 'Платёж', user: 'Пользователь', ticket: 'Обращение', settings: 'Настройки', country: 'Страна',
  category: 'Категория', premium_number: 'Номер', admin_account: 'Сотрудник', role: 'Роль', approval: 'Одобрение', backup: 'Копия',
  admin: 'Вход', users: 'Пользователи', notifications: 'Уведомления',
}
const LIMIT = 100

function Audit() {
  const [entity, setEntity] = useState('')
  const [who, setWho] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const whoQ = useDebounced(who.trim())
  useEffect(() => { setPage(1) }, [entity, whoQ])
  const { data, loading, error, reload } = useApi<AuditRow[]>(`/actions${qs({ limit: LIMIT, page, entity, who: whoQ, date_from: from, date_to: to })}`)
  const exportCsv = async () => {
    setBusy(true)
    try {
      await download(`/actions/export.csv${qs({ entity, who: whoQ, date_from: from, date_to: to })}`, 'audit.csv')
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  return (
    <>
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <Field label="Сотрудник (логин)"><input className="input" autoCapitalize="none" value={who} placeholder="все" onChange={(e) => setWho(e.target.value)} /></Field>
          <Field label="С (для CSV)"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="По (для CSV)"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Btn variant="secondary" className="h-11" loading={busy} onClick={exportCsv}><Download className="h-4 w-4" /> Скачать CSV</Btn>
        </div>
      </Card>
      <Chips value={entity} onChange={setEntity} options={[
        { value: '', label: 'Все' }, { value: 'order', label: 'Заказы' }, { value: 'payment', label: 'Платежи' }, { value: 'product', label: 'Товары' },
        { value: 'user', label: 'Пользователи' }, { value: 'settings', label: 'Настройки' }, { value: 'admin', label: 'Входы' },
        { value: 'admin_account', label: 'Сотрудники' }, { value: 'role', label: 'Роли' }, { value: 'approval', label: 'Одобрения' },
      ]} />
      {error && <ErrorBox text={error} onRetry={() => reload()} />}
      <DataTable rows={data} loading={loading} rowKey={(a) => a.id} emptyText="Действий не найдено"
        columns={[
          { header: 'Когда', cell: (a) => <span className="whitespace-nowrap text-muted">{dt(a.created_at)}</span> },
          { header: 'Кто', cell: (a) => <button type="button" className="font-semibold hover:text-primary-soft" onClick={() => setWho(a.admin)}>{a.admin}</button> },
          { header: 'Действие', cell: (a) => <span>{a.action}</span> },
          { header: 'Объект', cell: (a) => <span>{ENTITY[a.entity] ?? a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</span> },
          { header: 'Детали', cell: (a) => <span className="block max-w-[360px] truncate font-mono text-xs text-muted" title={JSON.stringify(a.details)}>{JSON.stringify(a.details)}</span> },
        ]}
        card={(a) => (
          <div>
            <div className="flex justify-between gap-3 text-sm"><span><b>{a.admin}</b> · {a.action} · {ENTITY[a.entity] ?? a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</span></div>
            <div className="mt-1 text-xs text-muted">{dt(a.created_at)}</div>
            <div className="mt-1 truncate font-mono text-[11px] text-muted">{JSON.stringify(a.details)}</div>
          </div>
        )} />
      {data && (page > 1 || data.length === LIMIT) && (
        <div className="flex items-center justify-end gap-1 text-sm text-muted">
          <IconBtn label="Назад" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-5 w-5" /></IconBtn>
          <span className="tabular min-w-[40px] text-center">{page}</span>
          <IconBtn label="Вперёд" disabled={data.length < LIMIT} onClick={() => setPage(page + 1)}><ChevronRight className="h-5 w-5" /></IconBtn>
        </div>
      )}
    </>
  )
}
