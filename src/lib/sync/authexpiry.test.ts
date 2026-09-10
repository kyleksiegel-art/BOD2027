// Regression for audit finding F-021: a tee change queued on a session the server no longer
// accepts must NOT burn retry attempts toward dead letter. The refusal is about the token,
// not the payload — so the entry stays queued at zero cost, the dead local session is
// cleared (PinGate re-prompts), and the next unlock's flush sends it untouched.
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetClientIdCache } from '@/lib/clientId'
import { FakeServer } from '@/test/fakeServer'
import { resetClockCache } from './clock'
import { enqueueRoundPlayer, flushOutbox, setTransport, TransportError, isAuthRefusal, type Transport } from './outbox'
import { SESSION_ID } from '@/lib/auth/session'
import type { RoundPlayerPayload } from '@/lib/data/types'

const ROUND = 'aaaaaaaa-0000-0000-0000-000000000001'
const JON = 'bbbbbbbb-0000-0000-0000-00000000000a'
const TEE = 'cccccccc-0000-0000-0000-00000000000t'

async function giveToken(token = 'tok-123'): Promise<void> {
  await db.session.put({
    id: SESSION_ID,
    token,
    expires_at: '2027-02-08T23:59:59-05:00',
    unlocked_at: '2027-02-04T12:00:00-05:00',
    offline: false,
  })
}

const payload: RoundPlayerPayload = {
  round_id: ROUND, player_id: JON, tee_id: TEE, index_used: 10, allowance_used: 1, cap_used: 18,
  status: 'did_not_play', manual_override: null,
}

/** A server that answers every token-gated call the way fn_require_session does. */
const expiredSessionTransport: Transport = {
  async call() {
    throw new TransportError('invalid or expired session')
  },
}

beforeEach(async () => {
  await Promise.all([db.outbox.clear(), db.dead_letter.clear(), db.round_players.clear(), db.tees.clear(), db.session.clear(), db.sync_meta.clear()])
  await db.tees.put({ id: TEE, course_id: 'x', name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 6500 })
  resetClockCache()
  localStorage.setItem('bod2027.client_id', '11111111-1111-1111-1111-111111111111')
  resetClientIdCache()
})

describe('an expired session during a round_player flush', () => {
  it('recognises the server refusal vocabulary', () => {
    expect(isAuthRefusal('invalid or expired session')).toBe(true)
    expect(isAuthRefusal('28000')).toBe(true)
    expect(isAuthRefusal('tee_not_found')).toBe(false)
  })

  it('costs no attempt, keeps the entry queued, clears the dead session, and reports it', async () => {
    await giveToken()
    setTransport(expiredSessionTransport)
    await enqueueRoundPlayer([payload])

    const report = await flushOutbox()
    expect(report.authExpired).toBe(true)
    expect(report.deadLettered).toBe(0)
    expect(report.remaining).toBe(1)
    expect(report.message).toMatch(/session/i)

    const [entry] = await db.outbox.toArray()
    expect(entry.attempts).toBe(0)
    expect(await db.dead_letter.count()).toBe(0)
    // The local session is gone, so PinGate asks again instead of pretending.
    expect(await db.session.get(SESSION_ID)).toBeUndefined()

    // Eight more flushes with no session: still deferred, still zero attempts.
    for (let i = 0; i < 8; i++) await flushOutbox()
    expect((await db.outbox.toArray())[0].attempts).toBe(0)
    expect(await db.dead_letter.count()).toBe(0)
  })

  it('sends the same entry after the next unlock', async () => {
    await giveToken()
    setTransport(expiredSessionTransport)
    await enqueueRoundPlayer([payload])
    await flushOutbox()
    expect(await db.outbox.count()).toBe(1)

    // A fresh unlock mints a new token and the network is back to normal.
    const server = new FakeServer()
    setTransport(server.transport)
    await giveToken('tok-456')
    const report = await flushOutbox()
    expect(report.authExpired).toBeFalsy()
    expect(report.sent).toBe(1)
    expect(await db.outbox.count()).toBe(0)
    const row = await db.round_players.get([ROUND, JON])
    expect(row?.status).toBe('did_not_play')
  })
})
