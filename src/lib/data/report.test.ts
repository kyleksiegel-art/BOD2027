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

  it('round 1: a close win with no big stretch, every player named', () => {
    const vm = buildRoundReport(1, makeDb('final'))!
    // Jon birdies the 1st (37); Chris and Adam par everything (36). Nobody swings 4+ points over
    // any 3–6 holes, so there is no stretch: the report says when the lead was won.
    expect(vm.kind).toBe('close')
    expect(vm.stretch).toBeNull()
    expect(vm.headline).toMatch(/^Jon holds off (Chris|Adam) by 1\.$/)
    const body = text(vm)
    expect(body).toMatch(/Jon led from the 1st and was never caught, finishing 1 clear of (Chris|Adam)\./)
    for (const first of ['Jon', 'Chris', 'Adam']) expect(body).toContain(first)
    expect(body).toMatch(/Jon leads the week by 1\. The Blue tomorrow, one round to go\./)
    expect(vm.dateline).toBe('Streamsong Blue · Thu, Feb 4')
    expect(vm.latest).toBe(false) // round 2 has been played: this report opens collapsed
  })

  it('round 2: the lead won late, and the week decided', () => {
    const vm = buildRoundReport(2, makeDb('final'))!
    // Jon birdies the 2nd and leads by 1 through 14; Chris birdies 15 as Jon doubles it.
    // A 1-point deficit is no comeback (that needs 3), so it reads as a close finish.
    expect(vm.kind).toBe('close')
    const body = text(vm)
    expect(body).toContain('Chris took the lead for good on the 15th with a birdie, finishing 1 clear of Adam.')
    expect(body).toContain('Chris wins the week by 1.')
    expect(body).not.toMatch(/tomorrow|to go/)
    expect(vm.dayLabel).toBe('Day 2 of 2')
    expect(vm.latest).toBe(true)
  })

  it('names a player who sat out', () => {
    const body = text(buildRoundReport(2, makeDb('final', 18, true))!)
    expect(body).toContain('Adam sat out.')
    expect(body).not.toContain('Adam finished')
  })
})
