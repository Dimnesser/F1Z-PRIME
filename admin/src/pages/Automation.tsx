import { Archive, Bell, Download, RefreshCw, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { SettingsSection, useSettings } from '../components/SettingsForm'
import { Badge, Btn, Card, ErrorBox, KV, PageHead, Skeleton, useToast } from '../components/ui'
import { ago, api, download, dt, errMsg } from '../lib/api'
import { useMe } from '../lib/session'
import { useApi } from '../lib/useApi'

interface Status {
  maintenance: boolean; notifications: { pending: number; failed: number; sent: number }
  errors: { total: number; last_24h: number; server_24h: number; client_24h: number }
  backups: { count: number; last: { name: string; size: number; created_at: string } | null }
  admin_notify_ids: number; bot_configured: boolean
}
interface ErrorRow { at: string; source: string; message: string; path: string; detail: string }
interface Backup { name: string; size: number; created_at: string }

export default function Automation() {
  const me = useMe()
  const owner = me.role === 'owner'
  const { rows, setRows, error } = useSettings()
  const status = useApi<Status>('/system/status', { poll: 30_000 })
  const errors = useApi<ErrorRow[]>('/system/errors?limit=20')
  const backups = useApi<Backup[]>(owner ? '/system/backups' : null)
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const s = status.data

  const retry = async () => {
    setBusy('retry')
    try {
      const r = await api<{ sent: number; failed: number }>('/system/notifications/retry', { method: 'POST' })
      toast(`Отправлено: ${r.sent}${r.failed ? `, не удалось: ${r.failed}` : ''}`)
      status.reload(true)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy('') }
  }
  const backupNow = async () => {
    setBusy('backup')
    try {
      await api('/system/backups', { method: 'POST' })
      toast('Резервная копия создана')
      backups.reload(true)
      status.reload(true)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy('') }
  }

  return (
    <div className="fade-in space-y-4">
      <PageHead title="Автоматизация" subtitle="Каждый переключатель сразу меняет поведение сервера" />
      {error && <ErrorBox text={error} />}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {!s ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />) : (<>
          <KV label="Режим магазина">{s.maintenance ? <Badge tone="amber" dot>Техобслуживание</Badge> : <Badge tone="green" dot>Работает</Badge>}</KV>
          <KV label="Уведомления в очереди">{s.notifications.pending} <span className="text-muted">/ ошибок {s.notifications.failed}</span></KV>
          <KV label="Ошибки за 24 ч">{s.errors.last_24h} <span className="text-muted">(сервер {s.errors.server_24h})</span></KV>
          <KV label="Последняя копия">{s.backups.last ? ago(s.backups.last.created_at) : 'ещё нет'}</KV>
        </>)}
      </div>
      {s && !s.bot_configured && <ErrorBox text="BOT_TOKEN не настроен — уведомления в Telegram не отправляются." />}

      <SettingsSection title="Режим технического обслуживания" rows={rows} onSaved={setRows}
        description="Покупатели смогут просматривать каталог, но покупки и пополнения будут временно отключены (в Mini App и в боте)."
        fields={[
          { key: 'maintenance_mode', label: 'Технический режим', hint: 'Включайте на время работ с товарами или оплатой', danger: true },
          { key: 'maintenance_message', label: 'Сообщение для покупателей', multiline: true },
        ]} />

      <SettingsSection title="Заказы и склад" rows={rows} onSaved={setRows} fields={[
        { key: 'auto_complete_digital', label: 'Автозавершение цифровых товаров', hint: 'Оплаченный заказ из категории «digital» с заполненной инструкцией сразу выдаётся покупателю' },
        { key: 'expire_reservations', label: 'Очистка просроченных резервов', hint: 'Неоплаченные заказы отменяются по таймеру, товар возвращается в продажу' },
        { key: 'low_stock_alerts', label: 'Уведомления о низких остатках', hint: 'Сообщение администраторам в Telegram, когда остаток опускается до порога' },
        { key: 'low_stock_threshold', label: 'Порог низкого остатка', suffix: 'шт' },
      ]} />

      <SettingsSection title="Надёжность" rows={rows} onSaved={setRows} fields={[
        { key: 'notification_retry', label: 'Повторная отправка уведомлений', hint: 'Недоставленные сообщения Telegram повторяются с паузой до 6 раз' },
        { key: 'auto_backup', label: 'Ежедневное резервное копирование', hint: 'Копия всех данных раз в сутки, хранятся последние 14' },
        { key: 'error_monitoring', label: 'Мониторинг ошибок', hint: 'Сообщать администраторам об ошибках сервера и Mini App (не чаще раза в 10 минут)' },
      ]} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Недоставленные уведомления" action={<Btn size="sm" variant="secondary" loading={busy === 'retry'} onClick={retry}><RefreshCw className="h-3.5 w-3.5" /> Отправить сейчас</Btn>}>
          {!s ? <Skeleton className="h-16" /> : (
            <div className="flex items-center gap-3 text-sm">
              <Bell className="h-5 w-5 text-muted" />
              <span>В очереди: <b>{s.notifications.pending}</b> · окончательно не доставлено: <b>{s.notifications.failed}</b> · доставлено повторно: <b>{s.notifications.sent}</b></span>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">«Не доставлено» — пользователь заблокировал бота или удалил чат; такие сообщения не повторяются.</p>
        </Card>
        {owner && (
          <Card title="Резервные копии" action={<Btn size="sm" loading={busy === 'backup'} onClick={backupNow}><Archive className="h-3.5 w-3.5" /> Создать</Btn>}>
            {!backups.data ? <Skeleton className="h-20" /> : backups.data.length === 0 ? <div className="text-sm text-muted">Копий пока нет</div> : (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {backups.data.map((b) => (
                  <div key={b.name} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.03]">
                    <span className="min-w-0"><span className="block truncate font-mono text-xs">{b.name}</span><span className="text-xs text-muted">{dt(b.created_at)} · {(b.size / 1024).toFixed(0)} КБ</span></span>
                    <Btn size="sm" variant="ghost" onClick={() => download(`/system/backups/${b.name}`, b.name).catch((e) => toast(errMsg(e), 'error'))}><Download className="h-4 w-4" /></Btn>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <Card title="Журнал ошибок" action={<Btn size="sm" variant="ghost" onClick={() => errors.reload(true)}><RefreshCw className="h-3.5 w-3.5" /></Btn>}>
        {!errors.data ? <Skeleton className="h-20" /> : errors.data.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted"><ShieldAlert className="h-4 w-4 text-success" /> Ошибок с последнего перезапуска сервера нет</div>
        ) : (
          <div className="space-y-1.5">
            {errors.data.map((e, i) => (
              <details key={i} className="rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                <summary className="flex cursor-pointer list-none items-center gap-2">
                  <Badge tone={e.source === 'server' ? 'red' : 'amber'}>{e.source === 'server' ? 'Сервер' : 'Mini App'}</Badge>
                  <span className="min-w-0 flex-1 truncate">{e.message}</span>
                  <span className="shrink-0 text-xs text-muted">{ago(e.at)}</span>
                </summary>
                <div className="mt-2 break-words font-mono text-[11px] text-muted">{e.path}{e.detail ? `\n${e.detail}` : ''}</div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
