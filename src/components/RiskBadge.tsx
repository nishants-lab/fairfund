import { riskColor } from '../lib/format'

interface Props {
  level: string
  /** show the word "risk" after the level (e.g. "High risk"). Default true. */
  showWord?: boolean
  /** show a small shield icon. Default true. */
  icon?: boolean
}

/**
 * A self-explanatory risk badge. Includes a shield icon and the word "risk"
 * so users always know the High/Moderate/Very High label refers to risk.
 */
export default function RiskBadge({ level, showWord = true, icon = true }: Props) {
  return (
    <span className={`pill ${riskColor(level)}`} title={`${level} risk`}>
      {icon && (
        <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
        </svg>
      )}
      {level}{showWord ? ' risk' : ''}
    </span>
  )
}
