// Read-only hooks the screens use. Each subscribes to Dexie via useLiveQuery and runs the
// pure assembly in compute.ts. Screens import ONLY from here — never Dexie or scoring
// directly — so the data-layering rule stays enforceable by grep.
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import {
  buildStandings,
  buildRoundDetail,
  buildRoundRecap,
  buildRoundsList,
  buildChampionships,
  buildEnterHole,
  buildAdmin,
  buildItinerary,
  buildLodging,
  buildCoursesIndex,
  buildCourseDetail,
  buildPlayerCourseHandicaps,
  type AdminVM,
  type Db,
  type EnterVM,
  type EnterDraft,
  type StandingsVM,
  type RoundDetailVM,
  type RoundRecapVM,
  type RoundListItemVM,
  type ItineraryVM,
  type LodgingVM,
  type CourseIndexItemVM,
  type CourseDetailVM,
  type PlayerCourseHandicapVM,
} from './compute'
import { buildMoney, type MoneyVM } from './money'
import { totalPoints } from '@/lib/scoring'
import type { ScorePayload, CtpPayload } from './types'
import type { PlayerRow, RoundRow } from './types'

/** Load the whole read model out of Dexie. Re-runs whenever any table changes. */
function useDbData(): Db | undefined {
  return useLiveQuery(async () => {
    const [
      players, courses, tees, holes, hole_yardages, rounds, round_players, scores, ctp_results,
      settings, itinerary_items, lodging, lodging_assignments,
    ] = await Promise.all([
        db.players.toArray(),
        db.courses.toArray(),
        db.tees.toArray(),
        db.holes.toArray(),
        db.hole_yardages.toArray(),
        db.rounds.toArray(),
        db.round_players.toArray(),
        db.scores.toArray(),
        db.ctp_results.toArray(),
        db.settings.toArray(),
        db.itinerary_items.toArray(),
        db.lodging.toArray(),
        db.lodging_assignments.toArray(),
      ])
    return {
      players, courses, tees, holes, hole_yardages, rounds, round_players, scores, ctp_results,
      settings, itinerary_items, lodging, lodging_assignments,
    } satisfies Db
  }, [])
}

/** Read a single settings value from Dexie (e.g. the assigned-index footnote). */
export function useSetting<T = unknown>(key: string): T | undefined {
  return useLiveQuery(async () => {
    const row = await db.settings.get(key)
    return row?.value as T | undefined
  }, [key])
}

export function useStandings(): StandingsVM | undefined {
  const data = useDbData()
  return useMemo(() => (data ? buildStandings(data) : undefined), [data])
}

export function useRoundsList(): RoundListItemVM[] | undefined {
  const data = useDbData()
  return useMemo(() => (data ? buildRoundsList(data) : undefined), [data])
}

export function useRoundDetail(roundNumber: number): { vm: RoundDetailVM | null; loading: boolean } {
  const data = useDbData()
  const vm = useMemo(() => (data ? buildRoundDetail(roundNumber, data) : null), [data, roundNumber])
  return { vm, loading: data === undefined }
}

/** The post-round recap for one round, or null until play has begun. */
export function useRoundRecap(roundNumber: number): RoundRecapVM | null {
  const data = useDbData()
  return useMemo(() => (data ? buildRoundRecap(roundNumber, data) : null), [data, roundNumber])
}

export interface PlayerCardVM {
  player: PlayerRow
  championshipTotal: number
  courseHandicaps: PlayerCourseHandicapVM[]
}

export function usePlayers(): PlayerCardVM[] | undefined {
  const data = useDbData()
  return useMemo(() => {
    if (!data) return undefined
    const champs = buildChampionships(data)
    const totalById = new Map(champs.map((c) => [c.playerId, totalPoints(c.byRound)]))
    const handicapsByPlayer = buildPlayerCourseHandicaps(data)
    return data.players
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((player) => ({
        player,
        championshipTotal: totalById.get(player.id) ?? 0,
        courseHandicaps: handicapsByPlayer.get(player.id) ?? [],
      }))
  }, [data])
}

/** The public itinerary timeline. "Today" is decided in America/New_York inside compute. */
export function useItinerary(): ItineraryVM | undefined {
  const data = useDbData()
  return useMemo(() => (data ? buildItinerary(data) : undefined), [data])
}

/** Lodging properties with their room assignments. */
export function useLodging(): LodgingVM | undefined {
  const data = useDbData()
  return useMemo(() => (data ? buildLodging(data) : undefined), [data])
}

/** The courses index, ordered by the round that plays each. */
export function useCoursesIndex(): CourseIndexItemVM[] | undefined {
  const data = useDbData()
  return useMemo(() => (data ? buildCoursesIndex(data) : undefined), [data])
}

/** One course's scorecard, or null when the id is unknown. */
export function useCourseDetail(courseId: string | undefined): {
  vm: CourseDetailVM | null
  loading: boolean
} {
  const data = useDbData()
  const vm = useMemo(
    () => (data && courseId ? buildCourseDetail(courseId, data) : null),
    [data, courseId],
  )
  return { vm, loading: data === undefined }
}

/** The whole money ledger — pots, per-round breakdown, payouts, settlement, reconciliation. */
export function useMoney(): MoneyVM | undefined {
  const data = useDbData()
  return useMemo(() => (data ? buildMoney(data) : undefined), [data])
}

/**
 * CTP entry within a round: the round detail plus the current CTP row for each par 3, keyed
 * by hole number. Reads Dexie, so a queued CTP result re-renders here with no extra plumbing.
 */
export function useRoundCtp(roundNumber: number): {
  vm: RoundDetailVM | null
  ctpByHole: Map<number, CtpPayload>
  loading: boolean
} {
  const data = useDbData()
  return useMemo(() => {
    if (!data) return { vm: null, ctpByHole: new Map(), loading: true }
    const vm = buildRoundDetail(roundNumber, data)
    const ctpByHole = new Map<number, CtpPayload>()
    if (vm) {
      for (const c of data.ctp_results) {
        if (c.round_id !== vm.round.id) continue
        ctpByHole.set(c.hole_number, {
          round_id: c.round_id,
          hole_number: c.hole_number,
          player_id: c.player_id,
          distance_feet: c.distance_feet,
        })
      }
    }
    return { vm, ctpByHole, loading: false }
  }, [data, roundNumber])
}

/**
 * The Enter screen's view model for one hole of one round. Like every other selector it
 * reads Dexie and runs pure assembly — the write path puts the server's rows back into
 * Dexie, so a saved score re-renders here with no extra plumbing.
 */
export function useEnterHole(
  roundNumber: number,
  holeNumber: number,
  drafts: Record<string, EnterDraft> = {},
): { vm: EnterVM | null; loading: boolean } {
  const data = useDbData()
  const vm = useMemo(
    () => (data ? buildEnterHole(roundNumber, holeNumber, data, drafts) : null),
    [data, roundNumber, holeNumber, drafts],
  )
  return { vm, loading: data === undefined }
}

/** Every round, in play order — the Enter screen's round picker. */
export function useRoundChoices(): { roundNumber: number; courseName: string; status: RoundRow['status'] }[] | undefined {
  const data = useDbData()
  return useMemo(() => {
    if (!data) return undefined
    const byId = new Map(data.courses.map((c) => [c.id, c]))
    return data.rounds
      .slice()
      .sort((a, b) => a.round_number - b.round_number)
      .map((r) => ({
        roundNumber: r.round_number,
        courseName: byId.get(r.course_id)?.name ?? 'Course',
        status: r.status,
      }))
  }, [data])
}

/**
 * The /admin view model. Same rule as every other screen: Dexie in, pure assembly out.
 * Admin writes invalidate the hydrate query, which refills Dexie, which re-runs this.
 */
export function useAdmin(): AdminVM | undefined {
  const data = useDbData()
  return useMemo(() => (data ? buildAdmin(data) : undefined), [data])
}

/**
 * Holes in this round with a write still owed to the server. Read straight off the outbox
 * through useLiveQuery, exactly like every other read — "unsynced" is durable state on the
 * device, not something a component can hold in useState and lose on a re-mount.
 */
export function usePendingHoles(roundId: string | null): number[] {
  return (
    useLiveQuery(async () => {
      if (!roundId) return []
      const entries = await db.outbox.where('kind').equals('score').toArray()
      const holes = new Set<number>()
      for (const e of entries) {
        const p = e.payload as ScorePayload
        if (p.round_id === roundId) holes.add(p.hole_number)
      }
      return [...holes].sort((a, b) => a - b)
    }, [roundId]) ?? []
  )
}
