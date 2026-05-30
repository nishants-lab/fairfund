import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchFunds } from '../lib/data'
import RiskBadge from './RiskBadge'
import type { Fund } from '../types'

interface Props {
  placeholder?: string
  autoFocus?: boolean
  onPick?: (fund: Fund) => void
  large?: boolean
}

export default function SearchBox({ placeholder, autoFocus, onPick, large }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Fund[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    setResults(searchFunds(query, 10))
    setActiveIdx(0)
  }, [query])

  // Keep the keyboard-highlighted result scrolled into view in the dropdown.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function pick(fund: Fund) {
    setQuery('')
    setOpen(false)
    if (onPick) onPick(fund)
    else navigate(`/fund/${fund.code}`)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="relative">
        <svg
          className={`absolute left-4 top-1/2 -translate-y-1/2 text-faint ${large ? 'h-6 w-6' : 'h-5 w-5'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
        </svg>
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder ?? 'Search 700+ funds by name, AMC, or category…'}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`w-full rounded-2xl border border-line bg-surface text-fg pl-12 pr-4 shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900 outline-none transition ${
            large ? 'py-4 text-lg' : 'py-3 text-sm'
          }`}
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface shadow-xl" ref={listRef}>
          {results.map((f, i) => (
            <button
              key={f.code}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => pick(f)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition ${
                i === activeIdx ? 'bg-brand-50 dark:bg-brand-900/30' : 'hover:bg-surface2'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-fg">{f.name}</div>
                <div className="text-xs text-faint">{f.amc}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="pill bg-surface2 text-muted">{f.categoryDisplay}</span>
                <RiskBadge level={f.riskLevel} showWord={false} icon={false} />
              </div>
            </button>
          ))}
        </div>
      )}
      {open && query.length >= 2 && results.length === 0 && (
        <div className="absolute z-30 mt-2 w-full rounded-2xl border border-line bg-surface p-4 text-sm text-muted shadow-xl">
          No funds match “{query}”. Try a fund name like “HDFC Flexi” or a category like “small cap”.
        </div>
      )}
    </div>
  )
}
