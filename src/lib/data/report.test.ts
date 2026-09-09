import { describe, it, expect } from 'vitest'
import { buildRoundReport } from './report'
import type { Db } from './compute'
import type { PlayerRow, CourseRow, TeeRow, HoleRow, RoundRow, RoundPlayerRow, ScoreRow } from './types'

// Three scratch players (index 0, rating 72 / slope 113 / par 72 → net == gross), two rounds on
// one all-par-4 course. The third plays level par both days so the story never needs him — the
// "everyone is named" rule has to. Points then read straight off the gross: birdie 3, par 2, bogey 1,
// double 0 — so the report's facts can be asserted by hand.

const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'
const P3 = '33333333-3333-3333-3333-333333333333'
const COURSE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const TEE = 'tttttttt-tttt-tttt-tttt-tttttttttttt'
const R1 = 'r1r1r1r1-r1r1-r1r1-r1r1-r1r1r1r1r1r1'
const R2 = 'r2r2r2r2-r2r2-r2r2-r2r2-r2r2r2r2r2r2'

function holesFor(courseId: string): HoleRow[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: `${courseId}-h${i + 1}`,
    course_id: courseId,
    hole_number: i + 1,
    par: 4,
    stroke_index: i + 1,
  }))
}

function roundPlayer(playerId: string, roundId: string): RoundPlayerRow {
  return {
    round_id: roundId,
    player_id: playerId,
    tee_id: TEE,
    index_used: 0,
    allowance_used: 1,
    cap_used: 18,
    course_handicap: 0,
    playing_handicap: 0,
    cap_applied: false,
    strokes_received: 0,
    manual_override: null,
    status: 'playing',
  }
}

/** Par everywhere, with per-hole gross deltas (−1 birdie, +1 bogey, +2 double). */
function scoresFor(playerId: string, roundId: string, deltas: Record<number, number> = {}): ScoreRow[] {
  return Array.from({ length: 18 }, (_, i) => {
    const n = i + 1
    return {
      id: `${playerId}-${roundId}-s${n}`,
      round_id: roundId,
      player_id: playerId,
      hole_number: n,
      gross_strokes: 4 + (deltas[n] ?? 0),
      picked_up: false,
    }
  })
}

function makeDb(r2Status: RoundRow['status'], r2Thru = 18, p3SitsOutR2 = false): Db {
  const players: PlayerRow[] = [
    { id: P1, name: 'Jon Aronson', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 0 } as unknown as PlayerRow,
    { id: P2, name: 'Chris Denove', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 1 } as unknown as PlayerRow,
    { id: P3, name: 'Adam Hersh', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 2 } as unknown as PlayerRow,
  ]
  const courses: CourseRow[] = [{ id: COURSE, name: 'Streamsong Blue', data_is_placeholder: false } as unknown as CourseRow]
  const tees: TeeRow[] = [{ id: TEE, course_id: COURSE, name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 6500 } as unknown as TeeRow]
  const rounds: RoundRow[] = [
    { id: R1, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status: 'final', holes_counted: null },
    { id: R2, round_number: 2, date: '2027-02-05', course_id: COURSE, tee_time: null, status: r2Status, holes_counted: null },
  ]
  return {
    players,
    courses,
    tees,
    holes: holesFor(COURSE),
    hole_yardages: [],
    rounds,
    round_players: [
      roundPlayer(P1, R1),
      roundPlayer(P2, R1),
      roundPlayer(P3, R1),
      roundPlayer(P1, R2),
      roundPlayer(P2, R2),
      { ...roundPlayer(P3, R2), status: p3SitsOutR2 ? 'did_not_play' : 'playing' },
    ],
    scores: [
      // R1: Aronson birdies 1 → 37, Denove level par → 36. Aronson leads wire to wire.
      ...scoresFor(P1, R1, { 1: -1 }),
      ...scoresFor(P2, R1),
      ...scoresFor(P3, R1),
      // R2: Denove trails at the turn (Aronson birdies 2), then birdies 15 to take the lead as
      // Aronson doubles it. Aronson's 15–17 (0 + 1 + 1 = 2 points) is the worst stretch.
      ...scoresFor(P1, R2, { 2: -1, 15: 2, 16: 1, 17: 1 }).slice(0, r2Thru),
      ...scoresFor(P2, R2, { 15: -1 }).slice(0, r2Thru),
      ...(p3SitsOutR2 ? [] : scoresFor(P3, R2).slice(0, r2Thru)),
    ],
    ctp_results: [],
    settings: [],
  }
}

const text = (vm: NonNullable<ReturnType<typeof buildRoundReport>>) =>
  vm.paragraphs.map((p) => p.map((s) => s.text).join('')).join('\n')

describe('buildRoundReport', () => {
  it('is null while the round is still in progress', () => {
    expect(buildRoundReport(2, makeDb('in_progress', 12))).toBeNull()
  })

  it('round 1: winner, wire-to-wire, leads the week — and names the whole field', () => {
    const vm = buildRoundReport(1, makeDb('final'))!
    expect(vm.headline).toBe('Jon takes the Blue and leads the week.')
    const body = text(vm)
    expect(body).toContain('Jon Aronson won the Blue with 37 points, 1 clear of the field.')
    expect(body).toContain('Aronson led from the 1st and was never caught.')
    expect(body).toContain('Nobody had a three-hole stretch worse than 6 points.')
    // Denove and Hersh tie for 2nd; whoever the week line does not name gets a field line.
    expect(body).toMatch(/(Chris Denove|Adam Hersh) finished 2nd with 36 points, 1 back\./)
    expect(body).toMatch(/Jon Aronson leads the week at 37, 1 clear of (Denove|Hersh)\. One round to go\./)
    expect(body).not.toContain('biggest jump') // no prior round to improve on
    for (const last of ['Aronson', 'Denove', 'Hersh']) expect(body).toContain(last)
    expect(vm.dateline).toBe('Streamsong Blue · Thu, Feb 4')
    expect(vm.latest).toBe(false) // round 2 has been played — this report opens collapsed
  })

  it('round 2: from behind at the turn, the turning hole, worst stretch, the week — everyone named', () => {
    const vm = buildRoundReport(2, makeDb('final'))!
    // Denove 37 (birdie 15), Hersh 36, Aronson 36 + 1 − 2 − 1 − 1 = 33.
    // Overall: Denove 73, Hersh 72, Aronson 70. Last round of the trip, so the week is decided.
    expect(vm.headline).toBe('Chris takes the Blue and the week.')
    const body = text(vm)
    expect(body).toContain(
      'Chris Denove won the Blue with 37 points, 1 clear of the field. Denove was behind at the turn — the first round this week won from there.',
    )
    expect(body).toContain('It turned on the 15th: Denove made a net birdie there while Jon Aronson, the leader through 14, made a zero.')
    expect(body).toContain('Chris Denove posted 37, 1 better than at Blue, the biggest jump of the day.')
    expect(body).toContain('Worst stretch of the day: Jon Aronson, 2 points across the 15th through 17th. Aronson is 3rd overall, 3 back.')
    expect(body).toContain('Adam Hersh finished 2nd with 36 points, 1 back.')
    expect(body).toContain('Chris Denove wins the week at 73, 1 clear of Hersh.')
    expect(vm.dayLabel).toBe('Day 2 of 2')
    expect(vm.latest).toBe(true)
  })

  it('names a player who sat out', () => {
    const body = text(buildRoundReport(2, makeDb('final', 18, true))!)
    expect(body).toContain('Adam Hersh sat out.')
    expect(body).not.toContain('Adam Hersh finished')
  })
})
