import { motion } from 'framer-motion'
import { Plus, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { money } from '../lib/format'
import { useMe } from '../lib/queries'
import { useShop } from '../lib/shop'
import { Avatar } from './Avatar'
import { Logo } from './Logo'
import { Skeleton } from './ui'

function greeting() {
  const h = new Date().getHours()
  if (h < 6) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}

export function TopBar() {
  const { data: me, isLoading } = useMe()
  const { topup } = useShop()
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Logo />
        <Link to="/profile" className="pressable">
          <Avatar me={me} />
        </Link>
      </div>
      <motion.div
        className="fade-in glass relative overflow-hidden rounded-[28px] p-4"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-secondary/15 blur-3xl" />
        <div className="text-[13px] text-muted">{greeting()},</div>
        <div className="font-display text-xl font-bold">
          {isLoading ? <Skeleton className="mt-1 h-6 w-32" /> : `${me?.first_name || me?.username || 'гость'} 👋`}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary-soft ring-1 ring-primary/25">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Баланс</div>
              {isLoading ? <Skeleton className="mt-1 h-6 w-24" /> : <div className="font-display text-[22px] font-bold leading-tight">{money(me?.balance ?? 0)}</div>}
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={topup}
            className="flex items-center gap-1.5 rounded-2xl bg-brand px-4 py-2.5 text-[13.5px] font-bold text-white shadow-glow"
          >
            <Plus className="h-4 w-4" strokeWidth={3} /> Пополнить
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}
