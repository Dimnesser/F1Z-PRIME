// Sends runtime errors to the server log so device-specific crashes (Telegram WebView) can be diagnosed.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
let sent = 0

export function reportError(kind: string, err: unknown) {
  if (sent >= 5) return
  sent++
  const e = err instanceof Error ? err : new Error(String(err))
  try {
    fetch(`${BASE}/api/client-errors`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        message: (e.message || 'unknown').slice(0, 500),
        stack: (e.stack || '').slice(0, 2000),
        path: location.pathname.slice(0, 200),
        ua: navigator.userAgent.slice(0, 300),
      }),
    }).catch(() => {})
  } catch {
    /* never throw from the reporter */
  }
}

export function installGlobalErrorReporting() {
  window.addEventListener('error', (ev) => reportError('window.error', ev.error ?? ev.message))
  window.addEventListener('unhandledrejection', (ev) => reportError('unhandledrejection', ev.reason))
}
