import { describe, it, expect } from 'vitest'
import { buildStrokesCards, nextRoundNumber, strokesCardFilename } from './strokesCard'
import type { Db } from './compute'
import type { PlayerRow, CourseRow, TeeRow, HoleRow, RoundRow, RoundPlayerRow } from './types'

// Two rounds on one course: R1 final, R2 upcoming. Rating 72 / slope 113 / par 72 so each
// player's course handicap equals their index; Kyle 12, Jon 8, Adam 15 → off the low man
// (Jon) Kyle gets 4 and Adam 7. Stroke index is hole number reversed (18 = SI 1) so the
// allocation is easy to read: SI 1..4 are holes 18, 17, 16, 15.
const RED = 'c0000000-0000-0000-0000-0000000000red'
const TEE = 't0000000-0000-0000-0000-0000000gold'
const R1 = 'r0000000-0000-0000-0000-000000000001'
const R2 = 'r0000000-0000-0000-0000-000000000002'
const KYLE = 'p0000000-0000-0000-0000-00000000kyle'
const JON = 'p0000000-0000-0000-0000-000000000jon'
const ADAM = 'p0000000-0000-0000-0000-00000000adam'

const players: PlayerRow[] = [
  { id: JON, name: 'Jon Aronson', handicap_index: 8, sort_order: 0 } as unknown as PlayerRow,
  { id: KYLE, name: 'Kyle Siegel', handicap_index: 12, sort_order: 1 } as unknown as PlayerRow,
  { id: ADAM, name: 'Adam Hersh', handicap_index: 15, sort_order: 2 } as unknown as PlayerRow,
]
const courses: CourseRow[] = [{ id: RED, name: 'Streamsong Red', data_is_placeholder: false } as unknown as CourseRow]
const tees: TeeRow[] = [{ id: TEE, course_id: RED, name: 'Gold', rating: 72, slope: 113, par: 72, total_yardage: 6500 }]
const holes: HoleRow[] = Array.from({ length: 18 }, (_, i) => ({
  id: `h${i + 1}`,
  course_id: RED,
  hole_number: i + 1,
  par: 4,
  stroke_index: 19 - (i + 1),
})) as unknown as HoleRow[]

function round(id: string, n: number, status: RoundRow['status']): RoundRow {
  return { id, round_number: n, date: `2027-02-0${3 + n}`, course_id: RED, tee_time: `2027-02-0${3 + n}T13:40:00-05:00`, status, holes_counted: null }
}
function rp(roundId: string, playerId: string, status: RoundPlayerRow['status'] = 'playing'): RoundPlayerRow {
  return {
    round_id: roundId, player_id: playerId, tee_id: TEE, index_used: 0, allowance_used: 1, cap_used: 18,
    course_handicap: 0, playing_handicap: 0, cap_applied: false, strokes_received: 0, manual_override: null, status,
  }
}

function db(over: Partial<Db> = {}): Db {
  return {
    players, courses, tees, holes, hole_yardages: [],
    rounds: [round(R1, 1, 'final'), round(R2, 2, 'upcoming')],
    round_players: [rp(R1, JON), rp(R1, KYLE), rp(R1, ADAM), rp(R2, JON), rp(R2, KYLE), rp(R2, ADAM)],
    scores: [], ctp_results: [], settings: [],
    ...over,
  }
}

describe('nextRoundNumber', () => {
  it('follows the first upcoming round, an in-progress one first, and nothing once all are final', () => {
    expect(nextRoundNumber(db())).toBe(2)
    expect(nextRoundNumber(db({ rounds: [round(R1, 1, 'in_progress'), round(R2, 2, 'upcoming')] }))).toBe(1)
    expect(nextRoundNumber(db({ rounds: [round(R1, 1, 'final'), round(R2, 2, 'final')] }))).toBe(null)
  })
})

describe('buildStrokesCards', () => {
  it('gives each playing man his strokes off the low and the holes they land on', () => {
    const cards = buildStrokesCards(db())
    const kyle = cards.get(KYLE)!
    expect(kyle.roundNumber).toBe(2)
    expect(kyle.courseName).toBe('Streamsong Red')
    expect(kyle.courseSlug).toBe('red')
    expect(kyle.teeName).toBe('Gold')
    expect(kyle.teeTime).toBe('1:40 PM ET')
    expect(kyle.strokesToday).toBe(4)
    expect(kyle.strokeHoles).toEqual([15, 16, 17, 18]) // SI 4,3,2,1 — ascending by hole
    expect(kyle.strokesByHole).toHaveLength(18)
    expect(kyle.strokesByHole[17]).toBe(1)
    expect(kyle.strokesByHole[0]).toBe(0)
    expect(kyle.isLowMan).toBe(false)
    expect(kyle.lowMan).toEqual({ name: 'Jon Aronson', firstName: 'Jon' })
    expect(kyle.handicap).toEqual({ index: 12, courseHandicap: 12, playingHandicap: 12, lowStrokes: 8 })

    const adam = cards.get(ADAM)!
    expect(adam.strokesToday).toBe(7)
    expect(adam.strokeHoles).toEqual([12, 13, 14, 15, 16, 17, 18])
  })

  it('the low man plays scratch and names nobody', () => {
    const jon = buildStrokesCards(db()).get(JON)!
    expect(jon.strokesToday).toBe(0)
    expect(jon.strokeHoles).toEqual([])
    expect(jon.isLowMan).toBe(true)
    expect(jon.lowMan).toBe(null)
  })

  it('a did-not-play man has no card and does not set the low', () => {
    const cards = buildStrokesCards(
      db({ round_players: [rp(R1, JON), rp(R1, KYLE), rp(R1, ADAM), rp(R2, JON, 'did_not_play'), rp(R2, KYLE), rp(R2, ADAM)] }),
    )
    expect(cards.has(JON)).toBe(false)
    expect(cards.get(KYLE)!.isLowMan).toBe(true) // Kyle 12 is now the low
    expect(cards.get(ADAM)!.strokesToday).toBe(3) // 15 − 12
    expect(cards.get(ADAM)!.lowMan?.firstName).toBe('Kyle')
  })

  it('carries the week line once a round has counted, and none before', () => {
    // No scores: R1 is final but every total is 0 — still a counting round, so the line exists.
    const withWeek = buildStrokesCards(db()).get(KYLE)!
    expect(withWeek.week).not.toBe(null)
    expect(withWeek.week!.total).toBe(0)
    expect(withWeek.week!.note).toContain('Aronson 0')
    expect(withWeek.week!.note).not.toContain('Siegel')

    const before = buildStrokesCards(
      db({ rounds: [round(R1, 1, 'upcoming'), round(R2, 2, 'upcoming')] }),
    ).get(KYLE)!
    expect(before.roundNumber).toBe(1)
    expect(before.week).toBe(null)
  })

  it('is empty once every round is final', () => {
    expect(buildStrokesCards(db({ rounds: [round(R1, 1, 'final'), round(R2, 2, 'final')] })).size).toBe(0)
  })

  it('names the file by round, course and first name', () => {
    const kyle = buildStrokesCards(db()).get(KYLE)!
    expect(strokesCardFilename(kyle)).toBe('bod2027-r2-red-strokes-kyle.png')
    expect(strokesCardFilename(kyle, 'lockscreen')).toBe('bod2027-r2-red-strokes-kyle-lockscreen.png')
  })
})
