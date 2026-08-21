// The PIN session: unlock, lock, and read the token.
//
// THREAT MODEL, stated plainly (brief §Auth): a single shared 4-digit PIN gates score
// entry and /admin for a four-person golf trip. Online verification happens server-side in
// the pin-verify Edge Function (argon2id + per-IP throttling); the browser never sees the
// argon2 hash. What is stored here is an opaque 256-bit session token whose digest -- not
// the token -- lives in the server's `sessions` table.
//
// The token lives in Dexie, NOT sessionStorage: sessionStorage does not survive a
// force-quit, and force-quitting in a cart is normal. Expiry runs through the end of the
// trip and no further.
//
// OFFLINE unlock (Phase 6b). A device that has unlocked online once caches a bcrypt hash of
// the PIN (returned by the Edge Function, disclosed only to someone who already proved they
// know it — docs/spec/decisions.md §"PIN size and hash"). With no signal, `unlockOffline`
// verifies the entered PIN against that hash and grants a LOCAL session. That session
// unlocks the UI but holds no server token, so token-gated writes wait for an online
// unlock. This is the iOS install-then-unlock case: the installed PWA has its own storage,
// and the first tee has no signal.
import { compare } from 'bcryptjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase'
import { requestPersistentStorage } from '@/lib/storage'

export const SESSION_ID = 'current'

/** Where the cached offline bcrypt hash lives. Survives lock() on purpose — locking a
 *  device should not disable its ability to unlock again offline. */
const PIN_HASH_KEY = 'auth.pin_bcrypt_hash'

/** Offline sessions have no server expiry to echo, so they borrow the trip's end. Matches
 *  the Edge Function's DEFAULT_EXPIRES_AT and is overridable the same way. */
const TRIP_EXPIRES_AT =
  import.meta.env.VITE_APP_SESSION_EXPIRES_AT ?? '2027-02-08T23:59:59-05:00'

/** Thrown by unlock()/unlockOffline(). `retryAfter` is set only when the server throttles;
 *  `networkFailed` is set when the request never reached the server (offline-fallback cue). */
export class UnlockError extends Error {
  retryAfter?: number
  networkFailed?: boolean
  constructor(message: string, opts: { retryAfter?: number; networkFailed?: boolean } = {}) {
    super(message)
    this.name = 'UnlockError'
    this.retryAfter = opts.retryAfter
    this.networkFailed = opts.networkFailed
  }
}

/** Online unlock via the Edge Function. Mints a real server token and caches the offline hash. */
export async function unlock(pin: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/pin-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ pin }),
    })
  } catch {
    // No signal. If this device has unlocked before, the caller can fall back to
    // unlockOffline(); say so rather than "Incorrect PIN".
    throw new UnlockError('No connection. Unlocking needs a signal — try again on wifi.', {
      networkFailed: true,
    })
  }

  const body = (await res.json().catch(() => ({}))) as {
    token?: string
    expires_at?: string
    error?: string
    retry_after?: number
    pin_bcrypt_hash?: string | null
  }

  if (!res.ok || !body.token || !body.expires_at) {
    throw new UnlockError(body.error ?? 'Could not unlock.', { retryAfter: body.retry_after })
  }

  await db.session.put({
    id: SESSION_ID,
    token: body.token,
    expires_at: body.expires_at,
    unlocked_at: new Date().toISOString(),
    offline: false,
  })
  // Cache the hash so this device can unlock offline next time. Never overwrite a good hash
  // with null (an older function deploy that didn't return one).
  if (typeof body.pin_bcrypt_hash === 'string' && body.pin_bcrypt_hash.length > 0) {
    await db.sync_meta.put({ key: PIN_HASH_KEY, value: body.pin_bcrypt_hash })
  }
  void requestPersistentStorage()
}

/** Has this device ever unlocked online (so an offline unlock is possible)? */
export async function hasOfflineHash(): Promise<boolean> {
  const row = await db.sync_meta.get(PIN_HASH_KEY)
  return typeof row?.value === 'string' && row.value.length > 0
}

/**
 * Offline unlock: verify the PIN against the cached bcrypt hash, no network. Grants a local
 * session with NO server token. Throws if the device has never unlocked online, or the PIN
 * is wrong.
 */
export async function unlockOffline(pin: string): Promise<void> {
  const row = await db.sync_meta.get(PIN_HASH_KEY)
  const hash = typeof row?.value === 'string' ? row.value : null
  if (!hash) {
    throw new UnlockError('This device has never unlocked. Connect to wifi once, then it works offline.')
  }
  const ok = await compare(pin, hash).catch(() => false)
  if (!ok) throw new UnlockError('Incorrect PIN.')

  await db.session.put({
    id: SESSION_ID,
    token: '',
    expires_at: TRIP_EXPIRES_AT,
    unlocked_at: new Date().toISOString(),
    offline: true,
  })
  void requestPersistentStorage()
}

export async function lock(): Promise<void> {
  await db.session.delete(SESSION_ID)
}

/**
 * The token for a token-gated write, or null if there is none. An offline session has no
 * server token, so it returns null and the caller (admin RPCs, the round_player flush)
 * treats it as "not authenticated to the server yet." Expired rows self-clear.
 */
export async function readToken(): Promise<string | null> {
  const row = await db.session.get(SESSION_ID)
  if (!row) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await lock()
    return null
  }
  return row.token && !row.offline ? row.token : null
}

export interface SessionState {
  unlocked: boolean
  /** True when unlocked locally with no server token — token-gated writes still can't run. */
  offline: boolean
  expiresAt: string | null
  unlockedAt: string | null
}

const LOCKED: SessionState = { unlocked: false, offline: false, expiresAt: null, unlockedAt: null }

export function useSession(): SessionState | undefined {
  return useLiveQuery(async () => {
    const row = await db.session.get(SESSION_ID)
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) return LOCKED
    return {
      unlocked: true,
      offline: row.offline === true,
      expiresAt: row.expires_at,
      unlockedAt: row.unlocked_at,
    }
  }, [])
}

/** Ask for persistent storage if we already hold a session (e.g. app cold-start). */
export async function ensurePersistedIfUnlocked(): Promise<void> {
  const row = await db.session.get(SESSION_ID)
  if (row) void requestPersistentStorage()
}
