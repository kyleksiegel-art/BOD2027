// Dexie is the single source the UI reads from (CLAUDE.md §Data-layering rule):
// TanStack Query fetches Supabase and writes here; components read via useLiveQuery,
// never from the query cache. Phase 5 adds `session` (the local PIN session) and routes
// write-RPC results back through here, so a save re-renders the screen the same way a
// hydrate does. Phase 6 adds the CTP mirror and the three local-only sync tables — the
// outbox is the ONLY copy of a round played in a dead zone, so it lives here too.
import Dexie from 'dexie'
import type { Table } from 'dexie'
import type {
  SessionRow,
  PlayerRow,
  CourseRow,
  TeeRow,
  HoleRow,
  HoleYardageRow,
  RoundRow,
  RoundPlayerRow,
  ScoreRow,
  SettingRow,
  CtpResultRow,
  OutboxEntry,
  DeadLetterEntry,
  SyncMetaRow,
} from './data/types'

export class BodDatabase extends Dexie {
  players!: Table<PlayerRow, string>
  courses!: Table<CourseRow, string>
  tees!: Table<TeeRow, string>
  holes!: Table<HoleRow, string>
  hole_yardages!: Table<HoleYardageRow, [string, string]>
  rounds!: Table<RoundRow, string>
  round_players!: Table<RoundPlayerRow, [string, string]>
  scores!: Table<ScoreRow, [string, string, number]>
  ctp_results!: Table<CtpResultRow, [string, number]>
  settings!: Table<SettingRow, string>
  // Not a mirror of a server table: this is the local PIN session (Phase 5). Dexie, not
  // sessionStorage -- a force-quit in the cart must not log the scorer out.
  session!: Table<SessionRow, string>
  // The durable write queue and its dead-letter siding (Phase 6). Never a server mirror:
  // these two tables are what survives a force-quit halfway down the 14th.
  outbox!: Table<OutboxEntry, number>
  dead_letter!: Table<DeadLetterEntry, string>
  // Local scratch: the monotonic clock's high-water mark, last successful sync.
  sync_meta!: Table<SyncMetaRow, string>

  constructor() {
    super('bod2027')
    // Only fields used as a key or a query filter are indexed. Compound primary keys
    // ([a+b]) mirror the Postgres unique keys so a hydrate is an idempotent bulkPut.
    this.version(1).stores({
      players: 'id, sort_order',
      courses: 'id',
      tees: 'id, course_id',
      holes: 'id, course_id, [course_id+hole_number]',
      hole_yardages: '[hole_id+tee_id], hole_id, tee_id',
      rounds: 'id, round_number, course_id',
      round_players: '[round_id+player_id], round_id, player_id',
      scores: 'id, round_id, [round_id+player_id]',
      settings: 'key',
    })
    this.version(2).stores({ session: 'id' })
    // v3/v4 re-key `scores` from the server `id` to the LOGICAL unique key
    // (round_id, player_id, hole_number) — the same key Postgres enforces.
    //
    // Keyed by `id`, a row whose server id changed (deleted and re-inserted) left the old
    // row behind and the cell had two conflicting entries in Dexie, with whichever sorted
    // last silently winning. Keyed by the cell, a bulkPut is genuinely idempotent, and the
    // Phase 6 comparator — which reasons in (round, player, hole) — has a key to reason
    // about. Dexie cannot alter a primary key in place, so the table is dropped in v3 and
    // recreated in v4; it is a read mirror, and the next hydrate refills it.
    this.version(3).stores({ scores: null })
    this.version(4).stores({
      scores: '[round_id+player_id+hole_number], id, round_id, [round_id+player_id]',
    })
    // v5 — Phase 6. `ctp_results` is keyed by its Postgres unique key for the same reason
    // `scores` is: the comparator reasons in (round, hole), not in server ids.
    //
    // `outbox` is keyed by an auto-incrementing `seq` — the brief's "local sequence
    // number". It is the flush tie-break when two entries carry the same monotonic ts, and
    // it makes replay order observable in Diagnostics. `id` (a client UUID) is indexed and
    // survives the move to `dead_letter`, so one item is traceable end to end.
    this.version(5).stores({
      ctp_results: '[round_id+hole_number], id, round_id',
      outbox: '++seq, id, key, kind',
      dead_letter: 'id, key, kind, failed_at',
      sync_meta: 'key',
    })
  }
}

export const db = new BodDatabase()
