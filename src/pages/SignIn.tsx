import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { useAuth } from '../lib/auth'

export default function SignIn() {
  usePageMeta('Sign In', 'Sign in to sync your wishlist and portfolio across devices.')
  const { user, enabled, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Already signed in
  if (user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-900/20">
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-brand-600" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-fg">You're signed in</h1>
        <p className="mt-2 text-muted">{user.email}</p>
        <div className="mt-6 flex flex-col gap-3">
          <Link to="/wishlist" className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
            Go to Wishlist
          </Link>
          <button onClick={signOut} className="text-sm text-muted hover:text-fg transition">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  // Auth not configured (no Supabase env vars)
  if (!enabled) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-900/20">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-amber-500" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-fg">Sign-in Coming Soon</h1>
          <p className="mt-3 text-muted">
            We're setting up accounts so you can sync your wishlist and portfolio across devices.
            For now, your data is saved locally on this browser.
          </p>

          {/* Benefits preview */}
          <div className="mt-8 text-left">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">What you'll get</h2>
            <div className="mt-3 space-y-3">
              {BENEFITS.map((b) => (
                <div key={b.title} className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                    {b.icon}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-fg">{b.title}</div>
                    <div className="text-xs text-muted">{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Link to="/explore" className="mt-8 inline-block text-sm font-medium text-brand-600 hover:underline">
            Continue exploring funds
          </Link>
        </div>
      </div>
    )
  }

  // Sign-in form
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const result = mode === 'signin'
      ? await signInWithEmail(email, password)
      : await signUpWithEmail(email, password)
    setSubmitting(false)
    if (result.error) {
      setError(result.error)
    } else if (mode === 'signup') {
      setError(null)
      // Show confirmation message for signup
      setMode('signin')
      setError('Check your email to confirm your account, then sign in.')
    } else {
      navigate('/wishlist')
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-2xl border border-line bg-surface p-8">
        <h1 className="text-center text-2xl font-bold text-fg">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="mt-1 text-center text-sm text-muted">
          {mode === 'signin' ? 'Sign in to sync your data across devices' : 'Free forever for core features'}
        </p>

        {/* Google OAuth */}
        <button
          onClick={signInWithGoogle}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm font-medium text-fg transition hover:bg-surface2 active:scale-[0.98]"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-line" />
          <span className="text-xs text-faint">or</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        {/* Email form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-fg">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-fg placeholder:text-faint focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-fg">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-fg placeholder:text-faint focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              placeholder="At least 6 characters"
            />
          </div>

          {error && (
            <div className={`rounded-lg px-4 py-2.5 text-sm ${
              error.includes('Check your email')
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300'
            }`}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50 active:scale-[0.98]"
          >
            {submitting ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {/* Toggle mode */}
        <p className="mt-6 text-center text-sm text-muted">
          {mode === 'signin' ? (
            <>Don't have an account?{' '}
              <button onClick={() => { setMode('signup'); setError(null) }} className="font-medium text-brand-600 hover:underline">
                Sign up free
              </button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button onClick={() => { setMode('signin'); setError(null) }} className="font-medium text-brand-600 hover:underline">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>

      {/* Benefits below the form */}
      <div className="mt-8 px-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">Why sign in?</h2>
        <div className="mt-3 space-y-3">
          {BENEFITS.map((b) => (
            <div key={b.title} className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                {b.icon}
              </div>
              <div>
                <div className="text-sm font-semibold text-fg">{b.title}</div>
                <div className="text-xs text-muted">{b.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const BENEFITS = [
  {
    title: 'Sync across devices',
    desc: 'Your wishlist and portfolio follow you everywhere.',
    icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>,
  },
  {
    title: 'Portfolio tracking',
    desc: 'Upload your CAS statement and track performance over time.',
    icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>,
  },
  {
    title: 'Never lose your data',
    desc: 'Clearing browser cache won\'t wipe your saved funds.',
    icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>,
  },
  {
    title: 'Personalized alerts',
    desc: 'Get notified when a fund you track changes rank significantly.',
    icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /></svg>,
  },
]
