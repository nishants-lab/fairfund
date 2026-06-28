import { Link } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'

export default function NotFound() {
  usePageMeta('Page not found')
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center">
      <div className="text-6xl font-extrabold text-brand-200 dark:text-brand-900">404</div>
      <h1 className="mt-4 text-2xl font-bold text-fg">Page not found</h1>
      <p className="mt-2 text-muted">
        The page you're looking for doesn't exist or may have been moved.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link to="/" className="btn-primary px-5 py-2 text-sm">
          Go home
        </Link>
        <Link to="/explore" className="btn-ghost px-5 py-2 text-sm">
          Explore funds
        </Link>
      </div>
    </div>
  )
}
