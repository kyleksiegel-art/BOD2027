// Pinned 2026-09-28 #1: Save awaited the network flush, so on one bar of signal the Enter
// screen's post-save bookkeeping (clear drafts, next hole) waited on it — long enough for a
// correction tapped in the meantime to be wiped. Save now resolves once the cells are queued.
import { beforeEach, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { resetClientIdCache } from '@/lib/clientId'
import { resetClockCache } from '@/lib/sync/clock'
import { setTransport } from '@/lib/sync/outbox'
import { getWriteState, saveCells } from './mutations'

const ROUND = 'aaaaaaaa-0000-0000-0000-000000000001'
const JON = 'bbbbbbbb-0000-0000-0000-00000000000a'

beforeEach(async () => {
  await Promise.all([db.outbox.clear(), db.dead_letter.clear(), db.scores.clear(), db.sync_meta.clear()])
  resetClockCache()
  localStorage.setItem('bod2027.client_id', '11111111-1111-1111-1111-111111111111')
  resetClientIdCache()
})

it('resolves once queued even while the server never answers', async () => {
  setTransport({ call: () => new Promise(() => {}) }) // a request that hangs forever
  const ok = await saveCells([{ roundId: ROUND, playerId: JON, holeNumber: 3, grossStrokes: 5, pickedUp: false }])
  expect(ok).toBe(true)
  expect((await db.scores.get([ROUND, JON, 3]))?.gross_strokes).toBe(5)
  expect(await db.outbox.count()).toBe(1)
  // Save is free for the next hole: not stuck on "Saving…".
  expect(getWriteState().status).toBe('queued')
})
