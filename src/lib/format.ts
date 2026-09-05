export function pct(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || isNaN(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export function signedPct(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || isNaN(n)) return '—'
  const s = n >= 0 ? '+' : ''
  return `${s}${n.toFixed(digits)}%`
}

export function num(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || isNaN(n)) return '—'
  return n.toFixed(digits)
}

export function inr(n: number): string {
  // Indian numbering with lakh/crore
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`
  return `₹${Math.round(n)}`
}

export function inrFull(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

export function riskColor(level: string): string {
  switch (level) {
    case 'Low':
      return 'bg-teal-100 text-teal-700'
    case 'Low to Moderate':
      return 'bg-emerald-100 text-emerald-600'
    case 'Moderate':
      return 'bg-emerald-100 text-emerald-700'
    case 'Moderately High':
      return 'bg-amber-100 text-amber-700'
    case 'High':
      return 'bg-orange-100 text-orange-700'
    case 'Very High':
      return 'bg-rose-100 text-rose-700'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

export function fundSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

export function alphaColor(alpha: number): string {
  if (alpha > 2) return 'text-emerald-600'
  if (alpha > 0) return 'text-emerald-500'
  if (alpha > -2) return 'text-amber-600'
  return 'text-rose-600'
}
