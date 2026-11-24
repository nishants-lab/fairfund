/** Motion for the holdings report: one orchestrated reveal, bars that grow from zero,
 * a count-up on the headline number. Everything is static under reduced motion. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LazyMotion, domAnimation, m, useReducedMotion, animate, useInView } from 'motion/react'

export const EASE = [0.16, 1, 0.3, 1] as const

export function MotionRoot({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation} strict>{children}</LazyMotion>
}

/** A section that rises in once when it scrolls into view. */
export function Reveal({ children, className = '', delay = 0, as = 'section', id }: { children: ReactNode; className?: string; delay?: number; as?: 'section' | 'div'; id?: string }) {
  const reduce = useReducedMotion()
  const Tag = as === 'div' ? m.div : m.section
  return (
    <Tag id={id} className={className}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.6, ease: EASE, delay }}>
      {children}
    </Tag>
  )
}

/** Counts up to `value` once visible; the final text is always what screen readers get. */
export function CountUp({ value, format, className = '' }: { value: number; format: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [shown, setShown] = useState(reduce ? value : 0)
  useEffect(() => {
    if (reduce) { setShown(value); return }
    if (!inView) return
    const c = animate(0, value, { duration: 1.1, ease: EASE, onUpdate: setShown })
    return () => c.stop()
  }, [value, inView, reduce])
  return (
    <span ref={ref} className={className}>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden="true">{format(shown)}</span>
    </span>
  )
}

/** A horizontal bar that grows from its origin with scaleX (no layout animation),
 * once on first view and again whenever its value changes. */
export function GrowBar({ fraction, className, origin = 'left', delay = 0 }: { fraction: number; className: string; origin?: 'left' | 'right'; delay?: number }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const f = Math.max(0, Math.min(1, fraction))
  return (
    <span ref={ref} className="relative block h-full w-full">
      <m.span className={`absolute inset-y-0 ${origin === 'left' ? 'left-0' : 'right-0'} block w-full rounded-[3px] ${className}`}
        style={{ transformOrigin: origin }}
        initial={reduce ? { scaleX: f } : { scaleX: 0 }}
        animate={{ scaleX: inView || reduce ? f : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.7, ease: EASE, delay }} />
    </span>
  )
}

export { m, useReducedMotion, useInView }
