import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ask,
  getLlmConfig,
  saveLlmConfig,
  clearLlmConfig,
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  type ChatMessage,
} from '../lib/llm'
import { getFund } from '../lib/data'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  usedLlm?: boolean
}

const SUGGESTIONS = [
  'What does “alpha vs peers” mean?',
  'Best small cap funds?',
  'How do you rank funds?',
  'What is max drawdown?',
]

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(!!getLlmConfig())
  const scrollRef = useRef<HTMLDivElement>(null)

  // Detect if we're on a fund page to give the assistant context
  const location = useLocation()
  const fundMatch = location.pathname.match(/\/fund\/(\d+)/)
  const focusFund = fundMatch ? getFund(Number(fundMatch[1])) : undefined

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    const history: ChatMessage[] = msgs.slice(-6).map((m) => ({
      role: m.role,
      content: m.text,
    }))
    const { text: answer, usedLlm } = await ask(q, { focusFund, history })
    setMsgs((m) => [...m, { role: 'assistant', text: answer, usedLlm }])
    setBusy(false)
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700 hover:scale-105"
        >
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l.8-3.2A7.94 7.94 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 flex h-[min(600px,80vh)] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line bg-brand-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-bold leading-tight">FairFund Assistant</div>
                <div className="text-[11px] text-white/70">
                  {focusFund ? `Discussing ${focusFund.name}` : hasKey ? 'AI-powered' : 'Ask about funds & methods'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowSettings((s) => !s)} aria-label="Settings" className="rounded-lg p-1.5 hover:bg-white/20">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 hover:bg-white/20">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {showSettings ? (
            <SettingsPanel
              onClose={() => {
                setShowSettings(false)
                setHasKey(!!getLlmConfig())
              }}
            />
          ) : (
            <>
              {/* Messages */}
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                {msgs.length === 0 && (
                  <div className="text-center">
                    <p className="text-sm text-muted">
                      Hi! Ask me anything about a fund, a metric, or how FairFund works.
                    </p>
                    {!hasKey && (
                      <p className="mt-2 text-xs text-faint">
                        Works instantly with built-in answers. Add your own AI key (⚙️) for fuller,
                        conversational replies.
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s)}
                          className="rounded-full border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-muted hover:border-brand-300 hover:text-brand-600"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                        m.role === 'user'
                          ? 'bg-brand-600 text-white'
                          : 'bg-surface2 text-fg'
                      }`}
                    >
                      {m.text}
                      {m.role === 'assistant' && m.usedLlm === false && (
                        <span className="mt-1 block text-[10px] text-faint">built-in answer</span>
                      )}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-surface2 px-3.5 py-2.5">
                      <div className="flex gap-1">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-faint [animation-delay:-0.3s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-faint [animation-delay:-0.15s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-faint" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-line p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    send(input)
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about a fund or metric…"
                    className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-brand-500"
                  />
                  <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white disabled:opacity-40"
                    aria-label="Send"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </button>
                </form>
                <p className="mt-1.5 text-center text-[10px] text-faint">
                  Not investment advice. Answers are grounded in FairFund data.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const existing = getLlmConfig()
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? DEFAULT_ENDPOINT)
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '')
  const [model, setModel] = useState(existing?.model ?? DEFAULT_MODEL)
  const [saved, setSaved] = useState(false)

  function save() {
    if (apiKey.trim()) {
      saveLlmConfig({ endpoint: endpoint.trim(), apiKey: apiKey.trim(), model: model.trim() })
      setSaved(true)
      setTimeout(onClose, 700)
    }
  }
  function remove() {
    clearLlmConfig()
    setApiKey('')
    onClose()
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h3 className="font-bold text-fg">AI Settings (optional)</h3>
      <p className="mt-1 text-xs text-muted">
        FairFund’s assistant works instantly — no key, no setup — using our built-in engine grounded
        in the fund data. Prefer fuller, conversational replies? Add <strong>your own</strong> AI key
        below. It’s stored <strong>only in this browser</strong> and sent only to the provider you
        choose — never to us.
      </p>

      <label className="mt-4 block text-xs font-semibold text-muted">API Endpoint</label>
      <input
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-brand-500"
      />
      <p className="mt-1 text-[10px] text-faint">OpenAI-compatible. e.g. OpenAI, OpenRouter, Groq, Together.</p>

      <label className="mt-3 block text-xs font-semibold text-muted">API Key</label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="sk-…"
        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-brand-500"
      />

      <label className="mt-3 block text-xs font-semibold text-muted">Model</label>
      <input
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-brand-500"
      />

      <div className="mt-5 flex items-center gap-2">
        <button onClick={save} className="btn-primary flex-1 py-2 text-sm">
          {saved ? 'Saved ✓' : 'Save key'}
        </button>
        {existing && (
          <button onClick={remove} className="btn-ghost py-2 text-sm">
            Remove
          </button>
        )}
        <button onClick={onClose} className="btn-ghost py-2 text-sm">
          Back
        </button>
      </div>

      <div className="mt-4 rounded-lg bg-amber-50 p-3 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        Tip: a key with usage limits is safest. Your browser talks to the AI provider directly, so
        your key never passes through FairFund’s servers (there aren’t any — it’s a static site).
      </div>
    </div>
  )
}
