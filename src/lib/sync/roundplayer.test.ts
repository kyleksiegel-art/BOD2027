// The third outbox kind: a day-of tee/handicap change (Phase 6b). It differs from score and
// ctp in three ways that need their own coverage:
//   · the optimistic local row is COMPUTED (strokes must be right offline, before any flush)
//   · the flush needs a session token, and DEFERS — never fails — when there isn't one
//   · it rides the same comparator, shield and self-echo as the other two kinds
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetClientIdCache } from '@/lib/clientId'
import { FakeServer } from '@/test/fakeServer'
import { resetClockCache } from './clock'
import { enqueueRoundPlayer, flushOutbox, rpKey, setTransport } from './outbox'
import { applyRoundPlayerEvent } from './realtime'
import { mergeStampedRows } from './merge'
import { SESSION_ID } from '@/lib/auth/session'
import type { RoundPlayerPayload, RoundPlayerRow } from '@/lib/data/types'

const ROUND = 'aaaaaaaa-0000-0000-0000-000000000001'
const JON = 'bbbbbbbb-0000-0000-0000-00000000000a'
const TEE = 'cccccccc-0000-0000-0000-00000000000t'
const DEVICE_A = '11111111-1111-1111-1111-111111111111'
const DEVICE_B = '22222222-2222-2222-2222-222222222222'

let server: FakeServer

function becomeDevice(id: string): void {
  localStorage.setItem('bod2027.client_id', id)
  resetClientIdCache()
}

async function giveToken(token = 'tok-123'): Promise<void> {
  await db.session.put({
    id: SESSION_ID,
    token,
    expires_at: '2027-02-08T23:59:59-05:00',
    unlocked_at: '2027-02-04T12:00:00-05:00',
    offline: false,
  })
}

function payload(overrides: Partial<RoundPlayerPayload> = {}): RoundPlayerPayload {
  return {
    round_id: ROUND,
    player_id: JON,
    tee_id: TEE,
    index_used: 10,
    allowance_used: 1,
    cap_used: 18,
    status: 'playing',
    manual_override: null,
    ...overrides,
  }
}

beforeEach(async () => {
  await Promise.all([
    db.outbox.clear(),
    db.dead_letter.clear(),
    db.round_players.clear(),
    db.tees.clear(),
    db.session.clear(),
    db.sync_meta.clear(),
  ])
  // A neutral tee so computeHandicap is predictable: 10 × (113/113) + (72−72) = 10.
  await db.tees.put({ id: TEE, course_id: 'x', name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 6500 })
  resetClockCache()
  becomeDevice(DEVICE_A)
  server = new FakeServer()
  setTransport(server.transport)
})

describe('enqueueRoundPlayer', () => {
  it('computes the optimistic local row before anything touches the network', async () => {
    server.offline = true
    await enqueueRoundPlayer([payload()])

    const row = await db.round_players.get([ROUND, JON])
    expect(row?.strokes_received).toBe(10)
    expect(row?.playing_handicap).toBe(10)
    expect(row?.client_id).toBe(DEVICE_A)
    expect(server.requests).toBe(0)
    // Queued, waiting.
    expect(await db.outbox.count()).toBe(1)
  })

  it('recomputes strokes when the tee changes, offline', async () => {
    // A harder tee: slope 145, index 10 → 10 × 145/113 = 12.83 → 13 strokes.
    await db.tees.put({ id: 'hard', course_id: 'x', name: 'Black', rating: 75, slope: 145, par: 72, total_yardage: 7300 })
    server.offline = true
    await enqueueRoundPlayer([payload({ tee_id: 'hard' })])
    const row = await db.round_players.get([ROUND, JON])
    // 10*(145/113) + (75-72) = 12.83 + 3 = 15.83 → 16.
    expect(row?.strokes_received).toBe(16)
  })
})

describe('flush', () => {
  it('sends with a session token and clears the queue', async () => {
    await giveToken('tok-abc')
    await enqueueRoundPlayer([payload()])
    const report = await flushOutbox()

    expect(report.status).toBe('idle')
    expect(server.lastToken).toBe('tok-abc')
    expect(server.roundPlayers.get(`${ROUND}|${JON}`)?.index_used).toBe(10)
    expect(await db.outbox.count()).toBe(0)
  })

  it('DEFERS with no token — keeps the entry, counts no attempt, never reaches the server', async () => {
    // No session at all.
    await enqueueRoundPlayer([payload()])
    const report = await flushOutbox()

    expect(server.requests).toBe(0) // nothing was even attempted
    expect(await db.outbox.count()).toBe(1)
    const [entry] = await db.outbox.toArray()
    expect(entry.attempts).toBe(0)
    expect(report.message).toMatch(/waiting to sync/i)
    expect(report.status).toBe('idle') // not offline, not error

    // A token appears (an online unlock) — the same entry now goes out untouched.
    await giveToken()
    await flushOutbox()
    expect(await db.outbox.count()).toBe(0)
    expect(server.roundPlayers.has(`${ROUND}|${JON}`)).toBe(true)
  })

  it('an offline-only session (empty token) also defers', async () => {
    await db.session.put({
      id: SESSION_ID,
      token: '',
      expires_at: '2027-02-08T23:59:59-05:00',
      unlocked_at: '2027-02-04T12:00:00-05:00',
      offline: true,
    })
    await enqueueRoundPlayer([payload()])
    await flushOutbox()
    expect(server.requests).toBe(0)
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('convergence', () => {
  it("a stale server round_player never overwrites this device's newer local change", async () => {
    // Local device queues a tee change (newer).
    await enqueueRoundPlayer([payload({ index_used: 12 })])
    const local = await db.round_players.get([ROUND, JON])

    // A routine refetch brings back an OLDER stamped row from the server.
    const stale: RoundPlayerRow = {
      round_id: ROUND,
      player_id: JON,
      tee_id: TEE,
      index_used: 3,
      allowance_used: 1,
      cap_used: 18,
      course_handicap: 3,
      playing_handicap: 3,
      cap_applied: false,
      strokes_received: 3,
      manual_override: null,
      status: 'playing',
      client_updated_at_raw: '2020-01-01T00:00:00.000Z',
      client_updated_at_effective: '2020-01-01T00:00:00.000Z',
      client_id: DEVICE_B,
    }
    await mergeStampedRows({ scores: [], ctp_results: [], round_players: [stale] })

    const after = await db.round_players.get([ROUND, JON])
    expect(after?.index_used).toBe(local?.index_used) // unchanged — the shield held
  })

  it('a covering self-echo clears the pending entry', async () => {
    await enqueueRoundPlayer([payload()])
    const [entry] = await db.outbox.toArray()

    // The server echoes our own write back over Realtime with the same stamp.
    await applyRoundPlayerEvent({
      eventType: 'UPDATE',
      new: {
        round_id: ROUND,
        player_id: JON,
        tee_id: TEE,
        index_used: 10,
        allowance_used: 1,
        cap_used: 18,
        course_handicap: 10,
        playing_handicap: 10,
        cap_applied: false,
        strokes_received: 10,
        manual_override: null,
        status: 'playing',
        client_updated_at_raw: entry.ts,
        client_updated_at_effective: entry.ts,
        client_id: DEVICE_A,
      },
    } as never)

    expect(await db.outbox.where('key').equals(rpKey(ROUND, JON)).count()).toBe(0)
  })
})
