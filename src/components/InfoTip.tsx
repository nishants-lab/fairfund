import { useState, useRef, useEffect, useLayoutEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Focus, hover or tap for help. Portal keeps explanations outside clipped tables. */
export default function InfoTip({ children, label = 'More information', width = 250 }: {
  children: ReactNode
  label?: string
  width?: number
  /** @deprecated Position is clamped to the viewport. */
  align?: 'center' | 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const tooltipId = useId()
  const btnRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const contains = (target: EventTarget | null) => target instanceof Node &&
    (!!btnRef.current?.contains(target) || !!tipRef.current?.contains(target))

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!contains(event.target)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const positionTip = () => {
      if (!btnRef.current || !tipRef.current) return
      const button = btnRef.current.getBoundingClientRect()
      const tip = tipRef.current.getBoundingClientRect()
      const margin = 8
      const left = Math.max(margin, Math.min(button.left + button.width / 2 - tip.width / 2, innerWidth - tip.width - margin))
      const below = button.bottom + 6
      const preferred = below + tip.height <= innerHeight - margin ? below : button.top - tip.height - 6
      const top = Math.max(margin, Math.min(preferred, innerHeight - tip.height - margin))
      setPosition({ left, top })
    }
    positionTip()
    window.addEventListener('resize', positionTip)
    window.addEventListener('scroll', positionTip, true)
    return () => {
      window.removeEventListener('resize', positionTip)
      window.removeEventListener('scroll', positionTip, true)
    }
  }, [open, width, children])

  return <span className="inline-flex align-middle">
    <button ref={btnRef} type="button" aria-label={label} aria-expanded={open}
      aria-describedby={open ? tooltipId : undefined}
      className={`relative inline-flex h-4 w-4 items-center justify-center rounded-full border text-xs font-bold leading-none transition focus:outline-none focus:ring-2 focus:ring-brand-300 before:absolute before:-inset-[14px] before:content-[''] ${open ? 'border-brand-400 text-brand-600' : 'border-line text-faint hover:border-brand-400 hover:text-brand-600'}`}
      onFocus={() => setOpen(true)}
      onBlur={event => { if (!contains(event.relatedTarget)) setOpen(false) }}
      onPointerEnter={event => { if (event.pointerType === 'mouse') setOpen(true) }}
      onPointerLeave={event => { if (event.pointerType === 'mouse' && document.activeElement !== btnRef.current && !contains(event.relatedTarget)) setOpen(false) }}
      onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true) }}
    >i</button>
    {open && createPortal(<span ref={tipRef} id={tooltipId} role="tooltip"
      className="fixed z-[100] overflow-y-auto rounded-lg border border-line bg-surface p-2.5 text-left text-xs font-normal normal-case leading-relaxed text-muted shadow-lg"
      style={{ ...position, width: `min(${width}px, calc(100vw - 16px))`, maxHeight: 'calc(100vh - 16px)' }}
      onPointerEnter={event => { if (event.pointerType === 'mouse') setOpen(true) }}
      onPointerLeave={event => { if (event.pointerType === 'mouse' && document.activeElement !== btnRef.current && !contains(event.relatedTarget)) setOpen(false) }}
    >{children}</span>, document.body)}
  </span>
}
