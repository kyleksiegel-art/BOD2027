// A stable per-device identifier. It is half of the comparator tuple
// (client_updated_at_effective, client_id) that decides which of two writes to the same
// cell wins, so it must survive a force-quit in the cart and a reinstall of the app
// within the same browser storage. localStorage is the right home: synchronous (the
// value is needed while building a write payload) and persistent.
//
// This is NOT a session or an identity -- it names a device, nothing more.
const KEY = 'bod2027.client_id'

let cached: string | null = null

export function clientId(): string {
  if (cached) return cached
  let value = localStorage.getItem(KEY)
  if (!value) {
    value = crypto.randomUUID()
    localStorage.setItem(KEY, value)
  }
  cached = value
  return value
}

/**
 * Test seam. The sync tests simulate two phones in one process, and a device identity
 * cached in a module variable is exactly what stops that from being possible.
 */
export function resetClientIdCache(): void {
  cached = null
}
