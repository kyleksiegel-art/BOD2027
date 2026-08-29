// Wiring: what makes a flush happen, and what the UI is told about it.
//
// Flush triggers, from the brief:
//   · `online` going true (backed by a probe — the event fires on link, not reachability)
//   · a successful Realtime (re)subscription        (src/lib/sync/realtime.ts)
//   · app foreground / visibilitychange             — the cart-pocket case
//   · an interval while online
//   · and immediately after a save                  (src/lib/data/mutations.ts)
//
// Mounted once, from the app shell.
import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { flushOutbox } from './outbox'
import { startRealtime } from './realtime'
import { noteFlushOutcome, probe } from './reachability'

const INTERVAL_MS = 60_000

/** Flush, then tell the reachability tracker how it went. */
export async function syncNow(): Promise<void> {
  const outstanding = await db.outbox.count()
  if (outstanding === 0) {
    // Nothing owed: the probe is the only way to learn whether we are reachable.
    await probe()
    return
  }
  const report = await flushOutbox()
  noteFlushOutcome(report.status !== 'offline')
}

/**
 * Start the sync engine. Returns a teardown. Safe to call once per app lifetime; React
 * StrictMode's double-mount is handled by startRealtime()'s own idempotence.
 */
export function startSync(): () => void {
  const stopRealtime = startRealtime()

  const onOnline = () => void syncNow()
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', () => void probe())
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(() => void syncNow(), INTERVAL_MS)

  void syncNow()

  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
    stopRealtime()
  }
}

/** Mount once in the shell. */
export function useSyncEngine(): void {
  useEffect(() => startSync(), [])
}

export interface SyncSnapshot {
  pending: number
  deadLetter: number
}

/**
 * What the badge shows. Straight off Dexie via useLiveQuery like every other read — the
 * pending count is data, not component state.
 */
export function useSyncSnapshot(): SyncSnapshot {
  return (
    useLiveQuery(
      async () => ({ pending: await db.outbox.count(), deadLetter: await db.dead_letter.count() }),
      [],
    ) ?? { pending: 0, deadLetter: 0 }
  )
}
