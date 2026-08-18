// COMPARATOR SITE 3, the merge itself — used by the hydrate query
// (src/lib/data/hydrate.ts) after it flushes the outbox.
//
// A fetched row lands only if it beats the local row AND beats anything this device still
// owes the server for that cell. It lives here rather than inside hydrate.ts so it can be
// tested with no network in the loop: a routine refetch quietly overwriting 18 holes of
// unsynced entry is the exact failure the brief's Definition of Done is written around,
// and it deserves a test that doesn't depend on Supabase being up.
import { db } from '@/lib/db'
import { incomingWins, stampOf } from './comparator'
import { ctpKey, pendingStamps, scoreKey, shieldAllows } from './outbox'
import type { CtpResultRow, ScoreRow } from '@/lib/data/types'

export interface MergeReport {
  applied: number
  skipped: number
}

/** Merge fetched `scores` and `ctp_results` into Dexie. Never a bulkPut. */
export async function mergeStampedRows(payload: {
  scores: ScoreRow[]
  ctp_results: CtpResultRow[]
}): Promise<MergeReport> {
  const pending = await pendingStamps()
  let applied = 0
  let skipped = 0

  for (const row of payload.scores) {
    const local = await db.scores.get([row.round_id, row.player_id, row.hole_number])
    const key = scoreKey(row.round_id, row.player_id, row.hole_number)
    if (!incomingWins(row, local) || !shieldAllows(key, stampOf(row), pending)) {
      skipped += 1
      continue
    }
    await db.scores.put(row)
    applied += 1
  }

  for (const row of payload.ctp_results) {
    const local = await db.ctp_results.get([row.round_id, row.hole_number])
    const key = ctpKey(row.round_id, row.hole_number)
    if (!incomingWins(row, local) || !shieldAllows(key, stampOf(row), pending)) {
      skipped += 1
      continue
    }
    await db.ctp_results.put(row)
    applied += 1
  }

  return { applied, skipped }
}
