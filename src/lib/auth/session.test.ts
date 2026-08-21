// Offline PIN unlock (Phase 6b). The online path (unlock) goes through the Edge Function
// and is covered end-to-end by scripts/verify-write-path.sh; here we cover the LOCAL
// bcrypt fallback and the token semantics it hangs off, with no network in the loop.
import { beforeEach, describe, expect, it } from 'vitest'
import { hashSync } from 'bcryptjs'
import { db } from '@/lib/db'
import {
  SESSION_ID,
  hasOfflineHash,
  lock,
  readToken,
  unlockOffline,
  UnlockError,
} from './session'

const PIN = '1922'
const HASH_KEY = 'auth.pin_bcrypt_hash'

beforeEach(async () => {
  await Promise.all([db.session.clear(), db.sync_meta.clear()])
})

describe('unlockOffline', () => {
  it('refuses when the device has never unlocked online', async () => {
    expect(await hasOfflineHash()).toBe(false)
    await expect(unlockOffline(PIN)).rejects.toBeInstanceOf(UnlockError)
    expect(await db.session.get(SESSION_ID)).toBeUndefined()
  })

  it('accepts the right PIN against the cached hash and grants a tokenless session', async () => {
    await db.sync_meta.put({ key: HASH_KEY, value: hashSync(PIN, 10) })
    expect(await hasOfflineHash()).toBe(true)

    await unlockOffline(PIN)
    const row = await db.session.get(SESSION_ID)
    expect(row?.offline).toBe(true)
    expect(row?.token).toBe('')
    // An offline session has no server token — token-gated writes must wait for online.
    expect(await readToken()).toBeNull()
  })

  it('rejects the wrong PIN', async () => {
    await db.sync_meta.put({ key: HASH_KEY, value: hashSync(PIN, 10) })
    await expect(unlockOffline('0000')).rejects.toThrow(/incorrect/i)
    expect(await db.session.get(SESSION_ID)).toBeUndefined()
  })
})

describe('readToken', () => {
  it('returns the token for a live online session', async () => {
    await db.session.put({
      id: SESSION_ID,
      token: 'tok-xyz',
      expires_at: '2999-01-01T00:00:00Z',
      unlocked_at: '2027-02-04T00:00:00Z',
      offline: false,
    })
    expect(await readToken()).toBe('tok-xyz')
  })

  it('self-clears and returns null for an expired session', async () => {
    await db.session.put({
      id: SESSION_ID,
      token: 'tok-old',
      expires_at: '2000-01-01T00:00:00Z',
      unlocked_at: '1999-01-01T00:00:00Z',
      offline: false,
    })
    expect(await readToken()).toBeNull()
    expect(await db.session.get(SESSION_ID)).toBeUndefined()
  })

  it('preserves the offline hash across a lock so the device can re-unlock offline', async () => {
    await db.sync_meta.put({ key: HASH_KEY, value: hashSync(PIN, 10) })
    await unlockOffline(PIN)
    await lock()
    expect(await db.session.get(SESSION_ID)).toBeUndefined()
    expect(await hasOfflineHash()).toBe(true) // the hash outlives the session
  })
})
