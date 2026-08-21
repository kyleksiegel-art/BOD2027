// Ask the browser to make our storage persistent, so the OS does not evict Dexie under
// pressure. This matters more here than in most apps: the outbox is the ONLY copy of a
// round played in a dead zone (src/lib/sync/outbox.ts), and a session token plus the whole
// read mirror also live in IndexedDB. Eviction mid-trip would lose unsynced holes.
//
// Called after a PIN unlock (the point at which the browser is most likely to grant it —
// the user has just interacted and, on iOS, an installed PWA is far more likely to be
// granted than a Safari tab). Best-effort and idempotent: a browser that already granted
// it, or one without the API, is a no-op that never throws into a caller.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
