import { createContext, useContext, useState, type ReactNode } from 'react'
import { CheckoutSheet, type CheckoutItem } from '../components/CheckoutSheet'
import { TopupSheet } from '../components/TopupSheet'

interface ShopCtx {
  checkout: (item: CheckoutItem) => void
  topup: () => void
}

const Ctx = createContext<ShopCtx>({ checkout: () => {}, topup: () => {} })
export const useShop = () => useContext(Ctx)

export function ShopProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<CheckoutItem | null>(null)
  const [topupOpen, setTopupOpen] = useState(false)
  return (
    <Ctx.Provider value={{ checkout: setItem, topup: () => setTopupOpen(true) }}>
      {children}
      <CheckoutSheet item={item} onClose={() => setItem(null)} />
      <TopupSheet open={topupOpen} onClose={() => setTopupOpen(false)} />
    </Ctx.Provider>
  )
}
