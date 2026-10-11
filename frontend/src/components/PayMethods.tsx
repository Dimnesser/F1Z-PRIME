import clsx from 'clsx'
import { motion } from 'framer-motion'
import { CreditCard, FlaskConical, Star, Wallet } from 'lucide-react'
import { money } from '../lib/format'
import type { PayMethod } from '../lib/types'

const META: Record<PayMethod, { title: string; icon: typeof Wallet; tint: string }> = {
  balance: { title: 'С баланса', icon: Wallet, tint: 'text-primary-soft bg-primary/15' },
  stars: { title: 'Telegram Stars', icon: Star, tint: 'text-amber-300 bg-amber-400/15' },
  manual: { title: 'Перевод на карту', icon: CreditCard, tint: 'text-secondary bg-secondary/15' },
  test: { title: 'Тестовая оплата', icon: FlaskConical, tint: 'text-warning bg-warning/15' },
}

export function PayMethods({
  methods, total, balance, uahPerStar, loading, onPick, exclude = [], starsTotal = null,
}: {
  methods: PayMethod[]
  total: number
  /** the order's own Stars price (set by the shop); null → older items billed by the rate */
  starsTotal?: number | null
  balance?: number
  uahPerStar: number
  loading: PayMethod | null
  onPick: (m: PayMethod) => void
  exclude?: PayMethod[]
}) {
  const list = methods.filter((m) => !exclude.includes(m))
  return (
    <div className="space-y-2.5">
      {list.map((m, i) => {
        const meta = META[m]
        const Icon = meta.icon
        const notEnough = m === 'balance' && (balance ?? 0) < total
        let hint = ''
        if (m === 'balance') hint = `Доступно ${money(balance ?? 0)}`
        if (m === 'stars') hint = starsTotal ? `К оплате ${starsTotal} ⭐ · счёт в Telegram` : `≈ ${Math.max(1, Math.ceil(total / uahPerStar))} ⭐ · счёт в Telegram`
        if (m === 'balance' && !notEnough) hint = `Спишется ${money(total)} · доступно ${money(balance ?? 0)}`
        if (m === 'manual') hint = `К переводу ${money(total)} · подтверждает администратор`
        if (m === 'test') hint = 'Только DEV_MODE — деньги не списываются'
        return (
          <motion.button
            key={m}
            style={{ animationDelay: `${i * 50}ms` }}
            whileTap={{ scale: 0.98 }}
            disabled={loading !== null || notEnough}
            onClick={() => onPick(m)}
            className={clsx(
              'fade-in flex w-full items-center gap-3.5 rounded-2xl border p-3.5 text-left transition [animation-fill-mode:backwards]',
              m === 'test' ? 'border-dashed border-warning/40 bg-warning/[0.04]' : 'border-white/[0.07] bg-card',
              notEnough && 'opacity-50',
            )}
          >
            <div className={clsx('grid h-11 w-11 place-items-center rounded-xl', meta.tint)}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold">{meta.title}</div>
              <div className={clsx('text-[12.5px]', notEnough ? 'text-danger' : 'text-muted')}>
                {notEnough ? 'Недостаточно средств' : hint}
              </div>
            </div>
            {loading === m ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-white/15" />
            )}
          </motion.button>
        )
      })}
    </div>
  )
}
