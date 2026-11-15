import { Component, type ReactNode } from 'react'

/** A page that fails to load says so and offers a reload, instead of the whole app going blank. */
export default class PageError extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-error" role="alert">
        <h1 className="text-xl font-semibold text-fg">This page did not load</h1>
        <p className="mt-2 text-sm text-muted">FairFund may have just been updated, or the connection dropped.</p>
        <button onClick={() => location.reload()} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Reload</button>
      </div>
    )
  }
}
