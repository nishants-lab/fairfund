/**
 * CAMS CAS (Consolidated Account Statement) parser.
 * Handles password-protected PDFs and plain text.
 * Runs entirely in the browser. No data leaves the client.
 *
 * Strategy: extract Closing Unit Balance, Total Cost Value, and
 * Market Value per fund block. These are the source of truth for
 * current holdings (avoids transaction netting errors).
 */
import { universeFunds } from './matcherUniverse'
import type { Transaction, ParsedPortfolio, FundSummary } from './portfolio'

/**
 * Bump whenever fund-matching logic changes. Stored with each parsed
 * portfolio so stale parses (matched with older logic) can be detected
 * and the user prompted to re-upload.
 */
export const MATCHER_VERSION = 3

// ---- Fuzzy fund code matching ----

interface FundIndex {
  code: number
  searchable: string      // normalized name, ready for substring comparison
  name: string
  planType: 'direct' | 'regular'
  isIndex: boolean        // index/ETF-style scheme (tracks a benchmark)
  nonEquity: boolean      // debt/hybrid/arbitrage/etc.
  tokens: Set<string>     // non-filler tokens for Jaccard scoring
}
let fundIndex: FundIndex[] | null = null

function getFundIndex(): FundIndex[] {
  if (fundIndex) return fundIndex
  fundIndex = universeFunds.map(f => {
    const searchable = normalizeForMatch(f.name.toLowerCase())
    return {
      code: f.code,
      searchable,
      name: f.name,
      planType: f.planType,
      isIndex: INDEX_RE.test(searchable),
      // NAME-only, deliberately symmetric with the query-side test: the CAMS
      // statement only gives us a name, so judging candidates by anything the
      // query can't see (e.g. amfiCategory) would veto correct matches.
      nonEquity: NON_EQUITY_RE.test(f.name),
      tokens: new Set(searchable.split(/\s+/).filter(t => t.length > 0 && !FILLER_WORDS.has(t))),
    }
  })
  return fundIndex
}

// Normalize compound fund-type words so tokenization matches both forms
// e.g. 'flexicap' <-> 'flexi cap', 'multicap' <-> 'multi cap'
function normalizeForMatch(s: string): string {
  return s
    .replace(/\([^)]*\)/g, ' ')        // drop parentheticals: (formerly ...), (Demat), etc.
    .replace(/flexicap/gi, 'flexi cap')
    .replace(/multicap/gi, 'multi cap')
    .replace(/midcap/gi, 'mid cap')
    .replace(/smallcap/gi, 'small cap')
    .replace(/largecap/gi, 'large cap')
    .replace(/microcap/gi, 'micro cap')
    .replace(/[^a-z0-9]+/gi, ' ')       // hyphens/punctuation -> space for clean tokenization
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Generic words in almost every scheme name. Excluding them from token
// overlap prevents false matches based purely on filler + AMC name.
const FILLER_WORDS = new Set([
  'fund', 'direct', 'regular', 'plan', 'growth', 'option', 'idcw', 'payout',
  'reinvestment', 'dividend', 'income', 'distribution', 'cum', 'withdrawal',
  'the', 'and', 'india', 'scheme', 'open', 'ended',
])

// Scheme types NOT in FairFund's equity universe. If a CAMS scheme matches
// any of these, we do not attempt an equity match (avoids debt->equity errors).
const NON_EQUITY_RE = /\b(gilt|liquid|overnight|money\s*market|ultra\s*short|low\s*duration|short\s*duration|medium\s*duration|long\s*duration|corporate\s*bond|credit\s*risk|dynamic\s*bond|banking\s*(&|and)\s*psu|floating\s*rate|floater|g-?sec|treasury|debt|bond|fixed\s*maturity|fmp|savings\s*fund|arbitrage|balanced\s*advantage|equity\s*savings|conservative\s*hybrid|multi\s*asset|asset\s*allocation|retirement|children)\b/i

const INDEX_RE = /\b(index|nifty|sensex|bse|etf)\b/i

export function isNonEquityScheme(name: string): boolean {
  return NON_EQUITY_RE.test(name)
}

function matchFundCode(schemeName: string): number | null {
  const idx = getFundIndex()
  const q = normalizeForMatch(
    schemeName.toLowerCase()
      .replace(/^[a-z0-9]{5,}\s*-\s*/i, '')   // strip leading RTA product code, e.g. "TDIFGZ - "
      .replace(/\s*-?\s*isin\s*:.*/i, '')
      .replace(/\s*-?\s*advisor\s*:.*/i, '')
      .replace(/\s*-?\s*registrar\s*:.*/i, '')
  )

  // Plan: since 2013 every direct plan is explicitly labelled "Direct" on
  // statements; anything else is a regular-plan holding. Direct and Regular
  // are separate AMFI codes with identical clean names, so this is the only
  // reliable disambiguator - never cross-match plans.
  const qPlan: 'direct' | 'regular' = /\bdirect\b/i.test(schemeName) ? 'direct' : 'regular'
  // Extract the AMC name (first word) to prefer same-AMC matches
  const qAmc = q.split(/\s+/)[0] ?? ''
  // Index and active funds share AMC + cap tokens but track different things,
  // so they must not cross-match (this is what mislabeled active funds as
  // their index siblings). Same idea for equity vs debt/hybrid.
  const qIsIndex = INDEX_RE.test(q)
  const qNonEquity = isNonEquityScheme(schemeName)

  let best: FundIndex | null = null
  let bestScore = 0

  // Substring match
  for (const f of idx) {
    if (f.planType !== qPlan) continue
    const hay = f.searchable
    if (hay.includes(q) || q.includes(hay)) {
      let score = Math.min(q.length, hay.length) / Math.max(q.length, hay.length)
      // Boost if AMC name matches
      if (hay.startsWith(qAmc)) score += 0.1
      // Hard guards: never cross-match index <-> active, equity <-> non-equity
      if (f.isIndex !== qIsIndex) score -= 0.5
      if (f.nonEquity !== qNonEquity) score -= 0.5
      if (score > bestScore) { bestScore = score; best = f }
    }
  }
  if (best && bestScore > 0.5) return best.code

  // Token overlap scored by Jaccard similarity (overlap / union). Dividing by the
  // UNION (not just the query size) demotes a candidate that carries tokens the
  // statement name lacks - e.g. an "index" or "large & mid cap" sibling of the
  // actual fund - instead of letting it tie the exact match.
  const qTokens = new Set(q.split(/\s+/).filter(t => t.length > 2 && !FILLER_WORDS.has(t)))
  for (const f of idx) {
    if (f.planType !== qPlan) continue
    let overlap = 0
    qTokens.forEach(t => { if (f.tokens.has(t)) overlap++ })
    const union = new Set([...qTokens, ...f.tokens]).size
    let score = overlap / Math.max(union, 1)
    // Boost same-AMC matches to break ties
    if (f.searchable.startsWith(qAmc)) score += 0.1
    // Hard guards: never cross-match index <-> active, equity <-> non-equity
    if (f.isIndex !== qIsIndex) score -= 0.5
    if (f.nonEquity !== qNonEquity) score -= 0.5
    if (score > bestScore) { bestScore = score; best = f }
  }
  return bestScore >= 0.45 ? (best?.code ?? null) : null
}

// ---- Helpers ----

function classifyTxType(desc: string): Transaction['type'] {
  const d = desc.toLowerCase()
  if (d.includes('switch in') || d.includes('switch-in') || d.includes('switched in')) return 'switch_in'
  if (d.includes('switch out') || d.includes('switch-out') || d.includes('switched out')) return 'switch_out'
  if (d.includes('systematic') || d.includes('sip')) return 'sip'
  if (d.includes('redemption') || d.includes('redeem')) return 'redeem'
  if (d.includes('dividend') || d.includes('idcw')) return 'dividend'
  return 'purchase'
}

function parseDate(s: string): string | null {
  const m1 = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/)
  if (m1) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    }
    const mm = months[m1[2].toLowerCase()]
    if (mm) return `${m1[3]}-${mm}-${m1[1].padStart(2, '0')}`
  }
  const m2 = s.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`
  return null
}

function parseNumber(s: string): number {
  return parseFloat(s.replace(/,/g, '').replace(/\(([^)]+)\)/, '-$1')) || 0
}

// ---- Text parser ----
//
// CAMS block structure per fund:
//   <scheme code> - <Fund Name> - <Plan> ... ISIN : INF...
//   Opening Unit Balance: X
//   <transaction rows>
//   NAV on <date>: INR X   Market Value on <date>: INR X
//   Closing Unit Balance: X   Total Cost Value: X
//
// We accumulate per-block and only require ISIN to identify a real scheme
// header (transaction descriptions never contain ISIN).

interface BlockState {
  scheme: string
  code: number | null
  closingUnits: number
  totalCost: number
  latestNav: number
  marketValue: number
}

function stripSchemeCode(line: string): string {
  // AMC scheme codes always contain a digit and precede the first " - "
  // e.g. "128 MCDGG - Axis Mid Cap Fund", "K 123 D - Kotak Mid Cap Fund"
  const dashIdx = line.indexOf(' - ')
  if (dashIdx > 0 && dashIdx < 16) {
    const prefix = line.slice(0, dashIdx)
    if (/\d/.test(prefix) && !/fund|cap|equity|index/i.test(prefix)) {
      return line.slice(dashIdx + 3).trim()
    }
  }
  return line
}

function cleanSchemeName(line: string): string {
  return stripSchemeCode(line)
    .replace(/\s*-?\s*ISIN\s*:.*/i, '')
    .replace(/\s*\(\s*Non\s*-?\s*Demat\s*\)/i, '')
    .replace(/\s*\(\s*Advisor\s*:.*/i, '')
    .replace(/\s*Registrar\s*:.*/i, '')
    .replace(/\s*Folio\s*No.*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function parseCAMSText(text: string): ParsedPortfolio {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  let investorName = ''
  let pan = ''
  const transactions: Transaction[] = []
  const fundSummaries: FundSummary[] = []

  const dateRe = /\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b/

  let block: BlockState | null = null

  const flushBlock = () => {
    if (block && block.scheme) {
      fundSummaries.push({
        fundCode: block.code ?? 0,
        fundName: block.scheme,
        closingUnits: block.closingUnits,
        totalCost: block.totalCost,
        latestNav: block.latestNav,
        marketValue: block.marketValue,
      })
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // PAN
    if (!pan) {
      const panMatch = line.match(/PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])/i)
      if (panMatch) pan = panMatch[1]
    }

    // Investor name from Folio line
    if (!investorName) {
      const folioName = line.match(/Folio\s*No\s*:\s*[\d/]+\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i)
      if (folioName) investorName = folioName[1].trim()
    }

    // Scheme header: MUST contain ISIN (reliable CAMS marker).
    // Transaction descriptions like "Lateral Shift In (From ...)" never have ISIN.
    const hasIsin = /ISIN\s*:/i.test(line)
    // Any line carrying an ISIN with real scheme text before it is a header.
    // Transaction descriptions never contain an ISIN. The earlier plan+option
    // requirement silently dropped headers whose wrapping split those words off.
    const looksLikeScheme = hasIsin && /[A-Za-z]{3,}[\s\S]*ISIN\s*:/i.test(line)

    if (looksLikeScheme) {
      flushBlock()
      const scheme = cleanSchemeName(line)
      block = {
        scheme,
        code: scheme.length > 8 ? matchFundCode(scheme) : null,
        closingUnits: 0,
        totalCost: 0,
        latestNav: 0,
        marketValue: 0,
      }
      continue
    }

    if (!block) continue

    // Capture NAV / Market Value anywhere within the block
    const navMatch = line.match(/NAV\s*on\s*[\d-][\w-]*\s*:\s*INR\s*([\d,]+\.\d+)/i)
    if (navMatch) block.latestNav = parseNumber(navMatch[1])
    const mvMatch = line.match(/Market\s*Value\s*on\s*[\d-][\w-]*\s*:\s*INR\s*([\d,]+\.\d+)/i)
    if (mvMatch) block.marketValue = parseNumber(mvMatch[1])

    // Closing Unit Balance + Total Cost Value
    let closingMatch = line.match(/closing\s*(?:unit\s*)?balance\s*:?\s*([\d,]+\.\d+)/i)
    // Label present but the number wrapped to the next reconstructed line
    if (!closingMatch && /closing\s*(?:unit\s*)?balance/i.test(line) && i + 1 < lines.length) {
      const nextBal = lines[i + 1].match(/^\s*([\d,]+\.\d+)/)
      if (nextBal) closingMatch = nextBal
    }
    if (closingMatch) {
      block.closingUnits = parseNumber(closingMatch[1])
      const costMatch = line.match(/total\s*cost\s*value\s*:\s*([\d,]+\.\d+)/i)
      if (costMatch) block.totalCost = parseNumber(costMatch[1])
      else if (i + 1 < lines.length) {
        const nextCost = lines[i + 1].match(/total\s*cost\s*value\s*:\s*([\d,]+\.\d+)/i)
        if (nextCost) block.totalCost = parseNumber(nextCost[1])
      }
      continue
    }

    // Skip non-transaction lines
    if (/^(opening unit balance|total cost value|nav on|market value|registrar|nominee|kyc|pan\s*:)/i.test(line)) continue
    if (/^\*\*\*/.test(line)) continue
    if (/stamp duty/i.test(line)) continue

    // Transaction rows (kept for rank-at-purchase history)
    const dateMatch = line.match(dateRe)
    if (!dateMatch) continue
    const dateStr = parseDate(dateMatch[1])
    if (!dateStr) continue

    const numMatches = line.match(/[\d,]+\.\d{1,6}/g)
    if (!numMatches || numMatches.length < 2) continue

    const afterDate = line.slice(line.indexOf(dateMatch[1]) + dateMatch[1].length)
    const descMatch = afterDate.match(/[A-Za-z][\w\s()/*-]+/)
    const desc = descMatch ? descMatch[0].trim() : ''

    const nums = numMatches.map(parseNumber)
    let amount = 0, nav = 0, units = 0
    if (nums.length >= 4) {
      amount = nums[0]; nav = nums[1]; units = nums[2]
    } else if (nums.length === 3) {
      if (nums[1] < 1000) { amount = nums[0]; nav = nums[1]; units = nav > 0 ? amount / nav : 0 }
      else { amount = nums[0]; units = nums[1] }
    } else if (nums.length === 2) {
      amount = nums[0]; units = nums[1]
    }
    if (amount < 1 && units < 0.001) continue

    transactions.push({
      fundCode: block.code ?? 0,
      fundName: block.scheme,
      date: dateStr,
      type: classifyTxType(desc),
      units: Math.abs(units),
      amount: Math.abs(amount),
      nav: Math.abs(nav),
    })
  }

  flushBlock()

  const maskedPan = pan ? `XXXX${pan.slice(-4)}` : ''
  const fundCodes = [...new Set([
    ...transactions.map(t => t.fundCode),
    ...fundSummaries.map(s => s.fundCode),
  ].filter(c => c > 0))]

  // Reconciliation: every real scheme block carries an ISIN. Fewer blocks than
  // ISINs means we dropped a fund and must surface that to the user.
  // Every scheme (active OR fully redeemed) carries one ISIN. A redeemed fund
  // still prints a header + zero closing balance, so we DO parse it as a block.
  // Only a shortfall of built blocks vs ISINs means we truly dropped a scheme.
  const isinCount = (text.match(/ISIN\s*:/gi) ?? []).length
  const schemesParsed = fundSummaries.length
  const activeHoldings = fundSummaries.filter(s => s.closingUnits > 0.001).length
  const closedPositions = schemesParsed - activeHoldings
  // Active holdings where no value could be read would count as zero and skew weights.
  const missingValueFunds = fundSummaries
    .filter(s => s.closingUnits > 0.001 && s.marketValue <= 0 && s.latestNav <= 0)
    .map(s => s.fundName)
  // CAS Portfolio Summary "Total" row lists <cost> then <market>; capture market.
  let statedTotalValue: number | null = null
  const totalMatch = text.match(/^\s*total\s+[\d,]+\.\d{2}\s+([\d,]{5,}\.\d{2})/im)
  if (totalMatch) statedTotalValue = parseNumber(totalMatch[1])

  return {
    id: crypto.randomUUID?.() ?? Date.now().toString(36),
    uploadedAt: new Date().toISOString(),
    matcherVersion: MATCHER_VERSION,
    investorName,
    pan: maskedPan,
    transactions,
    fundSummaries,
    fundCodes,
    diagnostics: { isinCount, schemesParsed, activeHoldings, closedPositions, missingValueFunds, statedTotalValue },
  }
}

// ---- PDF parser: reconstructs lines from y-coordinates ----

export async function parseCAMSPdf(file: File, password?: string): Promise<{ portfolio?: ParsedPortfolio; needsPassword?: boolean; error?: string }> {
  try {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString()

    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      password: password ?? undefined,
    })

    let pdf
    try {
      pdf = await loadingTask.promise
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err) {
        const pdfErr = err as { name: string }
        if (pdfErr.name === 'PasswordException') {
          return { needsPassword: true }
        }
      }
      return { error: `Failed to open PDF: ${err}` }
    }

    const allLines: string[] = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()

      const rows = new Map<number, { x: number; text: string }[]>()
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const textItem = item as { str: string; transform: number[] }
        const y = Math.round(textItem.transform[5] * 2) / 2
        const x = textItem.transform[4]
        if (!rows.has(y)) rows.set(y, [])
        rows.get(y)!.push({ x, text: textItem.str })
      }

      const sortedYs = [...rows.keys()].sort((a, b) => b - a)
      for (const y of sortedYs) {
        const spans = rows.get(y)!
        spans.sort((a, b) => a.x - b.x)
        const lineText = spans.map(s => s.text).join(' ').trim()
        if (lineText) allLines.push(lineText)
      }
    }

    const fullText = allLines.join('\n')
    const portfolio = parseCAMSText(fullText)
    return { portfolio }
  } catch (err) {
    return { error: `PDF parsing error: ${err}` }
  }
}
