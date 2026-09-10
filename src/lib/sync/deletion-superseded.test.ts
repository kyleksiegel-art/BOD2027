// Regressions from the 2026-09-09 audit, sync family:
//   F-014 — a full hydrate must remove local stamped rows the server no longer returns (and
//           that we don't still owe), or a phone that missed a "Clear scores" DELETE keeps
//           ghost rows that resurface when the round restarts.
//   F-013 — a save that loses the comparator to ANOTHER device is reported (superseded), not
//           silently rolled back under a "Saved" label.
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetClientIdCache } from '@/lib/clientId'
import { FakeServer } from '@/test/fakeServer'
import { resetClockCache } from './clock'
import { enqueueScores, flushOutbox, setTransport } from './outbox'
import { mergeStampedRows } from './merge'
import type { ScorePayload, ScoreRow } from '@/lib/data/types'

const ROUND = 'aaaaaaaa-0000-0000-0000-000000000001'
const JON = 'bbbbbbbb-0000-0000-0000-00000000000a'
const DEVICE_A = '11111111-1111-1111-1111-111111111111'
const DEVICE_B = '22222222-2222-2222-2222-222222222222'

let server: FakeServer

function cell(hole: number, gross: number): ScorePayload {
  return { round_id: ROUND, player_id: JON, hole_number: hole, gross_strokes: gross, picked_up: false }
}
function row(hole: number, gross: number, clientId: string, eff: string): ScoreRow {
  return {
    id: `srv-${hole}`, round_id: ROUND, player_id: JON, hole_number: hole, gross_strokes: gross, picked_up: false,
    client_updated_at_raw: eff, client_updated_at_effective: eff, client_id: clientId,
  } as ScoreRow
}

beforeEach(async () => {
  await Promise.all([db.outbox.clear(), db.dead_letter.clear(), db.scores.clear(), db.ctp_results.clear(), db.round_players.clear(), db.sync_meta.clear()])
  resetClockCache()
  localStorage.setItem('bod2027.client_id', DEVICE_A)
  resetClientIdCache()
  server = new FakeServer()
  setTransport(server.transport)
})

describe('hydrate removes server-deleted rows (F-014)', () => {
  it('deletes a local stamped row the fetch no longer returns and we do not still owe', async () => {
    await db.scores.put(row(5, 4, DEVICE_A, '2027-02-06T18:00:00.000Z'))
    const rep = await mergeStampedRows({ scores: [], ctp_results: [], round_players: [] })
    expect(rep.deleted).toBe(1)
    expect(await db.scores.get([ROUND, JON, 5])).toBeUndefined()
  })

  it('keeps a row that still has a pending outbox entry, even if absent from the fetch', async () => {
    server.offline = true
    await enqueueScores([cell(7, 3)]) // local row + pending entry, nothing flushed
    const rep = await mergeStampedRows({ scores: [], ctp_results: [], round_players: [] })
    expect(rep.deleted).toBe(0)
    expect(await db.scores.get([ROUND, JON, 7])).toBeDefined()
  })

  it('keeps a row the fetch DOES return', async () => {
    await db.scores.put(row(9, 5, DEVICE_A, '2027-02-06T18:00:00.000Z'))
    const rep = await mergeStampedRows({
      scores: [row(9, 5, DEVICE_A, '2027-02-06T18:00:00.000Z')],
      ctp_results: [],
      round_players: [],
    })
    expect(rep.deleted).toBe(0)
    expect(await db.scores.get([ROUND, JON, 9])).toBeDefined()
  })
})

describe('a save superseded by another device is reported, not silent (F-013)', () => {
  it('flags superseded and adopts the other phone’s value', async () => {
    // Device B already holds a far-newer value on the server for this cell.
    server.scores.set(`${ROUND}|${JON}|1`, row(1, 9, DEVICE_B, '2099-01-01T00:00:00.000Z'))
    await enqueueScores([cell(1, 4)]) // our older write
    const report = await flushOutbox()
    expect(report.superseded).toBe(1)
    expect(report.deadLettered).toBe(0)
    // The screen now shows B's value, not our 4.
    const local = await db.scores.get([ROUND, JON, 1])
    expect(local?.gross_strokes).toBe(9)
    expect(local?.client_id).toBe(DEVICE_B)
    // The queue is settled (a stale loss is a settled outcome).
    expect(await db.outbox.count()).toBe(0)
  })

  it('does not flag superseded for our own stale echo', async () => {
    // Same client_id winner (our own earlier write) — a rollback to ourselves is not an override.
    server.scores.set(`${ROUND}|${JON}|2`, row(2, 6, DEVICE_A, '2099-01-01T00:00:00.000Z'))
    await enqueueScores([cell(2, 4)])
    const report = await flushOutbox()
    expect(report.superseded).toBe(0)
  })
})
