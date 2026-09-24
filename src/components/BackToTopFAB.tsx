import { useState, useEffect } from 'react'

export default function BackToTopFAB() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 600)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label='Scroll to top'
      className='fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-lg transition hover:bg-surface2 hover:text-fg'
    >
      <svg className='h-4 w-4' fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth={2.5}>
        <path strokeLinecap='round' strokeLinejoin='round' d='M5 15l7-7 7 7' />
      </svg>
    </button>
  )
}
