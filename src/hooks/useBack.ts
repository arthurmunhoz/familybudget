import { useNavigate } from 'react-router-dom'

/**
 * True back navigation: pops the history entry instead of pushing a new one,
 * so tapping "‹" doesn't grow an endless trail. When the page was opened
 * directly (deep link / fresh PWA launch) there is nothing to pop, so we
 * replace the current entry with the given fallback parent route.
 */
export function useBack() {
  const navigate = useNavigate()
  return (fallback: string) => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }
}
