// The monotonic write clock.
//
// `Date.now()` can move BACKWARDS. An NTP correction when a phone reacquires signal after
// four hours in a dead zone is exactly the moment this app is doing its most important
// work. If the clock jumps back, the device's new writes carry timestamps below its own
// earlier rows, the comparator rejects them as stale on both the server and every other
// phone, and entries silently revert with no error anywhere. That is the single worst bug
// available in this codebase, so the wall clock is never used directly for a write stamp.
//
// Instead: ts = max(Date.now(), lastIssued + 1), with lastIssued persisted in Dexie so it
// also survives a force-quit and a phone restart.
//
// The +1 also makes stamps strictly increasing within a millisecond, so two saves in the
// same frame can't tie and lose to each other on the client_id tie-break.
import { db } from '@/lib/db'

const KEY = 'clock.last_issued_ms'

let lastIssued = 0
let loaded = false

/** Read the high-water mark back out of Dexie. Idempotent; called by nextStamp(). */
async function load(): Promise<void> {
  if (loaded) return
  const row = await db.sync_meta.get(KEY)
  const stored = typeof row?.value === 'number' ? row.value : 0
  lastIssued = Math.max(lastIssued, stored)
  loaded = true
}

/**
 * Issue the next write timestamp as an ISO string. One call per save batch: every cell in
 * a batch shares a stamp, which is correct — they were entered as one act.
 */
export async function nextStamp(): Promise<string> {
  await load()
  const ms = Math.max(Date.now(), lastIssued + 1)
  lastIssued = ms
  // Persisted before the caller can use it: a crash between issuing and writing must not
  // leave the high-water mark behind the stamp already in the outbox.
  await db.sync_meta.put({ key: KEY, value: ms })
  return new Date(ms).toISOString()
}

/** Test seam. Forgets the in-memory cache so a fresh Dexie is read again. */
export function resetClockCache(): void {
  lastIssued = 0
  loaded = false
}
