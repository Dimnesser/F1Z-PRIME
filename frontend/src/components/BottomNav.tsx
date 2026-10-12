import clsx from 'clsx'
import { House, LayoutGrid, ReceiptText, User, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { haptic } from '../lib/telegram'

const ITEMS = [
  { to: '/', label: 'Главная', icon: House, match: (p: string) => p === '/' },
  { to: '/catalog', label: 'Каталог', icon: LayoutGrid, match: (p: string) => /^\/(catalog|product|number|numbers|sms)/.test(p) },
  { to: '/orders', label: 'Заказы', icon: ReceiptText, match: (p: string) => p.startsWith('/orders') },
  { to: '/balance', label: 'Баланс', icon: Wallet, match: (p: string) => p.startsWith('/balance') },
  { to: '/profile', label: 'Профиль', icon: User, match: (p: string) => /^\/(profile|support)/.test(p) },
]

/** true while the on-screen keyboard covers a noticeable part of the viewport */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const base = window.innerHeight
    const onResize = () => {
      const focused = document.activeElement
      const typing = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
      setOpen(typing && vv.height < base * 0.75)
    }
    vv.addEventListener('resize', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
    }
  }, [])
  return open
}

export function BottomNav() {
  const { pathname } = useLocation()
  const keyboard = useKeyboardOpen()
  return (
    <nav
      aria-label="Основная навигация"
      className={clsx('fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 transition-transform duration-200', keyboard && 'translate-y-[150%]')}
      style={{ paddingBottom: 'calc(var(--safe-bottom) + 8px)' }}
    >
      <div className="flex h-[var(--nav-h)] w-full max-w-md items-stretch rounded-[22px] border border-line/80 bg-surface/90 p-1 shadow-pop backdrop-blur-xl">
        {ITEMS.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname)
          return (
            <NavLink
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              onClick={() => haptic.select()}
              className="group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[18px]"
            >
              <span
                className={clsx(
                  'grid h-7 w-12 place-items-center rounded-full transition-all duration-200',
                  active ? 'bg-primary/15 text-primary-soft' : 'text-muted group-active:scale-90',
                )}
              >
                <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.3 : 1.9} />
              </span>
              <span className={clsx('max-w-full truncate px-0.5 text-[10.5px] font-semibold leading-none transition-colors', active ? 'text-ink' : 'text-muted')}>{label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
