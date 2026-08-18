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

/** Local only — never synced. The PIN session token and its expiry. */
export interface SessionRow {
  id: 'current'
  token: string
  expires_at: string
  unlocked_at: string
}

export interface SettingRow {
  key: string
  value: unknown
}
