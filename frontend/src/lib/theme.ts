import { useSyncExternalStore } from 'react'
import { isTelegram, paintTelegramChrome, tg } from './telegram'

export type ThemePref = 'auto' | 'dark' | 'light'
const KEY = 'f1z_theme'
const BG = { dark: '#080B12', light: '#F3F5FA' } as const

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

let pref: ThemePref = readPref()
const listeners = new Set<() => void>()

/** auto → follows the Telegram client (dark when opened outside Telegram) */
export const resolvedTheme = (): 'dark' | 'light' => (pref === 'auto' ? (isTelegram && tg?.colorScheme === 'light' ? 'light' : 'dark') : pref)

function apply() {
  const t = resolvedTheme()
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BG[t])
  paintTelegramChrome(BG[t])
  listeners.forEach((l) => l())
}

export function initTheme() {
  apply()
  tg?.onEvent?.('themeChanged', () => {
    if (pref === 'auto') apply()
  })
}

export function setThemePref(p: ThemePref) {
  pref = p
  try {
    if (p === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, p)
  } catch {
    /* private mode: keep it for this session only */
  }
  apply()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useTheme() {
  const current = useSyncExternalStore(subscribe, () => pref)
  const resolved = useSyncExternalStore(subscribe, resolvedTheme)
  return { pref: current, resolved, setPref: setThemePref }
}
