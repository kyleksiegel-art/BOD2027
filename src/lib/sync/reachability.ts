// `navigator.onLine` reports LINK state, not reachability. On iOS it reports true on a dead
// cell, on hotel wifi behind a captive portal, and on a cart parked between two towers on
// the back nine — all situations this app will actually be in. So the badge is never
// allowed to say "Online" on `navigator.onLine` alone.
//
// Truth is one cheap HEAD against the REST root with a 3-second timeout
// (docs/spec/decisions.md §"Reachability probe"). `navigator.onLine === false` is still
// trusted immediately in the negative direction — the OS is right when it says there is no
// link, and probing then would just burn 3 seconds.
//
// Two consecutive flush failures also trip the state back to Offline: a probe that succeeds
// while writes keep failing is not a connection anyone can use.
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase'

export type Reachability = 'online' | 'offline' | 'unknown'

const PROBE_TIMEOUT_MS = 3_000
const FAILURES_TO_TRIP = 2

let state: Reachability = 'unknown'
let consecutiveFlushFailures = 0
const listeners = new Set<() => void>()

export function getReachability(): Reachability {
  return state
}

export function subscribeReachability(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function set(next: Reachability): void {
  if (next === state) return
  state = next
  for (const l of listeners) l()
}

/** One HEAD against the REST root. Resolves the answer and publishes it. */
export async function probe(): Promise<Reachability> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    set('offline')
    return 'offline'
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    // A 4xx is still an answer from Supabase: the route exists and the network works.
    await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: supabaseAnonKey },
      signal: controller.signal,
      cache: 'no-store',
    })
    consecutiveFlushFailures = 0
    set('online')
    return 'online'
  } catch {
    set('offline')
    return 'offline'
  } finally {
    clearTimeout(timer)
  }
}

/** Told by the sync engine after every flush. Two failures in a row means Offline. */
export function noteFlushOutcome(ok: boolean): void {
  if (ok) {
    consecutiveFlushFailures = 0
    set('online')
    return
  }
  consecutiveFlushFailures += 1
  if (consecutiveFlushFailures >= FAILURES_TO_TRIP) set('offline')
}

/** Test seam. */
export function resetReachability(): void {
  state = 'unknown'
  consecutiveFlushFailures = 0
}
