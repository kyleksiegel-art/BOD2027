// The admin write path (Phase 5B). ONLINE ONLY, by design, not by omission.
//
// CLAUDE.md §"Offline capability boundary" draws the line: score entry, picked-up flags,
// CTP results and day-of tee changes ride the outbox; everything else in /admin is a
// direct RPC that needs a signal. That is a decision about consequences, not about
// difficulty. A score entered in a dead spot is one cell the next scorer fixes in a tap.
// A course card published, a round finalized, or a handicap re-snapshotted from a stale
// local copy silently re-derives every leaderboard for the rest of the trip, and nothing
// on screen looks wrong. So these calls fail loudly when there is no signal instead of
// queueing.
//
// Every function here demands a PIN session. Score entry lost its PIN on 2026-08-17
// (docs/spec/decisions.md §"PIN removed from score entry"); these did not.
//
// After a successful write the hydrate query is invalidated and the ordinary
// network→Dexie→useLiveQuery path refills the screen — the same path a cold start uses.
// Nothing here writes Dexie by hand, and nothing renders from a promise.
import { supabase } from '@/lib/supabase'
import { readToken, lock } from '@/lib/auth/session'
import { enqueueRoundPlayer, flushOutbox } from '@/lib/sync/outbox'
import { queryClient } from './queryClient'
import type { HoleRow, RoundPlayerPayload } from './types'

export type AdminFailure = 'locked' | 'offline' | 'refused'

export class AdminError extends Error {
  kind: AdminFailure
  constructor(kind: AdminFailure, message: string) {
    super(message)
    this.name = 'AdminError'
    this.kind = kind
  }
}

/** Server-side outcomes that report a list of reasons rather than throwing. */
export interface CheckedResult {
  ok: boolean
  errors: string[]
}

/** Refill Dexie from the server through the one existing network→Dexie path. */
function revalidate(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['hydrate'] })
}

async function call<T>(
  fn: string,
  args: Record<string, unknown>,
  opts: { revalidate?: boolean } = {},
): Promise<T> {
  const token = await readToken()
  if (token === null) throw new AdminError('locked', 'Your session has expired. Enter the PIN again.')

  let data: unknown
  let error: { message: string; code?: string } | null
  try {
    ;({ data, error } = await supabase.rpc(fn, { session_token: token, ...args }))
  } catch (e) {
    throw new AdminError(
      'offline',
      e instanceof Error && /fetch|network/i.test(e.message)
        ? 'No connection. Admin changes need a signal — nothing was saved.'
        : (e as Error)?.message || 'Could not reach the server.',
    )
  }

  if (error) {
    // 28000 is what fn_require_session raises (PostgREST answers 403). The token is
    // dead, so drop it locally too — otherwise the screen keeps offering an Unlock that
    // has already happened.
    if (error.code === '28000' || /invalid or expired session/i.test(error.message)) {
      await lock()
      throw new AdminError('locked', 'Your session has expired. Enter the PIN again.')
    }
    throw new AdminError('refused', error.message)
  }

  if (opts.revalidate !== false) await revalidate()
  return data as T
}

// ── Players ──────────────────────────────────────────────────────────────────

export interface PlayerInput {
  id: string | null
  name: string
  title: string | null
  handicapIndex: number
  indexIsAssigned: boolean
  photoUrl: string | null
  sortOrder: number | null
}

export function savePlayer(p: PlayerInput) {
  return call<unknown>('rpc_upsert_player', {
    p_id: p.id,
    p_name: p.name,
    p_title: p.title,
    p_handicap_index: p.handicapIndex,
    p_index_is_assigned: p.indexIsAssigned,
    p_photo_url: p.photoUrl,
    p_sort_order: p.sortOrder,
  })
}

// ── Course cards ─────────────────────────────────────────────────────────────

/**
 * One hole's whole line on the card: par, stroke index, and a yardage per tee.
 *
 * The hole goes first because a hole that does not exist yet has no id for the yardages to
 * reference — the server hands back the row it wrote and the yardages hang off that. Dexie
 * is refilled once at the end rather than after each leg, so the editor doesn't flicker
 * through four intermediate states while saving one hole.
 *
 * NOTE for the caller: editing a hole on a PUBLISHED card un-publishes it server-side
 * (rpc_upsert_hole). That is deliberate — a card whose par just changed is no longer a
 * validated card — and it means scoring stops until Validate & publish is run again.
 */
export async function saveHoleCard(
  courseId: string,
  holeNumber: number,
  par: number | null,
  strokeIndex: number | null,
  yardages: { teeId: string; yardage: number | null }[],
): Promise<void> {
  const hole = await call<HoleRow>(
    'rpc_upsert_hole',
    {
      p_id: null,
      p_course_id: courseId,
      p_hole_number: holeNumber,
      p_par: par,
      p_stroke_index: strokeIndex,
    },
    { revalidate: false },
  )
  for (const y of yardages) {
    await call<unknown>(
      'rpc_upsert_hole_yardage',
      { p_hole_id: hole.id, p_tee_id: y.teeId, p_yardage: y.yardage },
      { revalidate: false },
    )
  }
  await revalidate()
}

export interface TeeInput {
  id: string | null
  courseId: string
  name: string
  rating: number | null
  slope: number | null
  par: number
  totalYardage: number | null
}

export function saveTee(t: TeeInput) {
  return call<unknown>('rpc_upsert_tee', {
    p_id: t.id,
    p_course_id: t.courseId,
    p_name: t.name,
    p_rating: t.rating,
    p_slope: t.slope,
    p_par: t.par,
    p_total_yardage: t.totalYardage,
  })
}

/** The only call permitted to clear data_is_placeholder, and only if the card is whole. */
export async function publishCourse(courseId: string): Promise<CheckedResult> {
  const r = await call<{ published: boolean; errors: string[] }>('rpc_validate_and_publish_course', {
    p_course_id: courseId,
  })
  return { ok: r.published, errors: r.errors ?? [] }
}

// ── Rounds ───────────────────────────────────────────────────────────────────

export interface RoundPlayerInput {
  roundId: string
  playerId: string
  teeId: string
  indexUsed: number
  allowanceUsed: number
  capUsed: number
  status: 'playing' | 'did_not_play'
  /** Preserved across a tee change so it is not silently cleared; queued path only. */
  manualOverride?: number | null
}

/**
 * Day-of tee/handicap change — the ONE admin mutation that rides the offline outbox
 * (docs/spec/decisions.md §"Answer to the open question"). Tees get decided standing on the
 * first tee, which may have no signal, so this queues like a score instead of failing when
 * offline. A local optimistic row is computed immediately (enqueueRoundPlayer) so strokes
 * recompute before anyone hits a ball; the server owns the authoritative arithmetic on flush.
 *
 * `manualOverride` is carried through so a tee change does NOT silently wipe an override the
 * captain set earlier — the online admin variant (`saveRoundPlayers`) never sent it, which
 * cleared it; queuing it preserves it. The flush needs a session token; if this device only
 * unlocked offline, the change is kept and syncs after the next online unlock.
 */
export async function saveRoundPlayersQueued(entries: RoundPlayerInput[]): Promise<CheckedResult> {
  const payloads: RoundPlayerPayload[] = entries.map((e) => ({
    round_id: e.roundId,
    player_id: e.playerId,
    tee_id: e.teeId,
    index_used: e.indexUsed,
    allowance_used: e.allowanceUsed,
    cap_used: e.capUsed,
    status: e.status,
    manual_override: e.manualOverride ?? null,
  }))

  try {
    await enqueueRoundPlayer(payloads)
  } catch (e) {
    return { ok: false, errors: [(e as Error)?.message ?? 'Could not record on this device.'] }
  }

  // Best-effort flush. Queued is already durable; a refusal is reported, offline is not an error.
  const report = await flushOutbox().catch(() => null)
  if (report && report.deadLettered > 0) {
    return { ok: false, errors: [report.message ?? 'The server refused the change.'] }
  }
  return { ok: true, errors: [] }
}

/**
 * The ONLINE admin variant — a direct, session-gated RPC that stamps a sentinel client_id.
 * Retained for the SQL test surface (`admin_path.sql`) and as the hard-reset path; the
 * editor uses `saveRoundPlayersQueued` so a tee change works at the first tee with no signal.
 */
export async function saveRoundPlayers(entries: RoundPlayerInput[]): Promise<CheckedResult> {
  const results = await call<{ applied: boolean; error: string | null }[]>(
    'rpc_upsert_round_player_admin',
    {
      entries: entries.map((e) => ({
        round_id: e.roundId,
        player_id: e.playerId,
        tee_id: e.teeId,
        index_used: e.indexUsed,
        allowance_used: e.allowanceUsed,
        cap_used: e.capUsed,
        status: e.status,
      })),
    },
  )
  const refused = (results ?? []).filter((r) => !r.applied)
  return { ok: refused.length === 0, errors: refused.map((r) => r.error ?? 'refused') }
}

export async function startRound(roundId: string): Promise<CheckedResult> {
  const r = await call<{ started: boolean; errors: string[] }>('rpc_start_round', {
    p_round_id: roundId,
  })
  return { ok: r.started, errors: r.errors ?? [] }
}

export async function finalizeRound(roundId: string, holesCounted: number | null): Promise<CheckedResult> {
  const r = await call<{ finalized: boolean; errors: string[] }>('rpc_finalize_round', {
    p_round_id: roundId,
    p_holes_counted: holesCounted,
  })
  return { ok: r.finalized, errors: r.errors ?? [] }
}

/**
 * Wipe a round's scores, CTP and frozen money and put it back to in_progress so it can be
 * re-entered from scratch — tees and handicaps (round_players) are kept. Replaces the old
 * one-way "abandon" as the admin reset (Kyle, 2026-08-23). Clearing an abandoned round also
 * revives it.
 */
export function clearRoundScores(roundId: string) {
  return call<unknown>('rpc_clear_round_scores', { p_round_id: roundId })
}

/** The one door that makes an index edit retroactive — for one named round, deliberately. */
export async function resnapshotRound(roundId: string): Promise<number> {
  const r = await call<{ resnapshotted: number }>('rpc_resnapshot_round_handicaps', {
    p_round_id: roundId,
  })
  return r.resnapshotted
}

export function setManualOverride(roundId: string, playerId: string, override: number | null) {
  return call<unknown>('rpc_set_manual_override', {
    p_round_id: roundId,
    p_player_id: playerId,
    p_override: override,
  })
}

// ── Settings ─────────────────────────────────────────────────────────────────
// Retroactive at compute time (the brief), which is exactly why the server validates the
// shape of every value rather than trusting this form.

export function saveSetting(key: string, value: unknown) {
  return call<unknown>('rpc_upsert_settings', { p_key: key, p_value: value })
}

// ── Itinerary / lodging (Phase 8) ──────────────────────────────────────────────
// Online-only admin writes, like every other RPC here — the Info tables are not on the
// offline boundary (CLAUDE.md). The RPCs shipped gated in Phase 5B; these are the client
// bindings. There is deliberately no delete path this phase (Kyle, 2026-08-24: the data is
// a small fixed set of rooms and dinners — edit in place, don't build removal yet).

export interface ItineraryEntryInput {
  id: string | null
  day: string // 'YYYY-MM-DD'
  sortOrder: number
  startTime: string | null // ISO timestamptz, or null for all-day
  category: 'travel' | 'golf' | 'meal' | 'lodging' | 'other'
  title: string
  detail: string | null
  location: string | null
}

/** Batch upsert — the RPC takes the whole array and reports per-entry applied/error. */
export async function saveItinerary(entries: ItineraryEntryInput[]): Promise<CheckedResult> {
  const results = await call<{ applied: boolean; error: string | null }[]>('rpc_upsert_itinerary', {
    entries: entries.map((e) => ({
      id: e.id,
      day: e.day,
      sort_order: e.sortOrder,
      start_time: e.startTime,
      category: e.category,
      title: e.title,
      detail: e.detail,
      location: e.location,
    })),
  })
  const refused = (results ?? []).filter((r) => !r.applied)
  return { ok: refused.length === 0, errors: refused.map((r) => r.error ?? 'refused') }
}

export interface LodgingInput {
  id: string | null
  property: string
  checkIn: string // 'YYYY-MM-DD'
  checkOut: string
  confirmation: string | null
  notes: string | null
}

export function saveLodging(l: LodgingInput) {
  return call<unknown>('rpc_upsert_lodging', {
    p_id: l.id,
    p_property: l.property,
    p_check_in: l.checkIn,
    p_check_out: l.checkOut,
    p_confirmation: l.confirmation,
    p_notes: l.notes,
  })
}

export interface LodgingAssignmentInput {
  id: string | null
  lodgingId: string
  playerId: string
  roomLabel: string | null
}

export function saveLodgingAssignment(a: LodgingAssignmentInput) {
  return call<unknown>('rpc_upsert_lodging_assignment', {
    p_id: a.id,
    p_lodging_id: a.lodgingId,
    p_player_id: a.playerId,
    p_room_label: a.roomLabel,
  })
}

// ── Rounds: tee time (Phase 8) ───────────────────────────────────────────────
// rpc_upsert_round rewrites the whole round row, so the caller must pass the values it is
// NOT changing (round_number, date, course) back unchanged — the editor reads them from the
// admin VM. Tee time is a timestamptz; the editor composes it from the round's ET date.

export interface RoundInput {
  id: string
  roundNumber: number
  date: string // 'YYYY-MM-DD'
  courseId: string
  teeTime: string | null // ISO timestamptz
}

export function saveRound(r: RoundInput) {
  return call<unknown>('rpc_upsert_round', {
    p_id: r.id,
    p_round_number: r.roundNumber,
    p_date: r.date,
    p_course_id: r.courseId,
    p_tee_time: r.teeTime,
  })
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export function exportAll() {
  return call<Record<string, unknown>>('rpc_export_all_scores', {})
}
