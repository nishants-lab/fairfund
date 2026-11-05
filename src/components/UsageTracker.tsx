import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { trackUsageRoute } from '../lib/usage'

export default function UsageTracker() {
  const location = useLocation()
  const navigation = useMemo(() => Symbol(), [location])
  useEffect(() => {
    trackUsageRoute(location.pathname, navigation, location.search)
  }, [location.pathname, location.search, navigation])
  return null
}
