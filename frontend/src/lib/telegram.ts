// Thin typed wrapper around the official Telegram Mini Apps SDK (telegram-web-app.js)
type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending'

interface TgWebApp {
  initData: string
  initDataUnsafe: {
    user?: { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string }
    start_param?: string
  }
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  ready(): void
  expand(): void
  close(): void
  isVersionAtLeast(v: string): boolean
  setHeaderColor?(c: string): void
  setBackgroundColor?(c: string): void
  setBottomBarColor?(c: string): void
  disableVerticalSwipes?(): void
  openInvoice?(url: string, cb?: (status: InvoiceStatus) => void): void
  openTelegramLink?(url: string): void
  openLink?(url: string): void
  showConfirm?(msg: string, cb: (ok: boolean) => void): void
  HapticFeedback?: {
    impactOccurred(style: HapticStyle): void
    notificationOccurred(type: 'error' | 'success' | 'warning'): void
    selectionChanged(): void
  }
  BackButton?: {
    show(): void
    hide(): void
    onClick(cb: () => void): void
    offClick(cb: () => void): void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp }
  }
}

export const tg: TgWebApp | undefined = window.Telegram?.WebApp

export const isTelegram = Boolean(tg && tg.initData)

export function initTelegram() {
  if (!tg) return
  try {
    tg.ready()
    tg.expand()
    if (tg.isVersionAtLeast('6.1')) {
      tg.setHeaderColor?.('#09090F')
      tg.setBackgroundColor?.('#09090F')
    }
    if (tg.isVersionAtLeast('7.10')) tg.setBottomBarColor?.('#09090F')
    if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes?.()
  } catch {
    /* older clients */
  }
}

export const initData = (): string => tg?.initData ?? ''
export const startParam = (): string | undefined => tg?.initDataUnsafe.start_param

const canHaptic = () => Boolean(tg?.HapticFeedback && tg.isVersionAtLeast('6.1'))

export const haptic = {
  tap: (style: HapticStyle = 'light') => canHaptic() && tg!.HapticFeedback!.impactOccurred(style),
  success: () => canHaptic() && tg!.HapticFeedback!.notificationOccurred('success'),
  error: () => canHaptic() && tg!.HapticFeedback!.notificationOccurred('error'),
  select: () => canHaptic() && tg!.HapticFeedback!.selectionChanged(),
}

export function openInvoice(url: string): Promise<InvoiceStatus> {
  return new Promise((resolve) => {
    if (tg?.openInvoice && tg.isVersionAtLeast('6.1')) {
      tg.openInvoice(url, (status) => resolve(status))
    } else {
      window.open(url, '_blank')
      resolve('pending')
    }
  })
}

export function backButton(onClick: () => void): () => void {
  const bb = tg?.BackButton
  if (!bb || !tg?.isVersionAtLeast('6.1')) return () => {}
  bb.onClick(onClick)
  bb.show()
  return () => {
    bb.offClick(onClick)
    bb.hide()
  }
}
