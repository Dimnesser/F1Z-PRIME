import clsx from 'clsx'
import { Boxes, CreditCard, Gem, Globe2, Headphones, LayoutDashboard, LogOut, Menu, Settings, ShoppingCart, Users, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/products', label: 'Products', icon: Boxes },
  { to: '/countries', label: 'Countries', icon: Globe2 },
  { to: '/premium', label: 'Premium Numbers', icon: Gem },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/support', label: 'Support', icon: Headphones },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Layout({ children, admin, onLogout }: { children: ReactNode; admin: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand shadow-glow"><span className="font-display text-[13px] font-extrabold text-white">F1Z</span></div>
        <div className="leading-none">
          <div className="font-display text-[15px] font-bold">F1Z <span className="text-gradient">PRIME</span></div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">admin panel</div>
        </div>
      </div>
      <nav className="mt-8 flex-1 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              clsx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', isActive ? 'bg-brand-soft text-ink ring-1 ring-primary/30' : 'text-muted hover:bg-white/[0.04] hover:text-ink')
            }
          >
            <Icon className="h-[18px] w-[18px]" /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="glass mt-4 flex items-center justify-between rounded-2xl p-3">
        <div>
          <div className="text-[11px] text-muted">Администратор</div>
          <div className="text-sm font-bold">{admin}</div>
        </div>
        <button onClick={onLogout} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06] text-muted hover:text-danger" title="Выйти"><LogOut className="h-4 w-4" /></button>
      </div>
    </div>
  )
  return (
    <div className="relative z-10 flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/[0.06] bg-surface/60 p-4 backdrop-blur-xl lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-white/10 bg-surface p-4">
            <button className="absolute right-3 top-3 text-muted" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/[0.06] bg-bg/80 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06]"><Menu className="h-5 w-5" /></button>
          <span className="font-display font-bold">F1Z <span className="text-gradient">PRIME</span></span>
        </div>
        <div className="mx-auto max-w-7xl p-4 md:p-8">{children}</div>
      </main>
    </div>
  )
}
