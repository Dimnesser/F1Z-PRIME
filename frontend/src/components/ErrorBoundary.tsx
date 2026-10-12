import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '../lib/errors'

interface State { error: Error | null }

/** Instead of a blank screen, show a recoverable error page and report the error to the server. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const withStack = new Error(error.message)
    withStack.stack = `${error.stack ?? ''}\ncomponent:${info.componentStack ?? ''}`
    reportError('react', withStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="relative z-10 mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-[22px] bg-danger/12 text-3xl text-danger">!</div>
        <h1 className="mt-4 text-xl font-bold tracking-tight">Что-то пошло не так</h1>
        <p className="mt-2 text-sm text-muted">Мы уже получили отчёт об ошибке. Попробуйте открыть страницу заново.</p>
        <button
          onClick={() => { window.location.href = '/' }}
          type="button"
          className="mt-6 h-12 rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-ink shadow-glow"
        >
          Перезагрузить
        </button>
      </div>
    )
  }
}
