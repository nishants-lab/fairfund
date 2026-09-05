/** Unique color mapping for each fund category. Returns Tailwind class strings */

interface CategoryColor {
  bg: string
  text: string
  border: string
}

const colorMap: Record<string, CategoryColor> = {
  'Large Cap': {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-500 dark:border-blue-500',
  },
  'Flexi Cap': {
    bg: 'bg-violet-50 dark:bg-violet-900/30',
    text: 'text-violet-700 dark:text-violet-300',
    border: 'border-violet-500 dark:border-violet-500',
  },
  'Multi Cap': {
    bg: 'bg-purple-50 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-500 dark:border-purple-500',
  },
  'Large & Mid Cap': {
    bg: 'bg-indigo-50 dark:bg-indigo-900/30',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-500 dark:border-indigo-500',
  },
  'Mid Cap': {
    bg: 'bg-teal-50 dark:bg-teal-900/30',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-500 dark:border-teal-500',
  },
  'Small Cap': {
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-500 dark:border-emerald-500',
  },
  'Value/Contra': {
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-500 dark:border-amber-500',
  },
  'Focused': {
    bg: 'bg-cyan-50 dark:bg-cyan-900/30',
    text: 'text-cyan-700 dark:text-cyan-300',
    border: 'border-cyan-500 dark:border-cyan-500',
  },
  'ELSS': {
    bg: 'bg-lime-50 dark:bg-lime-900/30',
    text: 'text-lime-700 dark:text-lime-300',
    border: 'border-lime-500 dark:border-lime-500',
  },
  'Dividend Yield': {
    bg: 'bg-orange-50 dark:bg-orange-900/30',
    text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-500 dark:border-orange-500',
  },
  'Sectoral/Thematic': {
    bg: 'bg-rose-50 dark:bg-rose-900/30',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-500 dark:border-rose-500',
  },
  'International': {
    bg: 'bg-sky-50 dark:bg-sky-900/30',
    text: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-500 dark:border-sky-500',
  },
  'FoF-Equity (Domestic)': {
    bg: 'bg-slate-100 dark:bg-slate-800/40',
    text: 'text-slate-600 dark:text-slate-300',
    border: 'border-slate-500 dark:border-slate-400',
  },
  'Index Funds': {
    bg: 'bg-blue-100 dark:bg-blue-900/25',
    text: 'text-blue-600 dark:text-blue-300',
    border: 'border-blue-400 dark:border-blue-500',
  },
  'Index-MidCap': {
    bg: 'bg-teal-100 dark:bg-teal-900/25',
    text: 'text-teal-600 dark:text-teal-300',
    border: 'border-teal-400 dark:border-teal-500',
  },
  'Index-SmallCap': {
    bg: 'bg-emerald-100 dark:bg-emerald-900/25',
    text: 'text-emerald-600 dark:text-emerald-300',
    border: 'border-emerald-400 dark:border-emerald-500',
  },
  'Index-Sectoral/Thematic': {
    bg: 'bg-rose-100 dark:bg-rose-900/25',
    text: 'text-rose-600 dark:text-rose-300',
    border: 'border-rose-400 dark:border-rose-500',
  },
  'Index-Other': {
    bg: 'bg-gray-100 dark:bg-gray-800/40',
    text: 'text-gray-600 dark:text-gray-300',
    border: 'border-gray-500 dark:border-gray-400',
  },
  // Debt (cash-equivalent) categories: cool, low-key tones reading as parked cash.
  'Liquid': {
    bg: 'bg-slate-100 dark:bg-slate-800/40',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-500 dark:border-slate-400',
  },
  'Money Market': {
    bg: 'bg-cyan-100 dark:bg-cyan-900/25',
    text: 'text-cyan-700 dark:text-cyan-300',
    border: 'border-cyan-500 dark:border-cyan-400',
  },
  // Arbitrage: hedged equity, cash-like. Teal reads as adjacent-to-cash but distinct.
  'Arbitrage': {
    bg: 'bg-teal-100 dark:bg-teal-900/25',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-500 dark:border-teal-400',
  },
}

const fallback: CategoryColor = {
  bg: 'bg-slate-100 dark:bg-slate-800/30',
  text: 'text-slate-600 dark:text-slate-300',
  border: 'border-slate-500 dark:border-slate-400',
}

export function getCategoryColor(category: string): CategoryColor {
  return colorMap[category] ?? fallback
}
