/**
 * Round axis ticks inside a numeric range: multiples of 1, 2 or 5 times a power
 * of ten, about `target` of them. The domain stays as given, so the plot keeps its space. Charts given a
 * raw padded min/max otherwise split it evenly into fractional ticks that print
 * as uneven numbers (21%, 8%, 1%).
 */
export interface NiceAxis {
  domain: [number, number]
  ticks: number[]
  /** Decimal places that show every tick distinctly. */
  decimals: number
}

export function niceTicks(min: number, max: number, target = 5): NiceAxis {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { domain: [0, 1], ticks: [0, 1], decimals: 0 }
  if (max < min) [min, max] = [max, min]
  if (max === min) { min -= 1; max += 1 }
  // Of the round steps near (max - min) / target, take the one that puts the
  // closest to `target` ticks inside the range; on a tie, the larger step.
  const mag = 10 ** Math.floor(Math.log10((max - min) / target))
  const inside = (step: number) => Math.floor(max / step + 1e-9) - Math.ceil(min / step - 1e-9) + 1
  const step = [0.5, 1, 2, 5, 10, 20].map((m) => m * mag)
    .reduce((best, s) => {
      const d = Math.abs(inside(s) - target), bd = Math.abs(inside(best) - target)
      return d < bd || (d === bd && s > best) ? s : best
    })
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const round = (v: number) => Number(v.toFixed(decimals + 2))
  const first = Math.ceil(min / step - 1e-9)
  const last = Math.floor(max / step + 1e-9)
  const ticks: number[] = []
  for (let k = first; k <= last; k++) ticks.push(round(k * step) || 0)
  return { domain: [min, max], ticks, decimals }
}
