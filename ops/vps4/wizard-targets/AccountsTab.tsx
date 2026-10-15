import { useState } from 'react'
import { Tabs } from '../ui'
import { AccountSessionsUpload } from './AccountSessionsUpload'
import { SessionWizard } from './SessionWizard'

/** «Аккаунты 2015–2019»: upload ready .session files or create one by phone + code. */
export function AccountsTab({ onSaved }: { onSaved: () => void }) {
  const [mode, setMode] = useState<'create' | 'upload'>('create')
  return (
    <div className="space-y-4">
      <Tabs value={mode} onChange={(value) => setMode(value as 'create' | 'upload')}
        tabs={[{ value: 'create', label: 'Создать по номеру' }, { value: 'upload', label: 'Загрузить .session' }]} />
      {mode === 'create'
        ? <SessionWizard target={{ kind: 'account' }} onSaved={onSaved} />
        : <AccountSessionsUpload onSaved={onSaved} />}
    </div>
  )
}
