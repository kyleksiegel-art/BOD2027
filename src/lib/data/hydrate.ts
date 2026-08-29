// The one place the network touches the read model. TanStack Query fetches every public
// table and writes the rows into Dexie; nothing else in the app calls Supabase for reads.
// Components subscribe to Dexie (useLiveQuery) and re-render when this bulkPut lands.
//
// This is deliberately a full-table pull, not a delta sync: the whole trip is a few
// hundred rows, and Realtime carries the incremental path.
//
// COMPARATOR SITE 3 (CLAUDE.md §"The four comparator sites"). Two rules, and the whole
// airplane-mode scenario in the Definition of Done rests on them:
//
//   · FLUSH BEFORE FETCH. On regaining signal the outbox goes out first. Fetching first
//     would pull the server's pre-trip rows and then merge them against local rows that
//     are newer — survivable — but it also races the flush, and the ordering costs
//     nothing to get right.
//   · MERGE, NEVER OVERWRITE, for the two stamped tables. A routine refetch that
//     bulkPut its way over `scores` is exactly how 18 holes of unsynced entry disappear.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import type {
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
  ItineraryItemRow,
  LodgingRow,
  LodgingAssignmentRow,
} from './types'
import { flushOutbox } from '@/lib/sync/outbox'
import { mergeStampedRows } from '@/lib/sync/merge'

async function selectAll<T>(table: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*')
  if (error) throw new Error(`fetch ${table}: ${error.message}`)
  return (data ?? []) as T[]
}

export interface HydratePayload {
  players: PlayerRow[]
  courses: CourseRow[]
  tees: TeeRow[]
  holes: HoleRow[]
  hole_yardages: HoleYardageRow[]
  rounds: RoundRow[]
  round_players: RoundPlayerRow[]
  scores: ScoreRow[]
  ctp_results: CtpResultRow[]
  settings: SettingRow[]
  itinerary_items: ItineraryItemRow[]
  lodging: LodgingRow[]
  lodging_assignments: LodgingAssignmentRow[]
}

async function fetchAll(): Promise<HydratePayload> {
  const [
    players, courses, tees, holes, hole_yardages, rounds, round_players, scores, ctp_results,
    settings, itinerary_items, lodging, lodging_assignments,
  ] = await Promise.all([
      selectAll<PlayerRow>('players'),
      selectAll<CourseRow>('courses'),
      selectAll<TeeRow>('tees'),
      selectAll<HoleRow>('holes'),
      selectAll<HoleYardageRow>('hole_yardages'),
      selectAll<RoundRow>('rounds'),
      selectAll<RoundPlayerRow>('round_players'),
      selectAll<ScoreRow>('scores'),
      selectAll<CtpResultRow>('ctp_results'),
      selectAll<SettingRow>('settings'),
      selectAll<ItineraryItemRow>('itinerary_items'),
      selectAll<LodgingRow>('lodging'),
      selectAll<LodgingAssignmentRow>('lodging_assignments'),
    ])
  return {
    players, courses, tees, holes, hole_yardages, rounds, round_players, scores, ctp_results,
    settings, itinerary_items, lodging, lodging_assignments,
  }
}

async function writeToDexie(p: HydratePayload): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.players,
      db.courses,
      db.tees,
      db.holes,
      db.hole_yardages,
      db.rounds,
      db.round_players,
      db.scores,
      db.ctp_results,
      db.settings,
      db.itinerary_items,
      db.lodging,
      db.lodging_assignments,
      db.outbox,
    ],
    async () => {
      // bulkPut is an idempotent upsert on the primary key — a re-hydrate overwrites in
      // place. Safe for the reference tables: nothing on this device writes them, so the
      // server is unconditionally right. `scores`, `ctp_results` and now `round_players`
      // are NOT in this list; they carry the comparator columns and go through the merge
      // below (Phase 6b puts day-of tee changes in the outbox, so a refetch must not
      // overwrite an unsynced tee change).
      await Promise.all([
        db.players.bulkPut(p.players),
        db.courses.bulkPut(p.courses),
        db.tees.bulkPut(p.tees),
        db.holes.bulkPut(p.holes),
        db.hole_yardages.bulkPut(p.hole_yardages),
        db.rounds.bulkPut(p.rounds),
        db.settings.bulkPut(p.settings),
        db.itinerary_items.bulkPut(p.itinerary_items),
        db.lodging.bulkPut(p.lodging),
        db.lodging_assignments.bulkPut(p.lodging_assignments),
      ])
      await mergeStampedRows(p)
    },
  )
}

/**
 * Mount once near the app root. Fetches the trip and hydrates Dexie. The return value is
 * for status/among (loading, error) only — screens must read their data from Dexie, not
 * from `data` here, per the data-layering rule.
 */
export function useHydrate() {
  return useQuery({
    queryKey: ['hydrate'],
    queryFn: async () => {
      // Flush before fetch. Non-negotiable — see the header.
      await flushOutbox()
      const payload = await fetchAll()
      await writeToDexie(payload)
      return { at: new Date().toISOString(), counts: countsOf(payload) }
    },
    staleTime: 30_000,
    retry: 1,
  })
}

function countsOf(p: HydratePayload): Record<string, number> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, (v as unknown[]).length]))
}
