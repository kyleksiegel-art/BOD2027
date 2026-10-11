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

/** 'queued' — recorded locally, not yet on the server. Normal, not an error.
 *  'superseded' — the save landed, but another phone's newer value for a cell won and replaced
 *  ours; the scorer is shown the winner and told, rather than left with a silent revert. */
export type WriteStatus = 'idle' | 'saving' | 'queued' | 'error' | 'superseded'

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
 * is safe, connection or no connection. It does NOT wait for the network: the flush runs
 * behind it and reports through the write state. (It used to await the flush, and on one
 * bar of signal the scorer sat on "Saving…" while Enter's post-save bookkeeping waited —
 * long enough to tap a correction that the bookkeeping then threw away.) It resolves false
 * only if Dexie itself refused, which means the device could not record the score at all
 * and the caller must keep its unsaved edits.
 */
export async function saveCells(cells: ScoreCellInput[]): Promise<boolean> {
  if (cells.length === 0) return true
  const payloads: ScorePayload[] = cells.map((c) => ({
    round_id: c.roundId,
    player_id: c.playerId,
    hole_number: c.holeNumber,
    gross_strokes: c.grossStrokes,
    picked_up: c.pickedUp,
  }))
  return record(() => enqueueScores(payloads))
}

/**
 * Record one closest-to-pin result. Same offline-first path as saveCells: the row is written
 * to Dexie and appended to the outbox in one transaction (enqueueCtp), then the flush is
 * best-effort. Like score entry, CTP entry takes no session token. A `null` player_id records
 * an explicit "no winner" for the hole (no rollover), distinct from a hole not entered yet.
 */
export async function saveCtp(result: CtpPayload): Promise<boolean> {
  return record(() => enqueueCtp([result]))
}

async function record(enqueue: () => Promise<unknown>): Promise<boolean> {
  publish({ status: 'saving', message: null })
  try {
    await enqueue()
  } catch (e) {
    publish({
      status: 'error',
      message: `Couldn’t record that on this phone: ${e instanceof Error ? e.message : String(e)}`,
    })
    return false
  }
  // Queued and safe — say so now, so Save is free for the next hole. The flush is
  // best-effort from here: its outcome replaces this note, never whether the score was kept.
  publish({ status: 'queued', message: PENDING_NOTE })
  void flushAndReport()
  return true
}

/** Saves that are still waiting on their flush. A par-3 Save queues scores and CTP back to
 *  back; the outcome is published once, when the last one settles, so the CTP's clean flush
 *  can't paper over the scores' "superseded" notice. */
let flushesOutstanding = 0
let worst: WriteState | null = null

const RANK: Record<WriteStatus, number> = { idle: 0, saving: 0, queued: 1, superseded: 2, error: 3 }

async function flushAndReport(): Promise<void> {
  flushesOutstanding += 1
  let next: WriteState
  try {
    next = outcomeOf(await flushOutbox())
  } catch {
    next = { status: 'queued', message: PENDING_NOTE }
  }
  if (!worst || RANK[next.status] > RANK[worst.status]) worst = next
  flushesOutstanding -= 1
  if (flushesOutstanding === 0) {
    publish(worst)
    worst = null
  }
}

function outcomeOf(report: FlushReport): WriteState {
  if (report.deadLettered > 0) {
    return {
      status: 'error',
      message: `The server refused ${report.deadLettered} entr${report.deadLettered === 1 ? 'y' : 'ies'} (${report.message ?? 'see Diagnostics'}). Kept — nothing was lost.`,
    }
  }
  if (report.superseded > 0) {
    // The save landed but another phone had a newer value for a cell; the screen now shows
    // that winner. Tell the scorer rather than let it revert silently under "Saved".
    return {
      status: 'superseded',
      message: `A newer score from another phone replaced ${report.superseded === 1 ? 'one entry' : `${report.superseded} entries`}.`,
    }
  }
  if (report.status === 'offline' || report.remaining > 0) return { status: 'queued', message: PENDING_NOTE }
  return { status: 'idle', message: null }
}

// Offline is a normal operating mode here, not an error. No destructive copy.
const PENDING_NOTE = 'Saved on this phone — it’ll sync when you have signal.'

