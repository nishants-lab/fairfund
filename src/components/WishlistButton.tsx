import { useWishlisted } from '../lib/wishlist'

interface Props {
  code: number
  /** Render as a compact icon-only button (for table rows) */
  compact?: boolean
  className?: string
}

export default function WishlistButton({ code, compact, className = '' }: Props) {
  const [wishlisted, toggle] = useWishlisted(code)

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        toggle()
      }}
      aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-pressed={wishlisted}
      title={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      className={`
        relative inline-flex items-center justify-center transition-all
        ${compact
          ? 'h-8 w-8'
          : 'h-10 w-10 rounded-lg border border-line hover:border-rose-300 dark:hover:border-rose-700'
        }
        before:absolute before:-inset-[6px] before:content-['']
        ${wishlisted
          ? 'text-rose-500 dark:text-rose-400'
          : 'text-muted hover:text-rose-400 dark:hover:text-rose-500'
        }
        ${className}
      `}
    >
      <svg
        viewBox="0 0 24 24"
        className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} transition-transform ${wishlisted ? 'scale-110' : 'scale-100'}`}
        fill={wishlisted ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={wishlisted ? 0 : 1.8}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
        />
      </svg>
    </button>
  )
}
