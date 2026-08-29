import { useSyncExternalStore } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { getReachability, subscribeReachability } from '@/lib/sync/reachability'
import { useSyncSnapshot } from '@/lib/sync/engine'

/**
 * Connection and sync state. Two facts, in the order that matters in a cart:
 *
 *   1. is anything still owed to the server, and
 *   2. can we reach it.
 *
 * The pending count outranks the link state — a scorer needs to know their round is still
 * only on this phone far more than they need to know the wifi came back. It is shown
 * whenever the outbox is non-empty and disappears the moment it drains, which is the
 * "brief confirmation when it drains" the brief asks for.
 *
 * Reachability comes from the probe (src/lib/sync/reachability.ts), never from
 * `navigator.onLine` alone — until the first probe answers, the OS's link state stands in.
 */
export function ConnectionBadge() {
  const link = useOnlineStatus()
  const reach = useSyncExternalStore(subscribeReachability, getReachability, getReachability)
  const { pending, deadLetter } = useSyncSnapshot()

  const online = reach === 'unknown' ? link : reach === 'online'
  const label =
    deadLetter > 0
      ? `${deadLetter} stuck`
      : pending > 0
        ? `${pending} to sync`
        : online
          ? 'Online'
          : 'Offline'
  const dot = deadLetter > 0 ? 'bg-gold-bright' : pending > 0 ? 'bg-gold-fill' : online ? 'bg-olive' : 'bg-gold-fill'

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-paper-faint tnum"
      role="status"
      aria-live="polite"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  )
}
