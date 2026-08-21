// Row shapes as they live in Dexie — a faithful mirror of the Supabase public tables
// (read subset used by the UI), plus `SessionRow`, which is local-only.
//
// ScoreRow carries the comparator columns as optional: rendering never reads them, but a
// row written back from rpc_upsert_scores does carry them, and Phase 6's comparator
// needs them present locally to decide which of two writes to a cell wins.

export interface PlayerRow {
  id: string
  name: string
  title: string | null
  handicap_index: number
  index_is_assigned: boolean
  index_updated_at: string
  photo_url: string | null
  sort_order: number
}

export interface CourseRow {
  id: string
  name: string
  architect: string
  year_opened: number
  description: string
  data_is_placeholder: boolean
}

export interface TeeRow {
  id: string
  course_id: string
  name: string
  rating: number | null
  slope: number | null
  par: number
  total_yardage: number | null
}

export interface HoleRow {
  id: string
  course_id: string
  hole_number: number
  par: number | null
  stroke_index: number | null
}

export interface HoleYardageRow {
  hole_id: string
  tee_id: string
  yardage: number | null
}

export type RoundStatusRow = 'upcoming' | 'in_progress' | 'final' | 'abandoned'

export interface RoundRow {
  id: string
  round_number: number
  date: string
  course_id: string
  tee_time: string | null
  status: RoundStatusRow
  holes_counted: number | null
}

export type RpStatusRow = 'playing' | 'did_not_play'

export interface RoundPlayerRow {
  round_id: string
  player_id: string
  tee_id: string
  index_used: number
  allowance_used: number
  cap_used: number
  course_handicap: number
  playing_handicap: number
  cap_applied: boolean
  strokes_received: number
  manual_override: number | null
  status: RpStatusRow
  // Present once a day-of tee change has gone through the write path (Phase 6b outbox).
  // The seed leaves them null; the comparator treats an unstamped row as oldest.
  client_updated_at_raw?: string
  client_updated_at_effective?: string
  client_id?: string
}

export interface ScoreRow {
  id: string
  round_id: string
  player_id: string
  hole_number: number
  gross_strokes: number | null
  picked_up: boolean
  client_updated_at_raw?: string
  client_updated_at_effective?: string
  client_id?: string
}

export interface CtpResultRow {
  id: string
  round_id: string
  hole_number: number
  player_id: string | null
  distance_feet: number | null
  client_updated_at_raw?: string
  client_updated_at_effective?: string
  client_id?: string
}

/** Local only — never synced. The PIN session token and its expiry. */
export interface SessionRow {
  id: 'current'
  /** The server session token, or '' for an offline unlock (which cannot mint one). */
  token: string
  expires_at: string
  unlocked_at: string
  /**
   * True when this session was granted by the LOCAL bcrypt check with no signal. It unlocks
   * the UI, but carries no server token — so `readToken()` returns null for it and any
   * token-gated write (admin RPCs, the round_player outbox) waits for an online unlock.
   */
  offline?: boolean
}

export interface SettingRow {
  key: string
  value: unknown
}

// ── Local-only sync bookkeeping (Phase 6) ────────────────────────────────────
// None of these mirror a server table; they are how a phone in a dead zone remembers what
// it still owes the server.

/** What an outbox entry carries. Whole-tuple state, never a delta — see the comparator. */
export interface ScorePayload {
  round_id: string
  player_id: string
  hole_number: number
  gross_strokes: number | null
  picked_up: boolean
}

export interface CtpPayload {
  round_id: string
  hole_number: number
  player_id: string | null
  distance_feet: number | null
}

/**
 * A day-of tee/handicap change — the one admin mutation carved into the outbox
 * (docs/spec/decisions.md §"Answer to the open question"). INPUTS only: the server owns the
 * handicap arithmetic, so two phones can never disagree about who gets a stroke. The local
 * optimistic row is computed by the same pure engine so it reads right offline until flush.
 */
export interface RoundPlayerPayload {
  round_id: string
  player_id: string
  tee_id: string
  index_used: number
  allowance_used: number
  cap_used: number
  status: RpStatusRow
  manual_override: number | null
}

export type OutboxKind = 'score' | 'ctp' | 'round_player'

export interface OutboxEntry {
  /** Local sequence number, Dexie-assigned. The tie-break when two entries share a ts. */
  seq?: number
  /** Client-generated UUID. Stable across a dead-letter transfer, so an item is traceable. */
  id: string
  kind: OutboxKind
  /** Canonical key: score `round|player|hole`, ctp `round|hole`, rp `round|player`. */
  key: string
  payload: ScorePayload | CtpPayload | RoundPlayerPayload
  /** Monotonic ISO timestamp — sent as client_updated_at_raw. */
  ts: string
  client_id: string
  attempts: number
  last_error: string | null
  created_at: string
}

export interface DeadLetterEntry extends OutboxEntry {
  failed_at: string
  /** 'terminal' = the server refused it on its merits; 'exhausted' = N retries used up. */
  reason: 'terminal' | 'exhausted'
}

/** One-row-per-key local scratch: the monotonic clock's high-water mark, last sync, etc. */
export interface SyncMetaRow {
  key: string
  value: unknown
}
