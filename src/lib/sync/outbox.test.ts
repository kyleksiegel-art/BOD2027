import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetClientIdCache } from '@/lib/clientId'
import { FakeServer } from '@/test/fakeServer'
import { resetClockCache } from './clock'
import {
  MAX_ATTEMPTS,
  clearEchoed,
  enqueueCtp,
  enqueueScores,
  flushOutbox,
  retryDeadLetter,
  scoreKey,
  setTransport,
} from './outbox'
import { mergeStampedRows } from './merge'
import { applyScoreEvent } from './realtime'
import type { OutboxEntry, ScorePayload, ScoreRow } from '@/lib/data/types'

const ROUND = 'aaaaaaaa-0000-0000-0000-000000000001'
const JON = 'bbbbbbbb-0000-0000-0000-00000000000a'
const KYLE = 'bbbbbbbb-0000-0000-0000-00000000000b'
const DEVICE_A = '11111111-1111-1111-1111-111111111111'
const DEVICE_B = '22222222-2222-2222-2222-222222222222'

let server: FakeServer

function becomeDevice(id: string): void {
  localStorage.setItem('bod2027.client_id', id)
  resetClientIdCache()
}

function cell(hole: number, gross: number, playerId = JON): ScorePayload {
  return {
    round_id: ROUND,
    player_id: playerId,
    hole_number: hole,
    gross_strokes: gross,
    picked_up: false,
  }
}

/** Force-quit and cold start: the connection goes, the data must not. */
async function forceQuit(): Promise<void> {
  db.close()
  await db.open()
  resetClockCache()
}

beforeEach(async () => {
  await Promise.all([
    db.outbox.clear(),
    db.dead_letter.clear(),
    db.scores.clear(),
    db.ctp_results.clear(),
    db.sync_meta.clear(),
  ])
  resetClockCache()
  becomeDevice(DEVICE_A)
  server = new FakeServer()
  setTransport(server.transport)
})

describe('enqueue', () => {
  it('records the score locally before anything touches the network', async () => {
    server.offline = true
    await enqueueScores([cell(4, 5)])

    const row = await db.scores.get([ROUND, JON, 4])
    expect(row?.gross_strokes).toBe(5)
    // Locally, effective mirrors raw: the client cannot compute the server's clamp, and
    // the server's own row replaces this one on acknowledgement.
    expect(row?.client_updated_at_effective).toBe(row?.client_updated_at_raw)
    expect(row?.client_id).toBe(DEVICE_A)
    expect(await db.outbox.count()).toBe(1)
    expect(server.requests).toBe(0)
  })

  it('keeps the server id when a cell is edited again, so the row never forks', async () => {
    await enqueueScores([cell(4, 5)])
    await flushOutbox()
    const first = await db.scores.get([ROUND, JON, 4])

    await enqueueScores([cell(4, 6)])
    const second = await db.scores.get([ROUND, JON, 4])
    expect(second?.id).toBe(first?.id)
    expect(await db.scores.where({ round_id: ROUND }).count()).toBe(1)
  })
})

describe('flush', () => {
  it('sends a queued hole and clears it once the server acknowledges', async () => {
    await enqueueScores([cell(1, 4), cell(1, 5, KYLE)])
    const report = await flushOutbox()

    expect(report.status).toBe('idle')
    expect(report.sent).toBe(2)
    expect(await db.outbox.count()).toBe(0)
    expect(server.scores.size).toBe(2)
  })

  it('sends only the LATEST entry per cell — five stepper taps are one write', async () => {
    for (const gross of [4, 5, 6, 7, 8]) await enqueueScores([cell(7, gross)])
    expect(await db.outbox.count()).toBe(5)

    await flushOutbox()

    expect(server.received).toHaveLength(1)
    expect(server.received[0].gross_strokes).toBe(8)
    expect(server.scores.get(`${ROUND}|${JON}|7`)?.gross_strokes).toBe(8)
    expect(await db.outbox.count()).toBe(0)
  })

  it('replaying the same item twice produces one row, not two', async () => {
    await enqueueScores([cell(3, 4)])
    const entry = (await db.outbox.toArray())[0]
    await flushOutbox()

    // Re-queue the identical entry, stamp and all — the shape a duplicated replay takes.
    await db.outbox.add({ ...entry, seq: undefined } as OutboxEntry)
    const second = await flushOutbox()

    // The guard rejects an exact (timestamp, client_id) tie, so the replay settles as
    // 'stale' rather than writing a second time. Either way: one row.
    expect(second.sent).toBe(1)
    expect(server.scores.size).toBe(1)
    expect(await db.scores.where({ round_id: ROUND }).count()).toBe(1)
  })

  it('does not undo a Realtime row that landed while the request was in flight', async () => {
    server.offline = true
    await enqueueScores([cell(1, 5)])

    // Another phone's write arrives before our own flush response does.
    await db.scores.put({
      id: 'srv-1',
      round_id: ROUND,
      player_id: JON,
      hole_number: 1,
      gross_strokes: 9,
      picked_up: false,
      client_updated_at_raw: '2099-01-01T00:00:00.000Z',
      client_updated_at_effective: '2099-01-01T00:00:00.000Z',
      client_id: DEVICE_B,
    })

    server.offline = false
    await flushOutbox()

    // Our write reached the server, but the response is a snapshot of an older moment and
    // must not win on recency alone.
    expect((await db.scores.get([ROUND, JON, 1]))?.gross_strokes).toBe(9)
  })

  it('writes the server’s own row back, clamp included', async () => {
    // A phone whose clock is an hour fast. The server clamps effective to now + 5 min; the
    // client must adopt that, or its local row wins comparisons it should lose forever.
    server.now = '2027-02-06T20:00:00.000Z'
    await enqueueScores([cell(2, 4)])
    await db.outbox.toCollection().modify({ ts: '2027-02-06T21:00:00.000Z' })
    await flushOutbox()

    const row = await db.scores.get([ROUND, JON, 2])
    expect(row?.client_updated_at_raw).toBe('2027-02-06T21:00:00.000Z')
    expect(row?.client_updated_at_effective).toBe('2027-02-06T20:05:00.000Z')
  })
})

describe('offline', () => {
  it('costs no attempts and loses nothing — four hours in a dead zone', async () => {
    server.offline = true
    for (let hole = 1; hole <= 18; hole += 1) await enqueueScores([cell(hole, 4)])

    // Every flush trigger the engine has, firing against no network.
    for (let i = 0; i < 6; i += 1) {
      const report = await flushOutbox()
      expect(report.status).toBe('offline')
    }

    const entries = await db.outbox.toArray()
    expect(entries).toHaveLength(18)
    expect(entries.every((e) => e.attempts === 0)).toBe(true)
    expect(await db.dead_letter.count()).toBe(0)

    server.offline = false
    const done = await flushOutbox()
    expect(done.sent).toBe(18)
    expect(server.scores.size).toBe(18)
  })

  it('the queue survives an app kill and replays in order', async () => {
    server.offline = true
    for (const hole of [1, 2, 3]) await enqueueScores([cell(hole, hole + 3)])
    await flushOutbox()

    await forceQuit()

    expect(await db.outbox.count()).toBe(3)
    server.offline = false
    await flushOutbox()

    expect(server.received.map((c) => c.hole_number)).toEqual([1, 2, 3])
    expect(server.scores.size).toBe(3)
    expect(await db.outbox.count()).toBe(0)
  })

  it('standings compute from the local rows with the network fully disabled', async () => {
    server.offline = true
    await seedTrip()
    await enqueueScores([cell(1, 4), cell(2, 4), cell(3, 4)])

    const { buildStandings } = await import('@/lib/data/compute')
    const vm = buildStandings(await readDb())
    const jon = vm.rows.find((r) => r.playerId === JON)!

    // Par 4s, 4 strokes, no strokes received: three pars = 2 points each.
    expect(jon.total).toBe(6)
    expect(server.requests).toBe(0)
  })
})

describe('poison items', () => {
  it('moves a refused cell to dead-letter with its payload intact, and the queue continues', async () => {
    server.refusals.set(`${ROUND}|${JON}|5`, 'round_upcoming')
    await enqueueScores([cell(4, 4), cell(5, 4), cell(6, 4)])

    const report = await flushOutbox()

    expect(report.deadLettered).toBe(1)
    expect(report.sent).toBe(2)
    expect(await db.outbox.count()).toBe(0)

    const dead = await db.dead_letter.toArray()
    expect(dead).toHaveLength(1)
    expect(dead[0].reason).toBe('terminal')
    expect(dead[0].last_error).toBe('round_upcoming')
    expect(dead[0].payload).toEqual(cell(5, 4))
    expect(dead[0].ts).toBeTruthy()

    // The other two holes went through — one bad cell never costs a scorer the rest.
    expect(server.scores.size).toBe(2)
  })

  it('retries a 5xx and only dead-letters after the attempt budget is spent', async () => {
    server.failing = true
    await enqueueScores([cell(8, 4)])

    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      await flushOutbox()
      const entry = (await db.outbox.toArray())[0]
      expect(entry.attempts).toBe(i)
      expect(entry.last_error).toContain('500')
    }

    await flushOutbox()
    expect(await db.outbox.count()).toBe(0)
    const dead = await db.dead_letter.toArray()
    expect(dead[0].reason).toBe('exhausted')
    expect(dead[0].attempts).toBe(MAX_ATTEMPTS)
  })

  it('puts a dead-lettered item back on the queue on Retry', async () => {
    server.refusals.set(`${ROUND}|${JON}|9`, 'no_round_player_row')
    await enqueueScores([cell(9, 4)])
    await flushOutbox()
    const dead = (await db.dead_letter.toArray())[0]

    // The admin adds the missing round_players row; the scorer taps Retry.
    server.refusals.clear()
    expect(await retryDeadLetter(dead.id)).toBe(true)
    expect(await db.dead_letter.count()).toBe(0)

    const requeued = (await db.outbox.toArray())[0]
    expect(requeued.attempts).toBe(0)
    expect(requeued.payload).toEqual(cell(9, 4))

    await flushOutbox()
    expect(server.scores.get(`${ROUND}|${JON}|9`)?.gross_strokes).toBe(4)
  })
})

describe('the pending-write shield (comparator site 4)', () => {
  it('a routine refetch never wipes unsynced local entry', async () => {
    // The server holds a row from before this phone went offline. Local stamps come from
    // the machine clock, so remote fixtures use extremes — 2020 for "older than anything
    // this run can produce", 2099 for "newer" — rather than dates near the real trip.
    const stale: ScoreRow[] = [
      {
        id: 'srv-1',
        round_id: ROUND,
        player_id: JON,
        hole_number: 1,
        gross_strokes: null,
        picked_up: false,
        client_updated_at_raw: '2020-01-01T00:00:00.000Z',
        client_updated_at_effective: '2020-01-01T00:00:00.000Z',
        client_id: DEVICE_B,
      },
    ]
    server.offline = true
    await enqueueScores([cell(1, 5)])

    const report = await mergeStampedRows({ scores: stale, ctp_results: [] })

    expect(report.applied).toBe(0)
    expect((await db.scores.get([ROUND, JON, 1]))?.gross_strokes).toBe(5)
    expect(await db.outbox.count()).toBe(1)
  })

  it('lets a genuinely newer remote row through', async () => {
    await enqueueScores([cell(1, 5)])
    await flushOutbox()

    const newer: ScoreRow = {
      id: 'srv-1',
      round_id: ROUND,
      player_id: JON,
      hole_number: 1,
      gross_strokes: 6,
      picked_up: false,
      client_updated_at_raw: '2099-01-01T00:00:00.000Z',
      client_updated_at_effective: '2099-01-01T00:00:00.000Z',
      client_id: DEVICE_B,
    }
    const report = await mergeStampedRows({ scores: [newer], ctp_results: [] })

    expect(report.applied).toBe(1)
    expect((await db.scores.get([ROUND, JON, 1]))?.gross_strokes).toBe(6)
  })
})

describe('the Realtime handler (comparator site 2)', () => {
  const remote = (gross: number, effective: string, clientId = DEVICE_B): ScoreRow => ({
    id: 'srv-1',
    round_id: ROUND,
    player_id: JON,
    hole_number: 1,
    gross_strokes: gross,
    picked_up: false,
    client_updated_at_raw: effective,
    client_updated_at_effective: effective,
    client_id: clientId,
  })

  const event = (row: ScoreRow, eventType: 'INSERT' | 'UPDATE' = 'UPDATE') =>
    ({ eventType, new: row, old: {} }) as never

  it('an older remote event never clobbers a newer local row', async () => {
    await enqueueScores([cell(1, 5)])
    await flushOutbox()

    await applyScoreEvent(event(remote(9, '2020-01-01T00:00:00.000Z')))

    expect((await db.scores.get([ROUND, JON, 1]))?.gross_strokes).toBe(5)
  })

  it('a newer remote event lands', async () => {
    await enqueueScores([cell(1, 5)])
    await flushOutbox()

    await applyScoreEvent(event(remote(9, '2099-01-01T00:00:00.000Z')))

    expect((await db.scores.get([ROUND, JON, 1]))?.gross_strokes).toBe(9)
  })

  it('a DELETE removes the row rather than leaving a ghost', async () => {
    await enqueueScores([cell(1, 5)])
    await flushOutbox()

    await applyScoreEvent({
      eventType: 'DELETE',
      old: { round_id: ROUND, player_id: JON, hole_number: 1 },
      new: {},
    } as never)

    expect(await db.scores.get([ROUND, JON, 1])).toBeUndefined()
  })
})

describe('the self-echo rule', () => {
  it('a stale self-echo does not clear the marker on a newer pending write', async () => {
    server.offline = true
    await enqueueScores([cell(1, 4)])
    const older = (await db.outbox.toArray())[0]
    await enqueueScores([cell(1, 5)])

    // The echo of the FIRST write arrives (it did reach the server, late). It must not
    // clear the second, which is still only on this phone.
    const cleared = await clearEchoed(scoreKey(ROUND, JON, 1), {
      effective: older.ts,
      clientId: DEVICE_A,
    })

    expect(cleared).toBe(1)
    const left = await db.outbox.toArray()
    expect(left).toHaveLength(1)
    expect((left[0].payload as ScorePayload).gross_strokes).toBe(5)
  })

  it('an echo at or past the newest pending stamp clears it', async () => {
    server.offline = true
    await enqueueScores([cell(1, 4)])
    const entry = (await db.outbox.toArray())[0]

    const cleared = await clearEchoed(scoreKey(ROUND, JON, 1), {
      effective: entry.ts,
      clientId: DEVICE_A,
    })

    expect(cleared).toBe(1)
    expect(await db.outbox.count()).toBe(0)
  })

  it('another device’s write is not an echo — the server adjudicates that one', async () => {
    server.offline = true
    await enqueueScores([cell(1, 4)])

    const cleared = await clearEchoed(scoreKey(ROUND, JON, 1), {
      effective: '2099-01-01T00:00:00.000Z',
      clientId: DEVICE_B,
    })

    expect(cleared).toBe(0)
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('two devices editing the same hole while both offline', () => {
  it('converge on the same final state on both', async () => {
    // Device A writes 5 while offline.
    server.offline = true
    await enqueueScores([cell(1, 5)])
    const deviceA = {
      outbox: await db.outbox.toArray(),
      scores: await db.scores.toArray(),
    }

    // Device B is a second phone: its own storage, its own client_id, a later stamp.
    await db.outbox.clear()
    await db.scores.clear()
    becomeDevice(DEVICE_B)
    resetClockCache()
    await db.sync_meta.clear()
    await enqueueScores([cell(1, 7)])

    // B reaches signal first.
    server.offline = false
    await flushOutbox()
    expect(server.scores.get(`${ROUND}|${JON}|1`)?.gross_strokes).toBe(7)
    const deviceB = { scores: await db.scores.toArray() }

    // A comes back an hour later and flushes its older write.
    await db.outbox.clear()
    await db.scores.clear()
    becomeDevice(DEVICE_A)
    await db.outbox.bulkAdd(deviceA.outbox)
    await db.scores.bulkPut(deviceA.scores)

    const report = await flushOutbox()

    // A's write loses the comparator, the server hands back the winner, and A rolls itself
    // onto it. Nothing is retried and nothing is dead-lettered — losing is a settled
    // outcome, not a failure.
    expect(report.sent).toBe(1)
    expect(report.deadLettered).toBe(0)
    expect(await db.outbox.count()).toBe(0)

    const aFinal = await db.scores.get([ROUND, JON, 1])
    const bFinal = deviceB.scores[0]
    expect(aFinal?.gross_strokes).toBe(7)
    expect(bFinal.gross_strokes).toBe(7)
    expect(server.scores.get(`${ROUND}|${JON}|1`)?.gross_strokes).toBe(7)
    expect(aFinal?.client_id).toBe(DEVICE_B)
  })
})

describe('CTP flows through the same queue', () => {
  it('queues offline, coalesces, and lands on reconnect', async () => {
    server.offline = true
    await enqueueCtp([{ round_id: ROUND, hole_number: 8, player_id: JON, distance_feet: 14.5 }])
    await enqueueCtp([{ round_id: ROUND, hole_number: 8, player_id: KYLE, distance_feet: 9 }])

    expect((await db.ctp_results.get([ROUND, 8]))?.player_id).toBe(KYLE)
    expect(await db.outbox.count()).toBe(2)

    server.offline = false
    const report = await flushOutbox()

    expect(report.sent).toBe(1)
    expect(server.ctp.get(`${ROUND}|8`)?.player_id).toBe(KYLE)
    expect(await db.outbox.count()).toBe(0)
  })
})

// ── Fixtures ─────────────────────────────────────────────────────────────────

async function readDb() {
  const [players, courses, tees, holes, hole_yardages, rounds, round_players, scores, ctp_results, settings] =
    await Promise.all([
      db.players.toArray(),
      db.courses.toArray(),
      db.tees.toArray(),
      db.holes.toArray(),
      db.hole_yardages.toArray(),
      db.rounds.toArray(),
      db.round_players.toArray(),
      db.scores.toArray(),
      db.ctp_results.toArray(),
      db.settings.toArray(),
    ])
  return { players, courses, tees, holes, hole_yardages, rounds, round_players, scores, ctp_results, settings }
}

/** The smallest trip that scores: one course of par 4s, one tee, one in-progress round. */
async function seedTrip(): Promise<void> {
  const COURSE = 'cccccccc-0000-0000-0000-000000000001'
  const TEE = 'dddddddd-0000-0000-0000-000000000001'
  await db.players.bulkPut([
    {
      id: JON,
      name: 'Jon Aronson',
      title: null,
      handicap_index: 0,
      index_is_assigned: false,
      index_updated_at: '2027-01-01T00:00:00Z',
      photo_url: null,
      sort_order: 1,
    },
  ])
  await db.courses.bulkPut([
    {
      id: COURSE,
      name: 'Red',
      architect: '',
      year_opened: 2012,
      description: '',
      data_is_placeholder: false,
    },
  ])
  await db.tees.bulkPut([
    { id: TEE, course_id: COURSE, name: 'Black', rating: 72, slope: 113, par: 72, total_yardage: 6800 },
  ])
  await db.holes.bulkPut(
    Array.from({ length: 18 }, (_, i) => ({
      id: `hole-${i + 1}`,
      course_id: COURSE,
      hole_number: i + 1,
      par: 4,
      stroke_index: i + 1,
    })),
  )
  await db.rounds.bulkPut([
    {
      id: ROUND,
      round_number: 1,
      date: '2027-02-04',
      course_id: COURSE,
      tee_time: null,
      status: 'in_progress',
      holes_counted: null,
    },
  ])
  await db.round_players.bulkPut([
    {
      round_id: ROUND,
      player_id: JON,
      tee_id: TEE,
      index_used: 0,
      allowance_used: 1,
      cap_used: 18,
      course_handicap: 0,
      playing_handicap: 0,
      cap_applied: false,
      strokes_received: 0,
      manual_override: null,
      status: 'playing',
    },
  ])
}
