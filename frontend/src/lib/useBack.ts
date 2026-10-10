import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { backButton } from './telegram'

/** Shows Telegram's native BackButton on nested pages. */
export function useBack(fallback = '/') {
  const navigate = useNavigate()
  useEffect(() => backButton(() => (window.history.length > 1 ? navigate(-1) : navigate(fallback))), [navigate, fallback])
}
