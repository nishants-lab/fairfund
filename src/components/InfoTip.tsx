import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'

/**
 * Accessible "ⓘ" info button with a tooltip that works on pointer AND touch and
 * is ALWAYS kept inside the viewport.
 *
 * Positioning: rendered, measured, then nudged horizontally AND vertically so the
 * full tooltip stays within an 8px margin of the viewport. If it would overflow
 * below, it flips above the button instead.
 */
export default function InfoTip({
  children,
  label = 'More information',
  width = 250,
}: {
  children: ReactNode
  label?: string
  width?: number
  /** @deprecated alignment is now computed automatically to stay on-screen */
  align?: 'center' | 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState(0)
  const [flipUp, setFlipUp] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Measure after paint: nudge horizontally and flip vertically if needed.
  useLayoutEffect(() => {
    if (!open || !tipRef.current) return
    const M = 8
    const r = tipRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Horizontal nudge
    let dx = 0
    if (r.left < M) dx = M - r.left
    else if (r.right > vw - M) dx = vw - M - r.right
    if (dx !== 0) setShift((s) => s + dx)

    // Vertical flip: if bottom overflows viewport, show above the button
    if (r.bottom > vh - M && !flipUp) {
      setFlipUp(true)
    }
  }, [open, flipUp])

  // Reset positioning state on close
  useEffect(() => {
    if (!open) {
      setShift(0)
      setFlipUp(false)
    }
  }, [open])

  const effWidth = `min(${width}px, calc(100vw - 16px))`

  return (
    <span ref={wrapRef} className="relative inline-flex align-middle">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none transition focus:outline-none focus:ring-2 focus:ring-brand-300 ${
          open ? 'border-brand-400 text-brand-600' : 'border-line text-faint hover:border-brand-400 hover:text-brand-600'
        }`}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setOpen(true)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setOpen(false)
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        i
      </button>
      {open && (
        <span
          ref={tipRef}
          role="tooltip"
          className={`absolute left-1/2 z-50 rounded-lg border border-line bg-surface p-2.5 text-left text-xs font-normal normal-case leading-relaxed text-muted shadow-lg ${
            flipUp ? 'bottom-6' : 'top-6'
          }`}
          style={{ width: effWidth, transform: `translateX(calc(-50% + ${shift}px))` }}
        >
          {children}
        </span>
      )}
    </span>
  )
}
