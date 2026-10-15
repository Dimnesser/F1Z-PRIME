import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Field } from '../ui'
import { SessionWizard } from './SessionWizard'

/** New premium number: fill price / level, then sign in by code — the number is added to the premium base with its session. */
export function PremiumNewNumber({ onSaved }: { onSaved: () => void }) {
  const [price, setPrice] = useState('')
  const [tier, setTier] = useState('premium')
  const [title, setTitle] = useState('PREMIUM NUMBER')
  const [mask, setMask] = useState('')
  const [hidden, setHidden] = useState(false)
  const premium = {
    price: price.replace(',', '.').trim(), tier, title: title.trim() || 'PREMIUM NUMBER',
    display_mask: mask.trim() || null, description: '', status: hidden ? 'hidden' : 'available',
  }
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold"><Plus className="h-4 w-4" /> Новый номер в базу красивых номеров</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Цена, грн"><input className="input tabular" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="500" /></Field>
          <Field label="Уровень">
            <select className="input" value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="premium">Premium</option><option value="gold">Gold</option><option value="platinum">Platinum</option><option value="vip">VIP</option>
            </select>
          </Field>
          <Field label="Заголовок"><input className="input" maxLength={64} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Маска (необязательно)" hint="Пусто — сгенерируется автоматически"><input className="input font-mono" maxLength={64} value={mask} onChange={(e) => setMask(e.target.value)} placeholder="+380 ** 777 77 **" /></Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Добавить скрытым (не показывать в магазине)
        </label>
      </div>
      <SessionWizard target={{ kind: 'premium_new', premium }} onSaved={onSaved} />
    </div>
  )
}
