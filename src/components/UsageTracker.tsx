import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { trackUsageRoute } from '../lib/usage'

export default function UsageTracker() {
  const location = useLocation()
  const navigation = useMemo(() => Symbol(), [location])
  useEffect(() => {
    trackUsageRoute(location.pathname, navigation)
  }, [location.pathname, navigation])
  return null
}
