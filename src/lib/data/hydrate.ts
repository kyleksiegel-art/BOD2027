// The one place the network touches the read model. TanStack Query fetches every public
// table and writes the rows into Dexie; nothing else in the app calls Supabase for reads.
// Components subscribe to Dexie (useLiveQuery) and re-render when this bulkPut lands.
//
// This is deliberately a full-table pull, not a delta sync: the whole trip is a few
// hundred rows, and the real incremental path (Realtime + comparator + outbox) is Phase 6.
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
} from './types'

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
  settings: SettingRow[]
}

async function fetchAll(): Promise<HydratePayload> {
  const [players, courses, tees, holes, hole_yardages, rounds, round_players, scores, settings] =
    await Promise.all([
      selectAll<PlayerRow>('players'),
      selectAll<CourseRow>('courses'),
      selectAll<TeeRow>('tees'),
      selectAll<HoleRow>('holes'),
      selectAll<HoleYardageRow>('hole_yardages'),
      selectAll<RoundRow>('rounds'),
      selectAll<RoundPlayerRow>('round_players'),
      selectAll<ScoreRow>('scores'),
      selectAll<SettingRow>('settings'),
    ])
  return { players, courses, tees, holes, hole_yardages, rounds, round_players, scores, settings }
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
      db.settings,
    ],
    async () => {
      // bulkPut is an idempotent upsert on the primary key — a re-hydrate overwrites in
      // place. (A true delete-then-reconcile belongs to the Phase 6 comparator, which must
      // never blow away unsynced local writes; there are none in read-only Phase 4.)
      await Promise.all([
        db.players.bulkPut(p.players),
        db.courses.bulkPut(p.courses),
        db.tees.bulkPut(p.tees),
        db.holes.bulkPut(p.holes),
        db.hole_yardages.bulkPut(p.hole_yardages),
        db.rounds.bulkPut(p.rounds),
        db.round_players.bulkPut(p.round_players),
        db.scores.bulkPut(p.scores),
        db.settings.bulkPut(p.settings),
      ])
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
