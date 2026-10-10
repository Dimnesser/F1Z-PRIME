/** Telegram Mini App integration for the admin panel (opened from the shop's profile page). */
interface TgWebApp {
  initData: string
  ready(): void
  expand(): void
  isVersionAtLeast(v: string): boolean
  setHeaderColor?(c: string): void
  setBackgroundColor?(c: string): void
  setBottomBarColor?(c: string): void
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium'): void }
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }
}
declare global {
  interface Window { Telegram?: { WebApp?: TgWebApp } }
}

export const tg: TgWebApp | undefined = window.Telegram?.WebApp
/** True when /admin/ runs inside the Telegram Mini App WebView (signed initData is available). */
export const inTelegram = Boolean(tg?.initData)
export const tgInitData = (): string => tg?.initData ?? ''

export function initTelegram(): void {
  if (!tg || !inTelegram) return
  try {
    tg.ready()
    tg.expand()
    if (tg.isVersionAtLeast('6.1')) {
      tg.setHeaderColor?.('#09090F')
      tg.setBackgroundColor?.('#09090F')
    }
    if (tg.isVersionAtLeast('7.10')) tg.setBottomBarColor?.('#101018')
  } catch {
    /* older clients */
  }
}

/** Back to the shop in the same WebView (Telegram keeps initData for same-origin navigation). */
export function backToShop(): void {
  try { tg?.HapticFeedback?.impactOccurred('light') } catch { /* ignore */ }
  window.location.assign('/')
}

/** Telegram's native back button: returns to the shop. */
export function attachTelegramBackButton(): () => void {
  const bb = tg?.BackButton
  if (!inTelegram || !bb || !tg?.isVersionAtLeast('6.1')) return () => {}
  const onClick = () => backToShop()
  bb.onClick(onClick)
  bb.show()
  return () => {
    bb.offClick(onClick)
    bb.hide()
  }
}
