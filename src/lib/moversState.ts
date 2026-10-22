/**
 * The one description of what the Movers page shows. The tabs, filters and the
 * question box all read and write this same object, and it round-trips through the
 * URL so any view can be shared.
 */
export type View = 'flows' | 'size' | 'returns' | 'rank' | 'momentum' | 'cost' | 'managers' | 'stocks' | 'debt'
export type Measure =
  | 'flow' | 'aum' | 'aumChange'
  | 'cagr' | 'vsCategory' | 'sharpe' | 'sortino' | 'volatility' | 'drawdown' | 'alpha' | 'score'
  | 'rankMove' | 'rankNow' | 'momentum'
  | 'ter' | 'terChange'
  | 'mgrChanges' | 'joined' | 'left'
  | 'netBuyers' | 'added' | 'exited' | 'valueChange'
export const FILTER_FIELDS = ['aum', 'flow', 'aumChange', 'cagr', 'vsCategory', 'sharpe', 'volatility', 'drawdown', 'alpha',
  'score', 'ter', 'terChange', 'rankNow', 'rankMove', 'age', 'momentum', 'sortino'] as const
export type FilterField = typeof FILTER_FIELDS[number]
/** `inc`: the bound itself passes ("at least 1,000 cr", ">= 20%"). */
export interface Threshold { field: FilterField; op: 'gt' | 'lt' | 'between'; a: number; b?: number; pct?: boolean; inc?: boolean }
export type Win = 1 | 3 | 6 | 12
export type Horizon = '1Y' | '3Y' | '5Y'
export type GroupBy = 'fund' | 'category' | 'amc' | 'type' | 'theme' | 'sector'

export interface MoversState {
  view: View
  measure: Measure
  mode: 'abs' | 'pct'
  win: Win
  horizon: Horizon
  order: 'desc' | 'asc'
  sign: 'any' | 'pos' | 'neg'
  groupBy: GroupBy
  categories: string[]
  notCategories: string[]
  amcs: string[]
  notAmcs: string[]
  themes: string[]
  notThemes: string[]
  stockSectors: string[]
  type: 'all' | 'index' | 'active'
  young: 'all' | 'only' | 'exclude'
  risk: string[]
  thresholds: Threshold[]
  stock: string | null
  action: 'any' | 'buy' | 'sell' | 'added' | 'exited'
  names: string[]
  limit: number | null
  month: string | null
  count: boolean
  agg: 'none' | 'total' | 'average'
}

export const VIEW_OF: Record<Measure, View> = {
  flow: 'flows', aum: 'size', aumChange: 'size',
  cagr: 'returns', vsCategory: 'returns', sharpe: 'returns', sortino: 'returns', volatility: 'returns',
  drawdown: 'returns', alpha: 'returns', score: 'returns',
  rankMove: 'rank', rankNow: 'rank', momentum: 'momentum',
  ter: 'cost', terChange: 'cost', mgrChanges: 'managers', joined: 'managers', left: 'managers',
  netBuyers: 'stocks', added: 'stocks', exited: 'stocks', valueChange: 'stocks',
}

/** The measure each view sorts by when nothing else is asked for. */
export const DEFAULT_MEASURE: Record<View, Measure> = {
  flows: 'flow', size: 'aum', returns: 'cagr', rank: 'rankMove', momentum: 'momentum', cost: 'ter',
  managers: 'mgrChanges', stocks: 'netBuyers', debt: 'aum',
}

/** Measures where a lower number is the better one ("best" sorts ascending). */
export const LOWER_IS_BETTER = new Set<Measure>(['volatility', 'drawdown', 'ter', 'terChange', 'rankNow'])

export const DEFAULT_STATE: MoversState = {
  view: 'flows', measure: 'flow', mode: 'abs', win: 1, horizon: '3Y', order: 'desc', sign: 'any', groupBy: 'fund',
  categories: [], notCategories: [], amcs: [], notAmcs: [], themes: [], notThemes: [], stockSectors: [],
  type: 'all', young: 'all', risk: [], thresholds: [], stock: null, action: 'any', names: [], limit: null,
  month: null, count: false, agg: 'none',
}

export function freshState(view: View = 'flows'): MoversState {
  return { ...structuredCloneState(DEFAULT_STATE), view, measure: DEFAULT_MEASURE[view], win: view === 'managers' ? 12 : 1 }
}

export function structuredCloneState(s: MoversState): MoversState {
  return {
    ...s, categories: [...s.categories], notCategories: [...s.notCategories], amcs: [...s.amcs], notAmcs: [...s.notAmcs],
    themes: [...s.themes], notThemes: [...s.notThemes], stockSectors: [...s.stockSectors], risk: [...s.risk],
    thresholds: s.thresholds.map(t => ({ ...t })), names: [...s.names],
  }
}

// ---- URL round trip -------------------------------------------------------------
const LISTS = ['categories', 'notCategories', 'amcs', 'notAmcs', 'themes', 'notThemes', 'stockSectors', 'risk', 'names'] as const
const SCALARS = ['view', 'measure', 'mode', 'win', 'horizon', 'order', 'sign', 'groupBy', 'type', 'young', 'stock', 'action',
  'limit', 'month', 'count', 'agg'] as const

/** Only what differs from the defaults goes into the URL. */
export function stateToParams(s: MoversState): URLSearchParams {
  const p = new URLSearchParams()
  const base = freshState(s.view)
  for (const k of SCALARS) {
    const v = s[k]
    if (k === 'view' ? v !== 'flows' : v !== base[k]) if (v != null) p.set(k, String(v))
  }
  for (const k of LISTS) if (s[k].length) p.set(k, s[k].join('|'))
  if (s.thresholds.length) p.set('th', s.thresholds.map(t => [t.field, t.op, t.a, t.b ?? '', t.pct ? 1 : '', t.inc ? 1 : ''].join(':').replace(/:+$/, '')).join('|'))
  return p
}

const VIEWS = new Set<View>(['flows', 'size', 'returns', 'rank', 'momentum', 'cost', 'managers', 'stocks', 'debt'])

export function paramsToState(p: URLSearchParams): MoversState {
  const view = (VIEWS.has(p.get('view') as View) ? p.get('view') : 'flows') as View
  const s = freshState(view)
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const v = p.get(key) as T | null
    return v != null && allowed.includes(v) ? v : fallback
  }
  const measure = p.get('measure') as Measure | null
  if (measure && measure in VIEW_OF && VIEW_OF[measure] === view) s.measure = measure
  s.mode = pick('mode', ['abs', 'pct'] as const, s.mode)
  const win = Number(p.get('win'))
  if ([1, 3, 6, 12].includes(win)) s.win = win as Win
  s.horizon = pick('horizon', ['1Y', '3Y', '5Y'] as const, s.horizon)
  s.order = pick('order', ['desc', 'asc'] as const, s.order)
  s.sign = pick('sign', ['any', 'pos', 'neg'] as const, s.sign)
  s.groupBy = pick('groupBy', ['fund', 'category', 'amc', 'type', 'theme', 'sector'] as const, s.groupBy)
  s.type = pick('type', ['all', 'index', 'active'] as const, s.type)
  s.young = pick('young', ['all', 'only', 'exclude'] as const, s.young)
  s.action = pick('action', ['any', 'buy', 'sell', 'added', 'exited'] as const, s.action)
  s.agg = pick('agg', ['none', 'total', 'average'] as const, s.agg)
  s.stock = p.get('stock') || null
  const limit = Number(p.get('limit'))
  s.limit = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : null
  const month = p.get('month')
  s.month = month && /^\d{4}-\d{2}$/.test(month) ? month : null
  s.count = p.get('count') === 'true'
  for (const k of LISTS) {
    const v = p.get(k)
    s[k] = v ? v.split('|').filter(Boolean).slice(0, 20) : []
  }
  const th = p.get('th')
  if (th) {
    for (const part of th.split('|').slice(0, 10)) {
      const [field, op, a, b, pct, inc] = part.split(':')
      const na = Number(a), nb = b === '' || b == null ? undefined : Number(b)
      if (!(FILTER_FIELDS as readonly string[]).includes(field) || !['gt', 'lt', 'between'].includes(op) || !Number.isFinite(na)) continue
      if (op === 'between' && (nb == null || !Number.isFinite(nb))) continue
      s.thresholds.push({ field: field as FilterField, op: op as Threshold['op'], a: na, ...(nb != null && Number.isFinite(nb) ? { b: nb } : {}), ...(pct === '1' ? { pct: true } : {}), ...(inc === '1' && op !== 'between' ? { inc: true } : {}) })
    }
  }
  return s
}
