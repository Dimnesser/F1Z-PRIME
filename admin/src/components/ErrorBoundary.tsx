import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Component, type ReactNode } from 'react'

const RELOAD_KEY = 'f1z_admin_chunk_reload'

function isChunkError(error: Error): boolean {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(error.message)
}

/**
 * Keeps one broken page from taking the whole panel down. After a deploy the old page chunks no
 * longer exist, so opening another section fails to load its code — in that case reload once.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (isChunkError(error)) {
      let reloaded = false
      try { reloaded = sessionStorage.getItem(RELOAD_KEY) === '1'; sessionStorage.setItem(RELOAD_KEY, '1') } catch { /* private mode */ }
      if (!reloaded) window.location.reload()
      return
    }
    // eslint-disable-next-line no-console
    console.error(error)
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunk = isChunkError(this.state.error)
    return (
      <div className="card mx-auto mt-10 max-w-md p-6 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-danger/15 text-danger"><AlertTriangle className="h-6 w-6" /></div>
        <h2 className="mt-4 font-display text-lg font-semibold">{chunk ? 'Панель обновилась' : 'Раздел не загрузился'}</h2>
        <p className="mt-1 text-sm text-muted">{chunk ? 'Вышла новая версия админ-панели. Обновите страницу.' : 'Произошла ошибка. Остальные разделы работают — можно перейти в другой или обновить страницу.'}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white">
          <RotateCcw className="h-4 w-4" /> Обновить
        </button>
      </div>
    )
  }
}

export function clearChunkReloadFlag() {
  try { sessionStorage.removeItem(RELOAD_KEY) } catch { /* private mode */ }
}
