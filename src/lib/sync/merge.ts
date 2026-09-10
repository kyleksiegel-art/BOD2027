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
  deleted: number
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
  let deleted = 0

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

  // ── Reconcile server-side deletions ──────────────────────────────────────────
  // This is a FULL pull, and hydrate flushes the outbox before fetching, so anything this
  // device still holds that the server no longer returns — and that we don't still owe (no
  // pending outbox entry) — was deleted upstream. Admin "Clear scores" is the case that
  // matters: without this, a phone that missed the Realtime DELETE keeps ghost rows that
  // resurface as that round's scores when it is re-started (audit F-014). Rows we own are
  // safe: an unflushed write is in `pending`, and a flushed one is in the payload.
  const serverScores = new Set(payload.scores.map((r) => scoreKey(r.round_id, r.player_id, r.hole_number)))
  for (const local of await db.scores.toArray()) {
    const key = scoreKey(local.round_id, local.player_id, local.hole_number)
    if (serverScores.has(key) || pending.has(key)) continue
    await db.scores.delete([local.round_id, local.player_id, local.hole_number])
    deleted += 1
  }
  const serverCtp = new Set(payload.ctp_results.map((r) => ctpKey(r.round_id, r.hole_number)))
  for (const local of await db.ctp_results.toArray()) {
    const key = ctpKey(local.round_id, local.hole_number)
    if (serverCtp.has(key) || pending.has(key)) continue
    await db.ctp_results.delete([local.round_id, local.hole_number])
    deleted += 1
  }
  // round_players only when the caller passed the full table (hydrate does; some tests don't).
  if (payload.round_players) {
    const serverRp = new Set(payload.round_players.map((r) => rpKey(r.round_id, r.player_id)))
    for (const local of await db.round_players.toArray()) {
      const key = rpKey(local.round_id, local.player_id)
      if (serverRp.has(key) || pending.has(key)) continue
      await db.round_players.delete([local.round_id, local.player_id])
      deleted += 1
    }
  }

  return { applied, skipped, deleted }
}
