import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fundSlug } from '../lib/format'
import { searchFunds, searchCategories, data } from '../lib/data'
import type { CategoryResult } from '../lib/data'
import { getCategoryColor } from '../lib/categoryColors'
import type { Fund } from '../types'

interface Props {
  placeholder?: string
  autoFocus?: boolean
  onPick?: (fund: Fund) => void
  large?: boolean
}

// "NNN+" rounded DOWN to the nearest 10 from the live universe size, so this
// auto-updates when funds are added (no hardcoded count to go stale).
const FUND_COUNT_LABEL = `${Math.floor(data.totalFunds / 10) * 10}+`

// Rotating placeholder prompts - each short, each highlighting a real
// differentiator/feature. Shown only when no explicit placeholder is passed
// (so the Compare box keeps its static "Add a fund" prompt). Order is
// randomized per mount and cycles every few seconds as a vertical ticker.
const ROTATING_PROMPTS = [
  `Search ${FUND_COUNT_LABEL} Indian equity funds…`,
  'Try “Parag Parikh Flexi Cap”…',
  'Analyze any fund over any time period…',
  'Is its edge skill or luck? Find out…',
  'See how it held up in the 2020 crash…',
  'Check a fund’s downside protection…',
  'Is this fund running hot right now?…',
  'Compare two funds’ stock overlap…',
  'How consistent is it, really?…',
  'See probability-based outcome ranges…',
  'Rank funds fairly within their category…',
  'Search by AMC, e.g. “HDFC”…',
  'Find the best small-cap funds…',
  'How long has the manager run it?…',
  'Browse international / global funds…',
]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function SearchBox({ placeholder, autoFocus, onPick, large }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Fund[]>([])
  const [catResults, setCatResults] = useState<CategoryResult[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Rotating placeholder ticker (only when caller didn't pin a specific
  // placeholder). One vertical track holds all prompts stacked; it only ever
  // moves UP by exactly one line every few seconds. A cloned first item at the
  // end lets it loop seamlessly: after sliding onto the clone we snap back to 0
  // with the transition disabled (invisible because the clone == item 0).
  const promptsRef = useRef<string[]>(shuffle(ROTATING_PROMPTS))
  const prompts = promptsRef.current
  const [tickIdx, setTickIdx] = useState(0)
  const [snap, setSnap] = useState(false) // true = reposition with no transition
  const rotate = !placeholder
  const LINE = large ? 28 : 20 // px per line; matches overlay height below

  useEffect(() => {
    if (!rotate) return
    const id = setInterval(() => setTickIdx((i) => i + 1), 3500)
    return () => clearInterval(id)
  }, [rotate])

  // Seamless loop: once we've slid onto the cloned first item, wait for the
  // slide to finish, then jump back to index 0 with the transition disabled.
  useEffect(() => {
    if (!rotate) return
    if (tickIdx === prompts.length) {
      const t = setTimeout(() => {
        setSnap(true)
        setTickIdx(0)
      }, 650) // > slide duration (600ms)
      return () => clearTimeout(t)
    }
    if (snap) {
      const r = requestAnimationFrame(() => setSnap(false)) // re-enable transition next frame
      return () => cancelAnimationFrame(r)
    }
  }, [tickIdx, rotate, snap, prompts.length])

  // Only show the ticker overlay when the field is empty (else it'd cover text).
  const showTicker = rotate && query.length === 0

  useEffect(() => {
    setResults(searchFunds(query, 10))
    setCatResults(searchCategories(query))
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
    else navigate(`/fund/${fund.code}/${fundSlug(fund.name)}`)
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
          placeholder={rotate ? '' : placeholder}
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
        {/* Animated placeholder ticker overlay (only when field is empty).
            A single track of stacked lines that only ever moves UP one line per
            tick; a cloned first line at the end makes the loop seamless. */}
        {showTicker && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute left-12 right-4 top-1/2 -translate-y-1/2 overflow-hidden text-faint ${large ? 'h-7 text-lg' : 'h-5 text-sm'}`}
          >
            <div
              className="flex flex-col"
              style={{
                transform: `translateY(-${tickIdx * LINE}px)`,
                transition: snap ? 'none' : 'transform 600ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              {prompts.concat(prompts[0]).map((p, i) => (
                <span
                  key={i}
                  className="flex shrink-0 items-center truncate whitespace-nowrap"
                  style={{ height: LINE }}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {open && (results.length > 0 || catResults.length > 0) && (
        <div className="absolute right-0 z-50 mt-2 max-h-80 min-w-[24rem] w-full overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface shadow-xl" ref={listRef}>
          {catResults.length > 0 && (
            <div className="border-b border-line">
              <div className="px-4 pt-2.5 pb-1 text-xs font-bold uppercase tracking-wider text-faint">Categories</div>
              {catResults.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => {
                    setQuery('')
                    setOpen(false)
                    navigate('/explore?cat=' + encodeURIComponent(cat.key))
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition hover:bg-surface2"
                >
                  <span className="text-sm font-semibold text-fg">{cat.display}</span>
                  <span className="text-xs text-faint">{cat.fundCount} funds</span>
                </button>
              ))}
            </div>
          )}
          {results.length > 0 && catResults.length > 0 && (
            <div className="px-4 pt-2.5 pb-1 text-xs font-bold uppercase tracking-wider text-faint">Funds</div>
          )}
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
              <span className={`pill shrink-0 ${getCategoryColor(f.category).bg} ${getCategoryColor(f.category).text}`}>{f.categoryDisplay}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.length >= 2 && results.length === 0 && catResults.length === 0 && (
        <div className="absolute right-0 z-50 mt-2 min-w-[24rem] w-full rounded-2xl border border-line bg-surface p-4 text-sm text-muted shadow-xl">
          No funds match “{query}”. Try a fund name like “HDFC Flexi” or a category like “small cap”.
        </div>
      )}
    </div>
  )
}
