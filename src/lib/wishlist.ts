import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'fairfund_wishlist'

function readWishlist(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is number => typeof v === 'number')
  } catch {
    return []
  }
}

function writeWishlist(codes: number[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(codes))
  // Notify other components via a custom event
  window.dispatchEvent(new CustomEvent('wishlist-change', { detail: codes }))
}

export function isWishlisted(code: number): boolean {
  return readWishlist().includes(code)
}

export function toggleWishlist(code: number): boolean {
  const list = readWishlist()
  const idx = list.indexOf(code)
  if (idx >= 0) {
    list.splice(idx, 1)
    writeWishlist(list)
    return false
  } else {
    list.push(code)
    writeWishlist(list)
    return true
  }
}

export function getWishlistCodes(): number[] {
  return readWishlist()
}

export function getWishlistCount(): number {
  return readWishlist().length
}

/**
 * Hook that reactively tracks wishlist state for a specific fund.
 * Re-renders when any component toggles the wishlist.
 */
export function useWishlisted(code: number): [boolean, () => void] {
  const [wishlisted, setWishlisted] = useState(() => isWishlisted(code))

  useEffect(() => {
    // Sync when other components change the wishlist
    const handler = () => setWishlisted(isWishlisted(code))
    window.addEventListener('wishlist-change', handler)
    return () => window.removeEventListener('wishlist-change', handler)
  }, [code])

  const toggle = useCallback(() => {
    const next = toggleWishlist(code)
    setWishlisted(next)
  }, [code])

  return [wishlisted, toggle]
}

/**
 * Hook that tracks the full wishlist (for the Wishlist page and navbar badge).
 */
export function useWishlist(): number[] {
  const [codes, setCodes] = useState(readWishlist)

  useEffect(() => {
    const handler = () => setCodes(readWishlist())
    window.addEventListener('wishlist-change', handler)
    return () => window.removeEventListener('wishlist-change', handler)
  }, [])

  return codes
}
