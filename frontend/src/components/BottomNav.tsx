import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Gem, Home, Package, ShoppingBag, User } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { haptic } from '../lib/telegram'

const ITEMS = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/catalog', label: 'Каталог', icon: ShoppingBag },
  { to: '/numbers', label: 'Номера', icon: Gem },
  { to: '/orders', label: 'Покупки', icon: Package },
  { to: '/profile', label: 'Профиль', icon: User },
]

export function BottomNav() {
  const { pathname } = useLocation()
  const active = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 10px)' }}>
      <div className="glass flex w-full max-w-md items-center justify-between rounded-[26px] bg-surface/75 p-1.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]">
        {ITEMS.map(({ to, label, icon: Icon }) => {
          const isActive = active(to)
          return (
            <NavLink
              key={to}
              to={to}
              onClick={() => haptic.select()}
              className="relative flex h-[58px] flex-1 flex-col items-center justify-center gap-1"
            >
              {isActive && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-[20px] bg-brand-soft ring-1 ring-primary/30"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}
              <Icon className={clsx('relative h-[21px] w-[21px] transition-colors', isActive ? 'text-primary-soft' : 'text-muted')} strokeWidth={isActive ? 2.4 : 2} />
              <span className={clsx('relative text-[10.5px] font-semibold transition-colors', isActive ? 'text-ink' : 'text-muted')}>{label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
