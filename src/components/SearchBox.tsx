import { useState, useRef, useEffect, useId, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { fundSlug } from '../lib/format'
import { searchFunds, searchCategories } from '../lib/data'
import type { CategoryResult } from '../lib/data'
import { getCategoryColor } from '../lib/categoryColors'
import { parseIntent } from '../lib/intentParser'
import type { Intent } from '../lib/intentParser'
import type { Fund } from '../types'

interface Props {
  placeholder?: string
  autoFocus?: boolean
  onPick?: (fund: Fund) => void
  large?: boolean
  inputId?: string
  label?: string
}

const DEFAULT_PLACEHOLDER = 'Fund name, AMC or category'
const DEFAULT_LABEL = 'Search funds'

// One flat list of choices in the exact order they are rendered, so keyboard
// navigation and the visible highlight can never drift apart.
type Option =
  | { kind: 'intent'; intent: Intent }
  | { kind: 'category'; cat: CategoryResult }
  | { kind: 'fund'; fund: Fund }

function Heading({ children }: { children: string }) {
  return (
    <div role="presentation" className="px-4 pt-2.5 pb-1 text-xs font-bold uppercase tracking-wider text-faint">
      {children}
    </div>
  )
}

export default function SearchBox({ placeholder, autoFocus, onPick, large, inputId, label }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Fund[]>([])
  const [catResults, setCatResults] = useState<CategoryResult[]>([])
  const [intent, setIntent] = useState<Intent | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const reactId = useId()
  const fieldId = inputId ?? `fund-search-${reactId}`
  const listboxId = `${fieldId}-listbox`
  const optionId = (i: number) => `${fieldId}-option-${i}`

  const options = useMemo<Option[]>(() => {
    const list: Option[] = []
    if (intent) list.push({ kind: 'intent', intent })
    for (const cat of catResults) list.push({ kind: 'category', cat })
    for (const fund of results) list.push({ kind: 'fund', fund })
    return list
  }, [intent, catResults, results])

  useEffect(() => {
    setResults(searchFunds(query, 10))
    setCatResults(searchCategories(query))
    setIntent(parseIntent(query))
    setActiveIdx(0)
  }, [query])

  // Keep the keyboard-highlighted choice scrolled into view in the dropdown.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, options])

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

  function choose(opt: Option) {
    if (opt.kind === 'fund') {
      pick(opt.fund)
      return
    }
    setQuery('')
    setOpen(false)
    navigate(opt.kind === 'intent' ? opt.intent.path : '/explore?cat=' + encodeURIComponent(opt.cat.key))
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open && options.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActiveIdx(e.key === 'ArrowDown' ? 0 : options.length - 1)
      return
    }
    if (!open || options.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = options[activeIdx]
      if (opt) choose(opt)
    }
  }

  const listOpen = open && options.length > 0
  const noMatch = open && query.length >= 2 && options.length === 0
  // Mobile must not be forced wider than the viewport, so the dropdown is 100%
  // of the field and only widens from the sm breakpoint up.
  const panelWidth = 'w-full sm:min-w-[24rem]'
  // Index of the first fund option, used for the optional "Funds" heading.
  const fundStart = (intent ? 1 : 0) + catResults.length

  function optionClass(idx: number, extra = '') {
    return `flex w-full items-center gap-3 px-4 text-left transition ${extra} ${
      idx === activeIdx ? 'bg-brand-50 dark:bg-brand-900/30' : 'hover:bg-surface2'
    }`
  }

  return (
    <div ref={boxRef} className="relative w-full" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
      <div className="relative">
        <svg
          className={`absolute left-4 top-1/2 -translate-y-1/2 text-faint ${large ? 'h-6 w-6' : 'h-5 w-5'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
        </svg>
        <input
          id={fieldId}
          type="text"
          role="combobox"
          aria-label={label ?? DEFAULT_LABEL}
          aria-expanded={listOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={listOpen ? optionId(activeIdx) : undefined}
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder ?? DEFAULT_PLACEHOLDER}
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

      <div
        id={listboxId}
        role="listbox"
        aria-label={label ?? DEFAULT_LABEL}
        ref={listRef}
        hidden={!listOpen}
        className={`absolute right-0 z-50 mt-2 max-h-80 ${panelWidth} overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface shadow-xl`}
      >
        {options.map((opt, idx) => {
          const selected = idx === activeIdx
          const common = {
            id: optionId(idx),
            role: 'option' as const,
            'aria-selected': selected,
            'data-idx': idx,
            tabIndex: -1,
            onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
            onMouseEnter: () => setActiveIdx(idx),
            onClick: () => choose(opt),
          }
          if (opt.kind === 'intent') {
            return (
              <button key="intent" {...common} className={optionClass(idx, 'py-3 border-b border-line')}>
                <svg className="h-5 w-5 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span className="text-sm font-semibold text-fg">{opt.intent.label}</span>
              </button>
            )
          }
          if (opt.kind === 'category') {
            return (
              <Fragment key={`cat-${opt.cat.key}`}>
                {idx === (intent ? 1 : 0) && <Heading>Categories</Heading>}
                <button {...common} className={optionClass(idx, 'justify-between py-2')}>
                  <span className="text-sm font-semibold text-fg">{opt.cat.display}</span>
                  <span className="text-xs text-faint">{opt.cat.fundCount} funds</span>
                </button>
              </Fragment>
            )
          }
          return (
            <Fragment key={`fund-${opt.fund.code}`}>
              {idx === fundStart && catResults.length > 0 && <Heading>Funds</Heading>}
              <button {...common} className={optionClass(idx, 'justify-between py-2.5')}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-fg">{opt.fund.name}</div>
                  <div className="text-xs text-faint">{opt.fund.amc}</div>
                </div>
                <span className={`pill shrink-0 ${getCategoryColor(opt.fund.category).bg} ${getCategoryColor(opt.fund.category).text}`}>
                  {opt.fund.categoryDisplay}
                </span>
              </button>
            </Fragment>
          )
        })}
      </div>

      {noMatch && (
        <div className={`absolute right-0 z-50 mt-2 ${panelWidth} rounded-2xl border border-line bg-surface p-4 text-sm text-muted shadow-xl`}>
          No funds match “{query}”. Try a fund name like “HDFC Flexi” or a category like “small cap”.
        </div>
      )}
    </div>
  )
}
