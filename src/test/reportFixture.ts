import type { Db } from '@/lib/data/compute'
import type { PlayerRow, CourseRow, TeeRow, HoleRow, RoundRow, RoundPlayerRow, ScoreRow, CtpResultRow } from '@/lib/data/types'

// Builds a Db from per-hole POINTS, so report tests read like a scorecard. Rating 72 / slope 113
// / par 72 → course handicap == index, allowance 100%, so `strokes` is exactly what each player
// gets (play off the low: give the low player 0). Gross is back-solved: par + stroke + 2 − points
// (0 points → net double).

export const RED_PARS = [4, 5, 4, 4, 4, 3, 5, 3, 4, 4, 4, 4, 5, 3, 4, 3, 4, 5]
export const RED_SI = [4, 2, 14, 16, 6, 18, 12, 10, 8, 9, 5, 3, 15, 11, 1, 7, 13, 17]

export interface FixturePlayer {
  name: string
  strokes: number
  pts: number[] // 18 values
}

const COURSES = ['Streamsong Red', 'Streamsong Blue', 'Streamsong Black', 'Streamsong Bone Valley']
const pid = (i: number) => `0000000${i}-0000-0000-0000-000000000000`
const cid = (i: number) => `c000000${i}-0000-0000-0000-000000000000`
const rid = (i: number) => `r000000${i}-0000-0000-0000-000000000000`
const tid = (i: number) => `t000000${i}-0000-0000-0000-000000000000`

export function reportDb(
  players: FixturePlayer[],
  opts: { status?: RoundRow['status']; ctp?: Record<number, number>; pars?: number[]; si?: number[] } = {},
): Db {
  const pars = opts.pars ?? RED_PARS
  const si = opts.si ?? RED_SI
  const holes: HoleRow[] = []
  const tees: TeeRow[] = []
  const courses: CourseRow[] = []
  const rounds: RoundRow[] = []
  COURSES.forEach((name, c) => {
    courses.push({ id: cid(c), name, data_is_placeholder: false } as unknown as CourseRow)
    tees.push({ id: tid(c), course_id: cid(c), name: 'Black', rating: 72, slope: 113, par: 72, total_yardage: 6800 } as unknown as TeeRow)
    for (let h = 0; h < 18; h++) holes.push({ id: `${cid(c)}-h${h + 1}`, course_id: cid(c), hole_number: h + 1, par: pars[h], stroke_index: si[h] })
    rounds.push({
      id: rid(c), round_number: c + 1, date: `2027-02-0${4 + c}`, course_id: cid(c), tee_time: null,
      status: c === 0 ? opts.status ?? 'final' : 'upcoming', holes_counted: null,
    })
  })
  const playerRows = players.map((p, i) => ({
    id: pid(i), name: p.name, title: null, handicap_index: p.strokes, index_is_assigned: false,
    index_updated_at: null, photo_url: null, sort_order: i,
  })) as unknown as PlayerRow[]
  const round_players: RoundPlayerRow[] = players.map((p, i) => ({
    round_id: rid(0), player_id: pid(i), tee_id: tid(0), index_used: p.strokes, allowance_used: 1, cap_used: 18,
    course_handicap: p.strokes, playing_handicap: p.strokes, cap_applied: false, strokes_received: p.strokes,
    manual_override: null, status: 'playing',
  }))
  const scores: ScoreRow[] = players.flatMap((p, i) =>
    p.pts.map((pt, h) => {
      const stroke = si[h] <= p.strokes ? 1 : 0
      return {
        id: `${pid(i)}-${h + 1}`, round_id: rid(0), player_id: pid(i), hole_number: h + 1,
        gross_strokes: pars[h] + stroke + 2 - pt, picked_up: false,
      } as ScoreRow
    }),
  )
  const ctp_results = Object.entries(opts.ctp ?? {}).map(([hole, who]) => ({
    round_id: rid(0), hole_number: Number(hole), player_id: pid(who),
  })) as unknown as CtpResultRow[]
  return { players: playerRows, courses, tees, holes, hole_yardages: [], rounds, round_players, scores, ctp_results, settings: [] }
}

/** The real Round 1 on the hosted DB (2026-10-02), points read off the scorecard. */
export const ROUND_ONE: FixturePlayer[] = [
  { name: 'Jon Aronson', strokes: 0, pts: [1, 0, 1, 1, 1, 3, 0, 3, 1, 3, 2, 1, 2, 2, 2, 2, 2, 4] },
  { name: 'Kyle Siegel', strokes: 4, pts: [2, 2, 1, 3, 1, 2, 0, 1, 3, 1, 2, 4, 2, 2, 3, 2, 2, 3] },
  { name: 'Adam Hersh', strokes: 0, pts: [1, 1, 0, 3, 1, 1, 0, 1, 1, 3, 1, 1, 2, 2, 2, 2, 2, 3] },
  { name: 'Chris Denove', strokes: 8, pts: [2, 3, 3, 1, 2, 3, 4, 3, 4, 1, 4, 2, 2, 2, 3, 3, 2, 0] },
]
