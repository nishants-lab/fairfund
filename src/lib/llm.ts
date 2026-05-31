/**
 * Flexible LLM client for FairFund.
 *
 * Design goals:
 * - Works on a static host (GitHub Pages) with NO backend.
 * - Useful out-of-the-box via a built-in, deterministic fallback that answers
 *   from the fund dataset + methodology text (no API key needed).
 * - Upgrades to a real LLM when the user supplies their own API key, stored
 *   ONLY in their browser localStorage (never committed, never sent anywhere
 *   except the provider they chose).
 *
 * Supported providers use the OpenAI-compatible chat-completions shape, which
 * covers OpenAI, OpenRouter, Groq, Together, and most gateways.
 */

import { funds, data } from './data'
import type { Fund } from '../types'

export interface LlmConfig {
  endpoint: string
  apiKey: string
  model: string
}

const STORE_KEY = 'ff-llm-config'

export function getLlmConfig(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as LlmConfig
    if (cfg.apiKey && cfg.endpoint && cfg.model) return cfg
    return null
  } catch {
    return null
  }
}

export function saveLlmConfig(cfg: LlmConfig) {
  localStorage.setItem(STORE_KEY, JSON.stringify(cfg))
}

export function clearLlmConfig() {
  localStorage.removeItem(STORE_KEY)
}

export const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
export const DEFAULT_MODEL = 'gpt-4o-mini'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Build a compact knowledge context the model can ground its answers in.
 * We keep it small to stay within token limits - top funds per category + the
 * methodology summary.
 */
export function buildKnowledgeContext(focusFund?: Fund): string {
  const lines: string[] = []
  lines.push(`FairFund analyses ${data.totalFunds} active Indian equity mutual funds (Direct-Growth plans).`)
  lines.push(
    `Method: every fund is measured over identical calendar windows (1Y/3Y/5Y ending ${data.anchor}); funds are ranked only within their own category; "alpha vs peers" = a fund's annual return minus its category-median fund's return (manager skill, not just asset-class luck). Scoring uses the geometric mean of within-category percentile ranks across Sharpe, Sortino, Calmar, drawdown protection, alpha and CAGR - no arbitrary weights.`,
  )

  // Category leaders (3Y)
  const byCat = new Map<string, Fund[]>()
  funds.forEach((f) => {
    if (!byCat.has(f.category)) byCat.set(f.category, [])
    byCat.get(f.category)!.push(f)
  })
  lines.push('\nTop funds by category (3Y window, alpha vs peers):')
  byCat.forEach((list, cat) => {
    const top = list
      .filter((f) => f.metrics['3Y'])
      .sort((a, b) => (a.metrics['3Y']!.catRank) - (b.metrics['3Y']!.catRank))
      .slice(0, 3)
    if (top.length === 0) return
    const disp = top[0].categoryDisplay
    const items = top
      .map((f) => `${f.name} (CAGR ${f.metrics['3Y']!.cagr}%, alpha ${f.metrics['3Y']!.alpha >= 0 ? '+' : ''}${f.metrics['3Y']!.alpha}%, Sharpe ${f.metrics['3Y']!.sharpe})`)
      .join('; ')
    lines.push(`- ${disp}: ${items}`)
  })

  if (focusFund) {
    const m = focusFund.metrics['3Y'] ?? focusFund.metrics['5Y'] ?? focusFund.metrics['1Y']
    lines.push(
      `\nFOCUS FUND: ${focusFund.name} (${focusFund.amc}), category ${focusFund.categoryDisplay}, risk ${focusFund.riskLevel}.`,
    )
    if (m) {
      lines.push(
        `Metrics: CAGR ${m.cagr}%, alpha vs peers ${m.alpha >= 0 ? '+' : ''}${m.alpha}%, Sharpe ${m.sharpe}, Sortino ${m.sortino}, max drawdown ${m.maxDrawdown}%, Calmar ${m.calmar}, category rank #${m.catRank} of ${focusFund.categorySize}.`,
      )
    }
    lines.push(`Our take: ${focusFund.verdict}`)
  }

  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are FairFund's assistant - a friendly, plain-spoken guide to Indian mutual fund research.
Rules:
- Be concise and clear. Avoid jargon; when you must use a term (alpha, Sharpe, drawdown), explain it in a few words.
- Ground every answer ONLY in the provided FairFund data/context. If something isn't in the context, say you don't have that data rather than inventing it.
- Never give personalised investment advice or tell someone exactly what to buy. Explain what the data shows and let them decide. Remind them you're not a SEBI-registered adviser when they ask "should I invest".
- Keep answers short (2-5 sentences) unless asked for detail.`

/** Call the real LLM (OpenAI-compatible). Throws on failure. */
export async function callLlm(messages: ChatMessage[], cfg: LlmConfig): Promise<string> {
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.3,
      max_tokens: 600,
    }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`LLM request failed (${res.status}): ${txt.slice(0, 200)}`)
  }
  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM returned no content')
  return content.trim()
}

/**
 * Ask a question. Resolution order:
 *   1. User's own API key (if they added one)  → full conversational AI
 *   2. Built-in deterministic engine  → always works, no key, no server
 * Returns { text, usedLlm, source }.
 */
export async function ask(
  question: string,
  opts: { focusFund?: Fund; history?: ChatMessage[] } = {},
): Promise<{ text: string; usedLlm: boolean; source: 'own-key' | 'builtin' }> {
  const cfg = getLlmConfig()
  const context = buildKnowledgeContext(opts.focusFund)

  // 1. User's own key (optional power-user upgrade)
  if (cfg) {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\n--- FairFund data ---\n${context}` },
        ...(opts.history ?? []),
        { role: 'user', content: question },
      ]
      const text = await callLlm(messages, cfg)
      return { text, usedLlm: true, source: 'own-key' }
    } catch {
      // fall through to built-in
    }
  }

  // 2. Built-in deterministic engine (no key needed)
  return { text: fallbackAnswer(question, opts.focusFund), usedLlm: false, source: 'builtin' }
}

/**
 * Deterministic fallback "assistant" - answers common questions from the data
 * without any API. Pattern-matches the question and composes an answer.
 */
export function fallbackAnswer(question: string, focusFund?: Fund): string {
  const q = question.toLowerCase()

  // Methodology questions
  if (q.includes('alpha')) {
    return `Alpha vs peers is how much a fund beat (or trailed) the *median* fund in its own category, per year, over the same time window. Positive alpha means the manager genuinely added value - not just rode a hot asset class. ${focusFund && focusFund.metrics['3Y'] ? `For ${focusFund.name}, 3Y alpha is ${focusFund.metrics['3Y'].alpha >= 0 ? '+' : ''}${focusFund.metrics['3Y'].alpha}%.` : ''}`
  }
  if (q.includes('sharpe')) {
    return `Sharpe ratio measures return per unit of total risk (volatility). Above 1 is excellent, 0.7-1 is solid. ${focusFund && focusFund.metrics['3Y'] ? `${focusFund.name} has a 3Y Sharpe of ${focusFund.metrics['3Y'].sharpe}.` : ''}`
  }
  if (q.includes('drawdown')) {
    return `Max drawdown is the worst peak-to-trough fall in a period - basically the biggest loss you'd have stomached. Smaller (less negative) is better. ${focusFund && focusFund.metrics['3Y'] ? `${focusFund.name}'s worst 3Y drawdown was ${focusFund.metrics['3Y'].maxDrawdown}%.` : ''}`
  }
  if ((q.includes('how') && q.includes('rank')) || q.includes('methodology') || q.includes('fixed window') || q.includes('how do you')) {
    return `We measure every fund over the exact same dates (so a fund launched at a market low can't look artificially great), rank funds only against others in their own category, and score them on risk-adjusted metrics plus how much they beat their category's median fund. No cherry-picked timeframes, no arbitrary weightings.`
  }
  if (q.includes('should i') || q.includes('safe') || q.includes('buy')) {
    return `I can't tell you what to buy - I'm a research tool, not a SEBI-registered adviser. What I can do is show you the data: rankings, risk-adjusted returns, and how a fund did over any period you pick. Use that to decide, ideally with a qualified advisor.`
  }

  // Fund-specific
  if (focusFund) {
    const m = focusFund.metrics['3Y'] ?? focusFund.metrics['5Y']
    if (m) {
      return `${focusFund.name} is a ${focusFund.categoryDisplay} fund (${focusFund.riskLevel} risk). Over 3 years it returned ${m.cagr}% a year, beat the median ${focusFund.categoryDisplay} fund by ${m.alpha >= 0 ? '+' : ''}${m.alpha}% annually, with a Sharpe of ${m.sharpe} and a worst drop of ${m.maxDrawdown}%. It ranks #${m.catRank} of ${focusFund.categorySize} in its category. ${focusFund.verdict}`
    }
  }

  // Category leader lookups
  const catKeywords: Record<string, string> = {
    'small cap': 'Small Cap',
    smallcap: 'Small Cap',
    'mid cap': 'Mid Cap',
    midcap: 'Mid Cap',
    'large cap': 'Large Cap',
    largecap: 'Large Cap',
    'flexi': 'Flexi Cap',
    'multi cap': 'Multi Cap',
    multicap: 'Multi Cap',
    value: 'Value/Contra',
    elss: 'ELSS',
    'tax saver': 'ELSS',
    focused: 'Focused',
  }
  for (const [kw, cat] of Object.entries(catKeywords)) {
    if (q.includes(kw)) {
      const top = funds
        .filter((f) => f.category === cat && f.metrics['3Y'])
        .sort((a, b) => a.metrics['3Y']!.catRank - b.metrics['3Y']!.catRank)
        .slice(0, 3)
      if (top.length) {
        const disp = top[0].categoryDisplay
        const list = top.map((f, i) => `${i + 1}. ${f.name} (${f.metrics['3Y']!.cagr}% CAGR, alpha ${f.metrics['3Y']!.alpha >= 0 ? '+' : ''}${f.metrics['3Y']!.alpha}%)`).join('  ')
        return `Top ${disp} funds on our 3-year fair-window analysis:  ${list}.  Tap any fund to dig into its full metrics, or analyse it over any custom period.`
      }
    }
  }

  // Default
  return `I can answer questions about how FairFund ranks funds, what metrics like alpha, Sharpe, or drawdown mean, and which funds lead each category. Try asking "what are the best small cap funds?" or "what does alpha mean?". For full AI-powered answers, add your own API key in the chat settings.`
}
