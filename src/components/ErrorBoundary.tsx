import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { trackError } from '../lib/analytics'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render crashes that would otherwise unmount the whole app and leave
 * a blank page. Reports the error to web_events, then offers a way back.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    trackError(error, {
      source: 'boundary',
      componentStack: info.componentStack?.slice(0, 1000),
    })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-(--surface)">
            <AlertTriangle size={40} aria-hidden="true" className="text-(--accent)" />
          </div>
          <h1 className="font-display mt-4 text-xl font-bold text-(--text)">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-(--text-muted)">
            The error has been reported and we'll look into it. In the
            meantime:
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              onClick={() => {
                window.location.href = '/'
              }}
              className="rounded-xl bg-(--surface) px-5 py-3 font-semibold text-(--text)"
            >
              Go home
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl bg-(--accent) px-5 py-3 font-semibold text-white"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
