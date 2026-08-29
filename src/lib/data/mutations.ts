// The write path. Phase 6 makes it offline-first: a save is written to Dexie and appended
// to the outbox in one transaction, and only then does anything try the network. The tap
// therefore succeeds in a dead zone exactly as it does on hotel wifi — the difference is
// visible in the connection badge's pending count, not in whether the score was recorded.
//
// Score entry takes no session token (docs/spec/decisions.md §"PIN removed from score
// entry"). The server's validation rules are what stands between an open endpoint and a
// poisoned leaderboard; they are enforced in rpc_upsert_scores and tested in
// supabase/tests/write_path.sql.
//
// Saving is still EXPLICIT: the Enter screen holds edits locally and calls saveCells()
// when the scorer taps Save. One hole is one enqueue — the coalescing the brief asked for
// arrives at flush time, where the outbox sends only the latest entry per cell.
import { enqueueScores, enqueueCtp, flushOutbox, type FlushReport } from '@/lib/sync/outbox'
import type { ScorePayload, CtpPayload } from './types'

export interface ScoreCellInput {
  roundId: string
  playerId: string
  holeNumber: number
  grossStrokes: number | null
  pickedUp: boolean
}

/** 'queued' — recorded locally, not yet on the server. Normal, not an error. */
export type WriteStatus = 'idle' | 'saving' | 'queued' | 'error'

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

/**
 * Record a hole's worth of cells.
 *
 * Resolves true once the cells are durably queued — which is the moment the scorer's tap
 * is safe, connection or no connection. It resolves false only if Dexie itself refused,
 * which means the device could not record the score at all and the caller must keep its
 * unsaved edits.
 */
export async function saveCells(cells: ScoreCellInput[]): Promise<boolean> {
  if (cells.length === 0) return true
  publish({ status: 'saving', message: null })

  const payloads: ScorePayload[] = cells.map((c) => ({
    round_id: c.roundId,
    player_id: c.playerId,
    hole_number: c.holeNumber,
    gross_strokes: c.grossStrokes,
    picked_up: c.pickedUp,
  }))

  try {
    await enqueueScores(payloads)
  } catch (e) {
    publish({
      status: 'error',
      message: `Couldn’t record that on this phone: ${e instanceof Error ? e.message : String(e)}`,
    })
    return false
  }

  // Queued and safe. The flush is best-effort from here: its failure changes what the
  // badge says, never whether the score was kept.
  let report: FlushReport
  try {
    report = await flushOutbox()
  } catch (e) {
    publish({ status: 'queued', message: PENDING_NOTE })
    return true
  }

  if (report.deadLettered > 0) {
    publish({
      status: 'error',
      message: `The server refused ${report.deadLettered} entr${report.deadLettered === 1 ? 'y' : 'ies'} (${report.message ?? 'see Diagnostics'}). Kept — nothing was lost.`,
    })
  } else if (report.status === 'offline' || report.remaining > 0) {
    publish({ status: 'queued', message: PENDING_NOTE })
  } else {
    publish({ status: 'idle', message: null })
  }
  return true
}

/**
 * Record one closest-to-pin result. Same offline-first path as saveCells: the row is written
 * to Dexie and appended to the outbox in one transaction (enqueueCtp), then the flush is
 * best-effort. Like score entry, CTP entry takes no session token. A `null` player_id records
 * an explicit "no winner" for the hole (no rollover), distinct from a hole not entered yet.
 */
export async function saveCtp(result: CtpPayload): Promise<boolean> {
  publish({ status: 'saving', message: null })
  try {
    await enqueueCtp([result])
  } catch (e) {
    publish({
      status: 'error',
      message: `Couldn’t record that on this phone: ${e instanceof Error ? e.message : String(e)}`,
    })
    return false
  }

  let report: FlushReport
  try {
    report = await flushOutbox()
  } catch {
    publish({ status: 'queued', message: PENDING_NOTE })
    return true
  }

  if (report.deadLettered > 0) {
    publish({
      status: 'error',
      message: `The server refused ${report.deadLettered} entr${report.deadLettered === 1 ? 'y' : 'ies'} (${report.message ?? 'see Diagnostics'}). Kept — nothing was lost.`,
    })
  } else if (report.status === 'offline' || report.remaining > 0) {
    publish({ status: 'queued', message: PENDING_NOTE })
  } else {
    publish({ status: 'idle', message: null })
  }
  return true
}

// Offline is a normal operating mode here, not an error. No destructive copy.
const PENDING_NOTE = 'Saved on this phone — it’ll sync when you have signal.'

