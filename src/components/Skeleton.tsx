/**
 * Shimmer skeleton placeholder. Use while live data (NAV) is loading so the UI
 * feels alive instead of frozen. Pass Tailwind sizing via className.
 */
export default function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}
