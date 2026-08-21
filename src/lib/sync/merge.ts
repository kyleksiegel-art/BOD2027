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
import { ctpKey, pendingStamps, rpKey, scoreKey, shieldAllows } from './outbox'
import type { CtpResultRow, RoundPlayerRow, ScoreRow } from '@/lib/data/types'

export interface MergeReport {
  applied: number
  skipped: number
}

/**
 * Merge the fetched stamped tables into Dexie. Never a bulkPut.
 *
 * `round_players` joins `scores` and `ctp_results` here in Phase 6b: a day-of tee change is
 * now a queued write, so a routine refetch must not overwrite an unsynced local tee change
 * any more than it may overwrite an unsynced hole. Unstamped rows (the seed) still land
 * unconditionally — incomingWins() treats an unstamped local row as oldest.
 */
export async function mergeStampedRows(payload: {
  scores: ScoreRow[]
  ctp_results: CtpResultRow[]
  round_players?: RoundPlayerRow[]
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

  for (const row of payload.round_players ?? []) {
    const local = await db.round_players.get([row.round_id, row.player_id])
    const key = rpKey(row.round_id, row.player_id)
    if (!incomingWins(row, local) || !shieldAllows(key, stampOf(row), pending)) {
      skipped += 1
      continue
    }
    await db.round_players.put(row)
    applied += 1
  }

  return { applied, skipped }
}
