import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Last line of defence: stale saved settings must not leave a blank panel. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  componentDidCatch(error: Error): void {
    console.error(error)
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <h2>Wallmaker hit an error</h2>
        <pre className="help">{String(this.state.error?.stack || this.state.error)}</pre>
        <p className="hint">Usually old saved settings. Resetting them fixes it.</p>
        <div className="btns">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              try {
                localStorage.removeItem('wallmaker.config.v1')
              } catch {
                /* ignore */
              }
              location.reload()
            }}
          >
            Reset settings & reload
          </button>
          <button type="button" className="btn" onClick={() => location.reload()}>
            Just reload
          </button>
        </div>
      </div>
    )
  }
}
