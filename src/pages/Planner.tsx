import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  assessGoal,
  projectCorpus,
  ACHIEVABILITY_META,
  type GoalInputs,
} from '../lib/goal'
import { inr, inrFull, pct } from '../lib/format'
import { data, topFundsForCategory } from '../lib/data'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'

const PRESETS = [
  { label: 'Retirement', target: 50000000, years: 25, emoji: '🏖️' },
  { label: 'Child’s Education', target: 10000000, years: 15, emoji: '🎓' },
  { label: 'Buy a Home', target: 20000000, years: 10, emoji: '🏠' },
  { label: 'Wealth Building', target: 10000000, years: 12, emoji: '💰' },
]

const ACHIEVABILITY_COLORS: Record<string, string> = {
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  blue: 'bg-brand-50 border-brand-200 text-brand-800',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  rose: 'bg-rose-50 border-rose-200 text-rose-800',
}

export default function Planner() {
  const navigate = useNavigate()
  const [inputs, setInputs] = useState<GoalInputs>({
    targetCorpus: 10000000,
    years: 15,
    currentCorpus: 500000,
    monthlySip: 25000,
    lumpsumNow: 0,
  })
  // Assumed return slider — default to a realistic 12% (large/flexi-cap territory)
  const [assumedCagr, setAssumedCagr] = useState(12)

  const result = useMemo(() => assessGoal(inputs, assumedCagr), [inputs, assumedCagr])
  const meta = ACHIEVABILITY_META[result.achievability]

  // Build projection curve
  const projection = useMemo(() => {
    const pts = []
    for (let y = 0; y <= inputs.years; y++) {
      const partial: GoalInputs = { ...inputs, years: y }
      pts.push({
        year: y,
        value: Math.round(projectCorpus(partial, assumedCagr)),
        target: inputs.targetCorpus,
      })
    }
    return pts
  }, [inputs, assumedCagr])

  function update<K extends keyof GoalInputs>(key: K, value: number) {
    setInputs((prev) => ({ ...prev, [key]: value }))
  }

  // Suggest categories based on required CAGR
  const suggestedCats = useMemo(() => {
    const req = result.requiredCagr ?? 99
    if (req <= 8) return ['Index-LargeCap', 'Large Cap']
    if (req <= 13) return ['Flexi Cap', 'Large Cap', 'Multi Cap']
    if (req <= 18) return ['Mid Cap', 'Flexi Cap', 'Multi Cap']
    return ['Small Cap', 'Mid Cap']
  }, [result.requiredCagr])

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">Goal Planner</h1>
      <p className="mt-1 text-sm text-muted">
        Tell us your goal. We’ll show whether it’s achievable, what return you’d need, and which fund
        categories historically deliver that — without overpromising.
      </p>

      {/* Presets */}
      <div className="mt-5 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => setInputs((prev) => ({ ...prev, targetCorpus: p.target, years: p.years }))}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-muted transition hover:border-brand-300 hover:text-brand-600"
          >
            {p.emoji} {p.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Inputs */}
        <div className="card p-6">
          <h2 className="font-bold text-fg">Your numbers</h2>

          <Slider
            label="Target corpus"
            value={inputs.targetCorpus}
            min={500000}
            max={100000000}
            step={500000}
            display={inrFull(inputs.targetCorpus)}
            onChange={(v) => update('targetCorpus', v)}
          />
          <Slider
            label="Time horizon"
            value={inputs.years}
            min={1}
            max={40}
            step={1}
            display={`${inputs.years} years`}
            onChange={(v) => update('years', v)}
          />
          <Slider
            label="Current corpus (already invested)"
            value={inputs.currentCorpus}
            min={0}
            max={50000000}
            step={100000}
            display={inrFull(inputs.currentCorpus)}
            onChange={(v) => update('currentCorpus', v)}
          />
          <Slider
            label="Monthly SIP"
            value={inputs.monthlySip}
            min={0}
            max={500000}
            step={1000}
            display={inrFull(inputs.monthlySip) + '/mo'}
            onChange={(v) => update('monthlySip', v)}
          />
          <Slider
            label="One-time lumpsum now"
            value={inputs.lumpsumNow}
            min={0}
            max={50000000}
            step={100000}
            display={inrFull(inputs.lumpsumNow)}
            onChange={(v) => update('lumpsumNow', v)}
          />

          <div className="mt-5 border-t border-line pt-4">
            <Slider
              label="Assumed annual return"
              value={assumedCagr}
              min={6}
              max={22}
              step={0.5}
              display={pct(assumedCagr)}
              onChange={setAssumedCagr}
              accent
            />
            <p className="text-xs text-faint">
              Be realistic: large-cap ≈ 11–13%, flexi-cap ≈ 13–15%, mid/small-cap ≈ 15–18% (with much
              higher risk). Anything above 18% long-term is optimistic.
            </p>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4">
          {/* Verdict card */}
          <div className={`rounded-2xl border p-6 ${ACHIEVABILITY_COLORS[meta.color]}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide opacity-70">Verdict</span>
              <span className="rounded-full bg-white/60 px-3 py-1 text-sm font-bold">{meta.label}</span>
            </div>
            <div className="mt-3 text-3xl font-extrabold">
              {inr(result.projectedCorpus)}
            </div>
            <div className="text-sm opacity-80">
              projected in {inputs.years} years at {pct(assumedCagr)} · target {inr(inputs.targetCorpus)}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-white/50 p-3">
                <div className="text-xs opacity-70">Return needed to hit target</div>
                <div className="text-lg font-bold">
                  {result.requiredCagr === null ? '> 60%' : pct(result.requiredCagr)}
                </div>
              </div>
              <div className="rounded-xl bg-white/50 p-3">
                <div className="text-xs opacity-70">{result.shortfall > 0 ? 'Shortfall' : 'Surplus'}</div>
                <div className="text-lg font-bold">{inr(Math.abs(result.shortfall))}</div>
              </div>
            </div>
            <p className="mt-3 text-sm">{meta.advice}</p>
          </div>

          {/* Projection chart */}
          <div className="card p-5">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-faint">Growth projection</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={projection} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(y) => `Y${y}`} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => inr(v)} width={55} />
                <Tooltip formatter={(v: number) => [inrFull(v), 'Corpus']} labelFormatter={(y) => `Year ${y}`} />
                <ReferenceLine y={inputs.targetCorpus} stroke="#f43f5e" strokeDasharray="4 4" label={{ value: 'Target', fontSize: 10, fill: '#f43f5e', position: 'right' }} />
                <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fill="url(#grad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Suggested funds */}
      <div className="mt-8">
        <h2 className="font-bold text-fg">Funds that historically fit this goal</h2>
        <p className="mt-1 text-sm text-muted">
          Based on the {pct(result.requiredCagr ?? assumedCagr)} return you need, here are top-ranked
          funds in suitable categories. {result.achievability === 'unrealistic' && 'Note: your target may need adjusting — these are the highest-return categories but come with real risk.'}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {suggestedCats.flatMap((cat) =>
            topFundsForCategory(cat, 1).map((f) => {
              const m = f.metrics['5Y'] ?? f.metrics['3Y']
              return (
                <button key={f.code} onClick={() => navigate(`/fund/${f.code}`)} className="card p-4 text-left transition hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="pill bg-surface2 text-muted">{f.categoryDisplay}</span>
                    <span className="text-xs text-faint">#{m?.catRank} in cat</span>
                  </div>
                  <div className="mt-2 font-semibold text-fg">{f.name}</div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted">5Y/3Y CAGR</span>
                    <span className="font-bold text-fg">{pct(m?.cagr)}</span>
                  </div>
                </button>
              )
            }),
          )}
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-faint">
        Projections assume a constant annual return, which never happens in reality — markets are
        volatile. This is a planning aid, not a guarantee. Data as of {data.anchor}.
      </p>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  accent,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
  accent?: boolean
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-muted">{label}</label>
        <span className={`text-sm font-bold ${accent ? 'text-accent' : 'text-brand-600 dark:text-brand-400'}`}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-brand-600"
      />
    </div>
  )
}
