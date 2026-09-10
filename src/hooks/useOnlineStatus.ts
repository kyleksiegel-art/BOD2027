import { useEffect } from 'react'
import { useSyncExternalStore } from 'react'
import { getReachability, subscribeReachability, probe } from '@/lib/sync/reachability'

/**
 * Whether the server is actually reachable — the signal /admin gates its writes on.
 *
 * `navigator.onLine` reports LINK state, not reachability: on a dead cell or a captive portal
 * it stays true, which is exactly when an admin write would fail (audit F-017 — this used to
 * be a `navigator.onLine`-only stub, so admin controls looked live on a dead connection). So
 * the answer comes from the reachability probe (src/lib/sync/reachability.ts), the same source
 * the connection badge uses. Until the first probe answers we fall back to the OS's link state
 * — trusting a negative immediately, optimistic on a positive — and kick a probe on mount so
 * "unknown" resolves quickly.
 */
export function useOnlineStatus(): boolean {
  const reach = useSyncExternalStore(subscribeReachability, getReachability, getReachability)

  useEffect(() => {
    void probe()
  }, [])

  if (reach === 'online') return true
  if (reach === 'offline') return false
  return typeof navigator === 'undefined' ? true : navigator.onLine
}
