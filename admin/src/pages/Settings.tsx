import { KeyRound, Plus, ShieldCheck, UserX } from 'lucide-react'
import { useState } from 'react'
import { SettingsSection, useSettings } from '../components/SettingsForm'
import { Badge, Btn, Card, Chips, DataTable, ErrorBox, Field, Modal, PageHead, Tabs, useConfirm, useToast, type Tone } from '../components/ui'
import { ago, api, dt, errMsg } from '../lib/api'
import { useMe } from '../lib/session'
import type { Account, AuditRow, Role } from '../lib/types'
import { useApi } from '../lib/useApi'

type Tab = 'store' | 'payments' | 'notify' | 'team' | 'audit'
const ROLE: Record<Role, { label: string; tone: Tone; text: string }> = {
  owner: { label: 'Владелец', tone: 'violet', text: 'Полный доступ, управление командой и резервными копиями' },
  admin: { label: 'Администратор', tone: 'cyan', text: 'Товары, заказы, платежи, настройки' },
  support: { label: 'Поддержка', tone: 'gray', text: 'Обращения; заказы и пользователи — только просмотр' },
}

export default function Settings() {
  const me = useMe()
  const manage = me.role !== 'support'
  const [tab, setTab] = useState<Tab>('store')
  const { rows, setRows, error } = useSettings()
  const tabs: { value: Tab; label: string }[] = [
    { value: 'store', label: 'Магазин' },
    ...(manage ? [{ value: 'payments' as Tab, label: 'Оплата' }, { value: 'notify' as Tab, label: 'Уведомления' }] : []),
    ...(me.role === 'owner' ? [{ value: 'team' as Tab, label: 'Команда' }] : []),
    ...(manage ? [{ value: 'audit' as Tab, label: 'Журнал действий' }] : []),
  ]
  return (
    <div className="fade-in">
      <PageHead title="Настройки" subtitle="Изменения отображаются в Mini App сразу, без правки кода" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {error && <ErrorBox text={error} />}
      <div className="space-y-4">
        {tab === 'store' && (<>
          <SettingsSection title="Профиль магазина" rows={rows} onSaved={setRows} readOnly={!manage} fields={[
            { key: 'shop_name', label: 'Название магазина' },
            { key: 'currency', label: 'Валюта отображения' },
            { key: 'shop_description', label: 'Описание', multiline: true, placeholder: 'Пара предложений о магазине — показывается на главной Mini App' },
          ]} />
          <SettingsSection title="Баннер на главной" rows={rows} onSaved={setRows} readOnly={!manage} fields={[
            { key: 'banner_title', label: 'Заголовок' },
            { key: 'banner_image_url', label: 'Изображение (URL)', placeholder: 'https://…/banner.jpg', hint: 'Необязательно. Рекомендуемый размер 1200×600.' },
            { key: 'banner_subtitle', label: 'Подзаголовок', multiline: true },
          ]} />
          <SettingsSection title="Контакты и ссылки" rows={rows} onSaved={setRows} readOnly={!manage} fields={[
            { key: 'support_contact', label: 'Контакт поддержки', placeholder: '@f1z_support' },
            { key: 'support_url', label: 'Ссылка на поддержку', placeholder: 'https://t.me/f1z_support' },
            { key: 'channel_url', label: 'Канал / новости', placeholder: 'https://t.me/f1z_news' },
            { key: 'rules_url', label: 'Правила магазина', placeholder: 'https://telegra.ph/…' },
          ]} />
          {!manage && <p className="text-xs text-muted">Роль «Поддержка» может только просматривать настройки.</p>}
        </>)}
        {tab === 'payments' && (<>
          <SettingsSection title="Способы оплаты" rows={rows} onSaved={setRows} fields={[
            { key: 'stars_enabled', label: 'Telegram Stars', hint: 'Оплата подтверждается Telegram автоматически', danger: true },
            { key: 'manual_enabled', label: 'Ручной перевод на карту', hint: 'Покупатель отмечает оплату, администратор подтверждает в «Финансах»', danger: true },
          ]} />
          <SettingsSection title="Параметры" rows={rows} onSaved={setRows} fields={[
            { key: 'uah_per_star', label: 'Курс: грн за 1 Star' },
            { key: 'min_topup', label: 'Мин. пополнение', suffix: 'грн' },
            { key: 'max_topup', label: 'Макс. пополнение', suffix: 'грн' },
            { key: 'manual_payment_details', label: 'Реквизиты для ручной оплаты', multiline: true },
          ]} />
        </>)}
        {tab === 'notify' && (
          <SettingsSection title="Уведомления администраторам в Telegram" rows={rows} onSaved={setRows}
            description="Получатели — владелец и ID из ADMIN_TELEGRAM_IDS на сервере." fields={[
              { key: 'notify_orders', label: 'Новые и оплаченные заказы' },
              { key: 'notify_payments', label: 'Платежи (ручные переводы, Stars)' },
              { key: 'notify_tickets', label: 'Обращения в поддержку' },
            ]} />
        )}
        {tab === 'team' && <Team />}
        {tab === 'audit' && <Audit />}
      </div>
    </div>
  )
}

function Team() {
  const me = useMe()
  const { data, loading, error, reload } = useApi<Account[]>('/accounts')
  const [form, setForm] = useState<{ username: string; password: string; role: 'admin' | 'support' } | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const create = async () => {
    if (!form) return
    setBusy(true)
    try {
      await api('/accounts', { method: 'POST', body: form })
      toast('Учётная запись создана')
      setForm(null)
      reload(true)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const patch = async (a: Account, body: Record<string, unknown>, msg: string) => {
    try { await api(`/accounts/${a.id}`, { method: 'PATCH', body }); toast(msg); reload(true) } catch (e) { toast(errMsg(e), 'error') }
  }
  const resetPassword = async (a: Account) => {
    const pwd = await confirm({ title: `Новый пароль для ${a.username}`, input: { label: 'Пароль (от 10 символов)', required: true }, confirmLabel: 'Сменить' })
    if (pwd === false) return
    if (pwd.length < 10) { toast('Пароль должен быть не короче 10 символов', 'error'); return }
    await patch(a, { password: pwd }, 'Пароль изменён')
  }
  const toggleActive = async (a: Account) => {
    if (a.is_active && await confirm({ title: `Отключить ${a.username}?`, text: 'Все сессии этого сотрудника завершатся сразу.', danger: true, confirmLabel: 'Отключить' }) === false) return
    await patch(a, { is_active: !a.is_active }, a.is_active ? 'Доступ отключён' : 'Доступ включён')
  }
  return (
    <>
      <Card title="Роли">
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(ROLE) as Role[]).map((r) => (
            <div key={r} className="rounded-xl bg-white/[0.03] p-3"><Badge tone={ROLE[r].tone}>{ROLE[r].label}</Badge><p className="mt-2 text-xs text-muted">{ROLE[r].text}</p></div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Владелец — учётная запись <b className="text-ink">{me.username}</b> из настроек сервера (.env). Её пароль меняется только на сервере.</p>
      </Card>
      <div className="flex justify-end"><Btn onClick={() => setForm({ username: '', password: '', role: 'support' })}><Plus className="h-4 w-4" /> Сотрудник</Btn></div>
      {error && <ErrorBox text={error} />}
      <DataTable rows={data} loading={loading} rowKey={(a) => a.id} emptyText="Сотрудников пока нет"
        columns={[
          { header: 'Логин', cell: (a) => <span className="font-semibold">{a.username}</span> },
          { header: 'Роль', cell: (a) => (
            <select className="h-8 rounded-lg border border-white/[0.08] bg-surface px-2 text-sm outline-none" value={a.role} onChange={(e) => patch(a, { role: e.target.value }, 'Роль изменена')}>
              <option value="admin">Администратор</option><option value="support">Поддержка</option>
            </select>
          ) },
          { header: 'Статус', cell: (a) => a.is_active ? <Badge tone="green" dot>Активен</Badge> : <Badge tone="gray" dot>Отключён</Badge> },
          { header: 'Последний вход', cell: (a) => <span className="text-muted">{ago(a.last_login_at)}</span> },
          { header: 'Создан', cell: (a) => <span className="text-muted">{dt(a.created_at)}</span> },
          { header: '', align: 'right', cell: (a) => (
            <div className="flex justify-end gap-1">
              <Btn size="sm" variant="ghost" onClick={() => resetPassword(a)}><KeyRound className="h-4 w-4" /></Btn>
              <Btn size="sm" variant={a.is_active ? 'danger' : 'success'} onClick={() => toggleActive(a)}>{a.is_active ? <UserX className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</Btn>
            </div>
          ) },
        ]}
        card={(a) => (
          <div>
            <div className="flex items-center justify-between gap-3">
              <div><div className="font-semibold">{a.username}</div><div className="text-xs text-muted">вход {ago(a.last_login_at)}</div></div>
              <Badge tone={ROLE[a.role].tone}>{ROLE[a.role].label}</Badge>
            </div>
            <div className="mt-3 flex gap-2">
              <Btn size="sm" variant="secondary" onClick={() => patch(a, { role: a.role === 'admin' ? 'support' : 'admin' }, 'Роль изменена')}>{a.role === 'admin' ? '→ Поддержка' : '→ Администратор'}</Btn>
              <Btn size="sm" variant="secondary" onClick={() => resetPassword(a)}><KeyRound className="h-4 w-4" /></Btn>
              <Btn size="sm" variant={a.is_active ? 'danger' : 'success'} onClick={() => toggleActive(a)}>{a.is_active ? 'Отключить' : 'Включить'}</Btn>
            </div>
          </div>
        )} />
      <Modal open={form !== null} onClose={() => setForm(null)} title="Новый сотрудник"
        footer={<><Btn variant="secondary" onClick={() => setForm(null)}>Отмена</Btn><Btn loading={busy} disabled={!form || form.username.length < 3 || form.password.length < 10} onClick={create}>Создать</Btn></>}>
        {form && (
          <div className="space-y-4">
            <Field label="Логин" hint="Латиница, цифры, точка, дефис"><input className="input" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/[^A-Za-z0-9_.-]/g, '') })} /></Field>
            <Field label="Пароль" hint="Не короче 10 символов. Передайте сотруднику лично."><input className="input" type="text" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Роль">
              <Chips value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={[{ value: 'support', label: 'Поддержка' }, { value: 'admin', label: 'Администратор' }]} />
            </Field>
            <p className="text-xs text-muted">{ROLE[form.role].text}</p>
          </div>
        )}
      </Modal>
    </>
  )
}

const ENTITY: Record<string, string> = {
  product: 'Товар', order: 'Заказ', payment: 'Платёж', user: 'Пользователь', ticket: 'Обращение', settings: 'Настройки', country: 'Страна',
  category: 'Категория', premium_number: 'Номер', admin_account: 'Сотрудник', backup: 'Копия', admin: 'Вход', users: 'Пользователи', notifications: 'Уведомления',
}
function Audit() {
  const [entity, setEntity] = useState('')
  const { data, loading, error } = useApi<AuditRow[]>(`/actions?limit=200${entity ? `&entity=${entity}` : ''}`)
  return (
    <>
      <Chips className="mb-4" value={entity} onChange={setEntity} options={[
        { value: '', label: 'Все' }, { value: 'order', label: 'Заказы' }, { value: 'payment', label: 'Платежи' }, { value: 'product', label: 'Товары' },
        { value: 'user', label: 'Пользователи' }, { value: 'settings', label: 'Настройки' }, { value: 'admin', label: 'Входы' }, { value: 'admin_account', label: 'Команда' },
      ]} />
      {error && <ErrorBox text={error} />}
      <DataTable rows={data} loading={loading} rowKey={(a) => a.id} emptyText="Действий пока нет"
        columns={[
          { header: 'Когда', cell: (a) => <span className="whitespace-nowrap text-muted">{dt(a.created_at)}</span> },
          { header: 'Кто', cell: (a) => <span className="font-semibold">{a.admin}</span> },
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
    </>
  )
}
