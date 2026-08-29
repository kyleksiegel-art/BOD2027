import { useEffect, useState } from 'react'

/**
 * Connection status — STUB for Phase 1.
 *
 * This reflects only `navigator.onLine`, which reports link state, not real
 * reachability. Phase 6 replaces this with a reachability probe (a real fetch
 * against a known endpoint) backing the connection badge, because a phone on
 * hotel wifi with no route to Supabase still reports `onLine === true`.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
