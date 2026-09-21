import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ToastVariant = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastApi {
  /** Show a transient toast. Defaults to a success (green) toast. */
  toast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** Access the toast dispatcher. Must be inside <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

const AUTO_DISMISS_MS = 2800
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = nextId++
      setItems((cur) => [...cur, { id, message, variant }])
      window.setTimeout(() => remove(id), AUTO_DISMISS_MS)
    },
    [remove],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="toast-stack" role="status" aria-live="polite">
          {items.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`toast toast--${t.variant}`}
              onClick={() => remove(t.id)}
              aria-label="Dismiss notification"
            >
              <ToastIcon variant={t.variant} />
              <span>{t.message}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function ToastIcon({ variant }: { variant: ToastVariant }) {
  const common = 'h-4 w-4 shrink-0'
  if (variant === 'error') {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  }
  if (variant === 'info') {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  return (
    <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}
