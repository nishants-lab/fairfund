import { AbsoluteFill, Easing, Series, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadFont as loadInter } from '@remotion/google-fonts/Inter'
import { loadFont as loadNewsreader } from '@remotion/google-fonts/Newsreader'

const { fontFamily: SANS } = loadInter('normal', { weights: ['400', '600', '700'], subsets: ['latin', 'latin-ext'] })
const { fontFamily: SERIF } = loadNewsreader('normal', { weights: ['600'], subsets: ['latin', 'latin-ext'] })

const INK = '#14171c', PAPER = '#f6f3ec', MUTED = '#9aa3ad', LINE = '#2a3038', UP = '#34d399', DOWN = '#fb7185'
const OUT = Easing.bezier(0.16, 1, 0.3, 1)
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

type Row = { name: string; net: number; funds: number }
export type VideoProps = {
  month: string; monthLong: string; complete: boolean
  net: number; funds: number; houses: number; inflow: number; cashUsed: number
  buys: Row[]; sells: Row[]
  sectorsUp: { name: string; net: number }[]; sectorsDown: { name: string; net: number }[]
  newStakes: Row[]
}

// Scene lengths in seconds, at 30 fps.
const SCENES = { title: 3, headline: 5.5, bought: 7, sold: 6.5, sectors: 5.5, stakes: 4.5, outro: 4 }
/** Video length for these props: the stakes scene drops out when a month has none. */
export const totalFrames = (p: VideoProps, fps = 30) =>
  Math.round(Object.entries(SCENES).reduce((a, [k, v]) => a + (k === 'stakes' && p.newStakes.length === 0 ? 0 : v), 0) * fps)

const crore = (v: number, signed = false) => {
  const n = Math.round(Math.abs(v)).toLocaleString('en-IN')
  const sign = signed ? (v > 0 ? '+' : v < 0 ? '\u2212' : '') : v < 0 ? '\u2212' : ''
  return `${sign}\u20b9${n} cr`
}

/** Fades a scene in and out at its edges. */
function Scene({ seconds, children }: { seconds: number; children: React.ReactNode }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const end = seconds * fps
  return (
    <AbsoluteFill style={{
      padding: '150px 80px 130px', flexDirection: 'column', fontFamily: SANS, color: PAPER,
      opacity: interpolate(frame, [0, 10, end - 10, end], [0, 1, 1, 0], CLAMP),
      translate: interpolate(frame, [0, 14], ['0px 24px', '0px 0px'], { ...CLAMP, easing: OUT }),
    }}>
      {children}
    </AbsoluteFill>
  )
}

function Kicker({ children, color = MUTED }: { children: React.ReactNode; color?: string }) {
  return <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', color }}>{children}</div>
}

function Title({ children, size = 104 }: { children: React.ReactNode; size?: number }) {
  return <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: size, lineHeight: 1.04, marginTop: 28 }}>{children}</div>
}

/** One ranked row: name, value, a bar growing from the left, and a funds note. */
function Bar({ row, max, color, index, note }: { row: Row; max: number; color: string; index: number; note: string }) {
  const frame = useCurrentFrame()
  const start = 18 + index * 7
  const grow = interpolate(frame, [start, start + 28], [0, Math.abs(row.net) / max], { ...CLAMP, easing: OUT })
  return (
    <div style={{
      marginTop: 84,
      opacity: interpolate(frame, [start - 6, start + 6], [0, 1], CLAMP),
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24 }}>
        <span style={{ fontSize: 50, fontWeight: 600, whiteSpace: 'nowrap' }}>{row.name}</span>
        <span style={{ fontSize: 50, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{crore(row.net, true)}</span>
      </div>
      <div style={{ height: 18, background: LINE, borderRadius: 9, marginTop: 16 }}>
        <div style={{ height: 18, width: `${Math.max(1, grow * 100)}%`, background: color, borderRadius: 9 }} />
      </div>
      <div style={{ fontSize: 34, color: MUTED, marginTop: 12 }}>{note}</div>
    </div>
  )
}

function TitleScene({ p }: { p: VideoProps }) {
  return (
    <Scene seconds={SCENES.title}>
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 64 }}>FairFund</div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Kicker>Monthly report</Kicker>
        <Title size={132}>What mutual funds bought in {p.monthLong.split(' ')[0]}</Title>
        <div style={{ fontSize: 48, color: MUTED, marginTop: 36 }}>{p.monthLong}{p.complete ? '' : ', partial month'}</div>
      </div>
    </Scene>
  )
}

function HeadlineScene({ p }: { p: VideoProps }) {
  const frame = useCurrentFrame()
  const shown = interpolate(frame, [12, 72], [0, Math.abs(p.net)], { ...CLAMP, easing: OUT })
  const cash = Math.abs(p.cashUsed)
  return (
    <Scene seconds={SCENES.headline}>
      <Kicker>{p.monthLong}</Kicker>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 48, color: MUTED }}>Funds {p.net >= 0 ? 'bought' : 'sold'} an estimated net</div>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 176, lineHeight: 1, color: p.net >= 0 ? UP : DOWN, marginTop: 20, fontVariantNumeric: 'tabular-nums' }}>
          {crore(shown)}
        </div>
        <div style={{ fontSize: 48, marginTop: 24 }}>of shares, across {p.funds} funds</div>
        <div style={{
          marginTop: 110, borderTop: `2px solid ${LINE}`, paddingTop: 44, fontSize: 44, lineHeight: 1.45, color: MUTED,
          opacity: interpolate(frame, [70, 90], [0, 1], CLAMP),
        }}>
          <div><span style={{ color: PAPER, fontWeight: 600 }}>{crore(p.inflow)}</span> of new money came in</div>
          <div><span style={{ color: PAPER, fontWeight: 600 }}>{crore(cash)}</span> moved {p.cashUsed >= 0 ? 'from cash into shares' : 'from shares into cash'}</div>
        </div>
      </div>
    </Scene>
  )
}

function ListScene({ seconds, kicker, title, rows, color, note }: {
  seconds: number; kicker: string; title: string; rows: Row[]; color: string; note: (r: Row) => string
}) {
  const max = Math.max(...rows.map(r => Math.abs(r.net)), 1)
  return (
    <Scene seconds={seconds}>
      <Kicker color={color}>{kicker}</Kicker>
      <Title>{title}</Title>
      <div style={{ marginTop: 50 }}>
        {rows.map((r, i) => <Bar key={r.name} row={r} max={max} color={color} index={i} note={note(r)} />)}
      </div>
    </Scene>
  )
}

function SectorScene({ p }: { p: VideoProps }) {
  const frame = useCurrentFrame()
  const rows = [...p.sectorsUp, ...p.sectorsDown]
  const max = Math.max(...rows.map(r => Math.abs(r.net)), 1)
  return (
    <Scene seconds={SCENES.sectors}>
      <Kicker>By sector</Kicker>
      <Title>Where the money went</Title>
      <div style={{ marginTop: 70 }}>
        {rows.map((r, i) => {
          const start = 16 + i * 7
          const color = r.net >= 0 ? UP : DOWN
          const w = interpolate(frame, [start, start + 26], [0, (Math.abs(r.net) / max) * 100], { ...CLAMP, easing: OUT })
          return (
            <div key={r.name} style={{ marginTop: 84, opacity: interpolate(frame, [start - 6, start + 6], [0, 1], CLAMP) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 50, fontWeight: 600 }}>
                <span>{r.name}</span><span style={{ color }}>{crore(r.net, true)}</span>
              </div>
              <div style={{ height: 18, marginTop: 18, background: LINE, borderRadius: 9 }}>
                <div style={{ height: 18, width: `${Math.max(1, w)}%`, background: color, borderRadius: 9 }} />
              </div>
            </div>
          )
        })}
      </div>
    </Scene>
  )
}

function StakesScene({ p }: { p: VideoProps }) {
  const frame = useCurrentFrame()
  return (
    <Scene seconds={SCENES.stakes}>
      <Kicker color={UP}>New stakes</Kicker>
      <Title>Funds that opened a new position</Title>
      <div style={{ marginTop: 60 }}>
        {p.newStakes.map((r, i) => (
          <div key={r.name} style={{
            display: 'flex', alignItems: 'baseline', gap: 36, marginTop: 110,
            opacity: interpolate(frame, [14 + i * 9, 26 + i * 9], [0, 1], CLAMP),
            translate: interpolate(frame, [14 + i * 9, 32 + i * 9], ['40px 0px', '0px 0px'], { ...CLAMP, easing: OUT }),
          }}>
            <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 150, color: UP, minWidth: 230, fontVariantNumeric: 'tabular-nums' }}>{r.funds}</span>
            <span style={{ fontSize: 52, lineHeight: 1.25 }}>funds in<br /><span style={{ fontWeight: 700 }}>{r.name}</span></span>
          </div>
        ))}
      </div>
    </Scene>
  )
}

function OutroScene({ p }: { p: VideoProps }) {
  return (
    <Scene seconds={SCENES.outro}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Kicker>Full report</Kicker>
        <Title size={96}>Every stock, sector, category and fund house</Title>
        <div style={{ fontSize: 48, fontWeight: 700, color: UP, marginTop: 56 }}>nishants-lab.github.io/fairfund</div>
      </div>
      <div style={{ fontSize: 34, lineHeight: 1.4, color: MUTED }}>
        Estimates from the portfolios {p.houses} fund houses publish each month. For research, not investment advice.
      </div>
    </Scene>
  )
}

/** A thin bar along the bottom showing how far through the video we are. */
function Progress() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  return (
    <div style={{ position: 'absolute', left: 80, right: 80, bottom: 70, height: 6, background: LINE, borderRadius: 3 }}>
      <div style={{ height: 6, width: `${(frame / (durationInFrames - 1)) * 100}%`, background: MUTED, borderRadius: 3 }} />
    </div>
  )
}

export function FundBuying(p: VideoProps) {
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill style={{ background: INK }}>
      <Series>
        <Series.Sequence name="Title" durationInFrames={SCENES.title * fps}><TitleScene p={p} /></Series.Sequence>
        <Series.Sequence name="Headline" durationInFrames={SCENES.headline * fps}><HeadlineScene p={p} /></Series.Sequence>
        <Series.Sequence name="Most bought" durationInFrames={SCENES.bought * fps}>
          <ListScene seconds={SCENES.bought} kicker="Most bought" title="Where funds put the most money" rows={p.buys} color={UP}
            note={r => `${r.funds} funds adding`} />
        </Series.Sequence>
        <Series.Sequence name="Most sold" durationInFrames={SCENES.sold * fps}>
          <ListScene seconds={SCENES.sold} kicker="Most sold" title="What funds sold the most of" rows={p.sells} color={DOWN}
            note={r => `${r.funds} funds cutting`} />
        </Series.Sequence>
        <Series.Sequence name="Sectors" durationInFrames={SCENES.sectors * fps}><SectorScene p={p} /></Series.Sequence>
        {p.newStakes.length > 0 && (
          <Series.Sequence name="New stakes" durationInFrames={SCENES.stakes * fps}><StakesScene p={p} /></Series.Sequence>
        )}
        <Series.Sequence name="Outro" durationInFrames={SCENES.outro * fps}><OutroScene p={p} /></Series.Sequence>
      </Series>
      <Progress />
    </AbsoluteFill>
  )
}
