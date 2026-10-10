import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/**
 * Loads `path` and reloads when it changes. Stale responses are dropped (fast filter/tab switching
 * can't show old data or update an unmounted page), and previous data stays visible while reloading.
 */
export function useApi<T>(path: string | null, opts: { poll?: number } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async (silent = false) => {
    if (!path) return
    const id = ++seq.current
    if (!silent) setLoading(true)
    try {
      const result = await api<T>(path)
      if (id !== seq.current) return
      setData(result)
      setError(null)
    } catch (e) {
      if (id !== seq.current) return
      setError((e as Error).message)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void load()
    return () => {
      seq.current++ // invalidate in-flight request on path change / unmount
    }
  }, [load])

  useEffect(() => {
    if (!opts.poll || !path) return
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, opts.poll)
    return () => window.clearInterval(t)
  }, [opts.poll, path, load])

  return { data, loading: loading && data === null, refreshing: loading, error, reload: load, setData }
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}
