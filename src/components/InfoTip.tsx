import { useState, type ReactNode } from 'react'

/**
 * Small accessible "ⓘ" info button with a hover/focus/tap tooltip.
 * Used to explain analytics terms inline without cluttering the UI.
 * Safe inside cards (not inside overflow-clipped tables — use title= there).
 *
 * Hover and click are decoupled: hovering shows the tip transiently; clicking
 * "pins" it open (and clicking again unpins). The tip is visible if either
 * hovered or pinned, so on hover devices a click never paradoxically closes it,
 * and on touch (no hover) a tap still opens it.
 */
export default function InfoTip({
  children,
  label = 'More information',
  width = 250,
  align = 'center',
}: {
  children: ReactNode
  label?: string
  width?: number
  align?: 'center' | 'left' | 'right'
}) {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hovered || pinned
  const pos =
    align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none transition focus:outline-none focus:ring-2 focus:ring-brand-300 ${
          open ? 'border-brand-400 text-brand-600' : 'border-line text-faint hover:border-brand-400 hover:text-brand-600'
        }`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setPinned((p) => !p)
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute top-6 z-50 ${pos} rounded-lg border border-line bg-surface p-2.5 text-left text-xs font-normal normal-case leading-relaxed text-muted shadow-lg`}
          style={{ width }}
        >
          {children}
        </span>
      )}
    </span>
  )
}
