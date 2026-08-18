// The write path. Phase 5 is ONLINE ONLY: a hole's cells go to rpc_upsert_scores in one
// request and the rows the server hands back are written into Dexie -- so the screen
// re-renders through exactly the same useLiveQuery subscription a hydrate uses. The
// data-layering rule holds in both directions: nothing renders from a promise.
//
// Score entry takes no session token (docs/spec/decisions.md §"PIN removed from score
// entry"). The server's validation rules are what stands between an open endpoint and a
// poisoned leaderboard; they are enforced in rpc_upsert_scores and tested in
// supabase/tests/write_path.sql.
//
// Saving is EXPLICIT: the Enter screen holds edits locally and calls saveCells() when the
// scorer taps Save. That is why there is no debounce and no queue here -- one hole is one
// request, which is the coalescing the brief asked for, arrived at by a shorter road. The
// caller keeps its edits until a save succeeds, so a failed request never loses a hole.
//
// Phase 6 replaces the body of saveCells() with an outbox enqueue + drain and adds the
// three client-side comparator sites.
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { clientId } from '@/lib/clientId'
import type { ScoreRow } from './types'

export interface ScoreCellInput {
  roundId: string
  playerId: string
  holeNumber: number
  grossStrokes: number | null
  pickedUp: boolean
}

export type WriteStatus = 'idle' | 'saving' | 'error'

export interface WriteState {
  status: WriteStatus
  message: string | null
}

// ── Status, published to React via useSyncExternalStore ──────────────────────
const listeners = new Set<() => void>()
let state: WriteState = { status: 'idle', message: null }

function publish(next: WriteState): void {
  state = next
  for (const l of listeners) l()
}

export function subscribeWriteState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getWriteState(): WriteState {
  return state
}

interface RpcResult {
  key: { round_id: string; player_id: string; hole_number: number }
  applied: boolean
  error: string | null
  row: ScoreRow | null
}

/**
 * Send a hole's worth of cells. Resolves true only if every cell was accepted; the caller
 * keeps its unsaved edits on false so nothing is ever silently lost.
 *
 * A cell the comparator rejected as "stale" counts as accepted: the server's row is newer
 * and is now in Dexie, which is the correct outcome, not a failure to retry.
 */
export async function saveCells(cells: ScoreCellInput[]): Promise<boolean> {
  if (cells.length === 0) return true
  publish({ status: 'saving', message: null })

  const raw = new Date().toISOString()
  const id = clientId()

  try {
    const { data, error } = await supabase.rpc('rpc_upsert_scores', {
      cells: cells.map((c) => ({
        round_id: c.roundId,
        player_id: c.playerId,
        hole_number: c.holeNumber,
        gross_strokes: c.grossStrokes,
        picked_up: c.pickedUp,
        client_updated_at_raw: raw,
        client_id: id,
      })),
    })

    if (error) {
      publish({ status: 'error', message: error.message })
      return false
    }

    const results = (data ?? []) as RpcResult[]

    // Every returned row -- applied or "stale" -- is the server's current winner for that
    // cell, so writing them all back is both the success path and the rollback path.
    const rows = results.map((r) => r.row).filter((r): r is ScoreRow => r !== null)
    if (rows.length > 0) await db.scores.bulkPut(rows)

    const refused = results.filter((r) => !r.applied && r.error !== 'stale')
    if (refused.length > 0) {
      publish({
        status: 'error',
        message: `${refused.length} score${refused.length === 1 ? '' : 's'} refused: ${refused[0].error}`,
      })
      return false
    }

    publish({ status: 'idle', message: null })
    return true
  } catch (e) {
    publish({
      status: 'error',
      // Offline is a normal operating mode, not an error -- no destructive copy. Phase 6
      // makes this case actually work rather than merely read calmly.
      message:
        e instanceof Error && e.message.includes('fetch')
          ? 'No connection — your scores are still here. Try again when you have signal.'
          : e instanceof Error
            ? e.message
            : 'Could not save.',
    })
    return false
  }
}
