// The PIN session: unlock, lock, and read the token.
//
// THREAT MODEL, stated plainly (brief §Auth): a single shared 4-digit PIN gates score
// entry and /admin for a four-person golf trip. Verification happens server-side in the
// pin-verify Edge Function (argon2id + per-IP throttling); the browser never sees the
// PIN hash. What is stored here is an opaque 256-bit session token whose digest -- not
// the token -- lives in the server's `sessions` table.
//
// The token lives in Dexie, NOT sessionStorage: sessionStorage does not survive a
// force-quit, and force-quitting in a cart is normal. Expiry runs through the end of the
// trip and no further.
//
// Offline PIN verification (a locally stored PIN hash, so a device that has already
// unlocked once can unlock again with no signal) is Phase 6. Phase 5 is online-only.
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase'

export const SESSION_ID = 'current'

/** Thrown by unlock(). `retryAfter` is set only when the server is throttling. */
export class UnlockError extends Error {
  retryAfter?: number
  constructor(message: string, retryAfter?: number) {
    super(message)
    this.name = 'UnlockError'
    this.retryAfter = retryAfter
  }
}

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
    // Unlocking is the one thing that genuinely cannot work offline -- a device that has
    // never unlocked must not be able to score. Say that, rather than "Incorrect PIN".
    throw new UnlockError('No connection. Unlocking needs a signal — try again on wifi.')
  }

  const body = (await res.json().catch(() => ({}))) as { token?: string; expires_at?: string; error?: string; retry_after?: number }

  if (!res.ok || !body.token || !body.expires_at) {
    throw new UnlockError(body.error ?? 'Could not unlock.', body.retry_after)
  }

  await db.session.put({
    id: SESSION_ID,
    token: body.token,
    expires_at: body.expires_at,
    unlocked_at: new Date().toISOString(),
  })
}

export async function lock(): Promise<void> {
  await db.session.delete(SESSION_ID)
}

/** The token for a write, or null if there is no live session. Expired rows self-clear. */
export async function readToken(): Promise<string | null> {
  const row = await db.session.get(SESSION_ID)
  if (!row) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await lock()
    return null
  }
  return row.token
}

export interface SessionState {
  unlocked: boolean
  expiresAt: string | null
  unlockedAt: string | null
}

const LOCKED: SessionState = { unlocked: false, expiresAt: null, unlockedAt: null }

export function useSession(): SessionState | undefined {
  return useLiveQuery(async () => {
    const row = await db.session.get(SESSION_ID)
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) return LOCKED
    return { unlocked: true, expiresAt: row.expires_at, unlockedAt: row.unlocked_at }
  }, [])
}
