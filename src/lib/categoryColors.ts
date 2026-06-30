/** Unique color mapping for each fund category — returns Tailwind class strings */

interface CategoryColor {
  bg: string
  text: string
  border: string
}

const colorMap: Record<string, CategoryColor> = {
  'Large Cap': {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-300 dark:border-blue-700',
  },
  'Flexi Cap': {
    bg: 'bg-violet-50 dark:bg-violet-900/30',
    text: 'text-violet-700 dark:text-violet-300',
    border: 'border-violet-300 dark:border-violet-700',
  },
  'Multi Cap': {
    bg: 'bg-purple-50 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-300 dark:border-purple-700',
  },
  'Large & Mid Cap': {
    bg: 'bg-indigo-50 dark:bg-indigo-900/30',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-300 dark:border-indigo-700',
  },
  'Mid Cap': {
    bg: 'bg-teal-50 dark:bg-teal-900/30',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-300 dark:border-teal-700',
  },
  'Small Cap': {
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-300 dark:border-emerald-700',
  },
  'Value/Contra': {
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-300 dark:border-amber-700',
  },
  'Focused': {
    bg: 'bg-cyan-50 dark:bg-cyan-900/30',
    text: 'text-cyan-700 dark:text-cyan-300',
    border: 'border-cyan-300 dark:border-cyan-700',
  },
  'ELSS': {
    bg: 'bg-lime-50 dark:bg-lime-900/30',
    text: 'text-lime-700 dark:text-lime-300',
    border: 'border-lime-300 dark:border-lime-700',
  },
  'Dividend Yield': {
    bg: 'bg-orange-50 dark:bg-orange-900/30',
    text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-300 dark:border-orange-700',
  },
  'Sectoral/Thematic': {
    bg: 'bg-rose-50 dark:bg-rose-900/30',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-300 dark:border-rose-700',
  },
  'International': {
    bg: 'bg-sky-50 dark:bg-sky-900/30',
    text: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-300 dark:border-sky-700',
  },
  'FoF-Equity (Domestic)': {
    bg: 'bg-slate-100 dark:bg-slate-800/40',
    text: 'text-slate-600 dark:text-slate-300',
    border: 'border-slate-300 dark:border-slate-600',
  },
  'Index Funds': {
    bg: 'bg-blue-100 dark:bg-blue-900/25',
    text: 'text-blue-600 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-700',
  },
  'Index-MidCap': {
    bg: 'bg-teal-100 dark:bg-teal-900/25',
    text: 'text-teal-600 dark:text-teal-300',
    border: 'border-teal-200 dark:border-teal-700',
  },
  'Index-SmallCap': {
    bg: 'bg-emerald-100 dark:bg-emerald-900/25',
    text: 'text-emerald-600 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-700',
  },
  'Index-Sectoral/Thematic': {
    bg: 'bg-rose-100 dark:bg-rose-900/25',
    text: 'text-rose-600 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-700',
  },
  'Index-Other': {
    bg: 'bg-gray-100 dark:bg-gray-800/40',
    text: 'text-gray-600 dark:text-gray-300',
    border: 'border-gray-300 dark:border-gray-600',
  },
}

const fallback: CategoryColor = {
  bg: 'bg-slate-100 dark:bg-slate-800/30',
  text: 'text-slate-600 dark:text-slate-300',
  border: 'border-slate-300 dark:border-slate-600',
}

export function getCategoryColor(category: string): CategoryColor {
  return colorMap[category] ?? fallback
}
