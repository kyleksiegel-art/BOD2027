import { describe, it, expect } from 'vitest'
import { buildFieldReport } from './wire'
import type { Db } from './compute'
import type { PlayerRow, CourseRow, TeeRow, HoleRow, RoundRow, RoundPlayerRow, ScoreRow, CtpResultRow } from './types'

// Three scratch players (net == gross) on a course of par 4s with a par 3 at the 3rd, one round
// in progress through hole 4. Points read straight off the gross: birdie 3, par 2, bogey 1,
// double 0 — so every line can be asserted by hand.

const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'
const P3 = '33333333-3333-3333-3333-333333333333'
const COURSE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const TEE = 'tttttttt-tttt-tttt-tttt-tttttttttttt'
const R1 = 'r1r1r1r1-r1r1-r1r1-r1r1-r1r1r1r1r1r1'

function holesFor(courseId: string): HoleRow[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: `${courseId}-h${i + 1}`,
    course_id: courseId,
    hole_number: i + 1,
    par: i + 1 === 3 ? 3 : 4,
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

/** Gross per hole for holes 1..thru: par plus a delta (−1 birdie, +1 bogey, +2 double); 'pu' = picked up. */
function scoresFor(playerId: string, thru: number, deltas: Record<number, number | 'pu'> = {}): ScoreRow[] {
  return Array.from({ length: thru }, (_, i) => {
    const n = i + 1
    const par = n === 3 ? 3 : 4
    const d = deltas[n]
    return {
      id: `${playerId}-s${n}`,
      round_id: R1,
      player_id: playerId,
      hole_number: n,
      gross_strokes: d === 'pu' ? null : par + (d ?? 0),
      picked_up: d === 'pu',
      client_updated_at_effective: `2027-02-04T${String(13 + n).padStart(2, '0')}:${String(10 * n).padStart(2, '0')}:00Z`,
    }
  })
}

function makeDb(status: RoundRow['status'] = 'in_progress'): Db {
  const players: PlayerRow[] = [
    { id: P1, name: 'Jon Aronson', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 0 } as unknown as PlayerRow,
    { id: P2, name: 'Chris Denove', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 1 } as unknown as PlayerRow,
    { id: P3, name: 'Adam Hersh', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 2 } as unknown as PlayerRow,
  ]
  const courses: CourseRow[] = [{ id: COURSE, name: 'Streamsong Red', data_is_placeholder: false } as unknown as CourseRow]
  const tees: TeeRow[] = [{ id: TEE, course_id: COURSE, name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 6500 } as unknown as TeeRow]
  const rounds: RoundRow[] = [{ id: R1, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status, holes_counted: null }]
  const ctp: CtpResultRow[] = [{ id: 'ctp3', round_id: R1, hole_number: 3, player_id: P3, distance_feet: 4 }]
  return {
    players,
    courses,
    tees,
    holes: holesFor(COURSE),
    hole_yardages: [],
    rounds,
    round_players: [roundPlayer(P1, R1), roundPlayer(P2, R1), roundPlayer(P3, R1)],
    scores: [
      // H1: all par. H2: Aronson birdie (leads). H3 (par 3): all par, Hersh CTP.
      // H4: Denove birdie + Aronson double → Denove takes the lead; Hersh picks up.
      ...scoresFor(P1, 4, { 2: -1, 4: 2 }),
      ...scoresFor(P2, 4, { 4: -1 }),
      ...scoresFor(P3, 4, { 4: 'pu' }),
    ],
    ctp_results: ctp,
    settings: [],
  }
}

const text = (e: { segs: { text: string }[] }) => e.segs.map((x) => x.text).join('')

describe('buildFieldReport', () => {
  it('is null before any hole is saved', () => {
    const db = makeDb()
    db.scores = []
    expect(buildFieldReport(db)).toBeNull()
  })

  it('follows the live round, newest hole first, with the clock from the latest save', () => {
    const vm = buildFieldReport(makeDb())!
    expect(vm.live).toBe(true)
    expect(vm.roundThru).toBe(4)
    expect(vm.holes.map((h) => h.holeNumber)).toEqual([4, 3, 2, 1])
    expect(vm.holes[0].timeLabel).toBe('12:40') // 17:40Z → 12:40 ET
    expect(vm.holes[1].par).toBe(3)
  })

  it('collapses a hole where the field did the same thing', () => {
    const vm = buildFieldReport(makeDb())!
    const h1 = vm.holes.find((h) => h.holeNumber === 1)!
    // Hole 1 is the opener — no "no movement" collapse there (positions have not been set).
    expect(h1.events.map(text)).toEqual(['Aronson pars the 1st.', 'Denove pars the 1st.', 'Hersh pars the 1st.'])
    const h3 = vm.holes.find((h) => h.holeNumber === 3)!
    expect(h3.events.map(text)).toEqual(['Hersh takes closest to pin on the 3rd.', 'Field pars the 3rd. No movement.'])
    expect(h3.events[1].meta).toBe('2 pts each')
    expect(h3.events[0].kind).toBe('ctp')
  })

  it('writes the lead change first, then the move, then the rest', () => {
    const vm = buildFieldReport(makeDb())!
    const h2 = vm.holes.find((h) => h.holeNumber === 2)!
    expect(text(h2.events[0])).toBe('Aronson birdies the 2nd. Takes the lead by 1.')
    expect(h2.events[0].emphasis).toBe(true)
    expect(h2.events[0].meta).toBe('net birdie · 3 pts · lead change')
    // The opening tie is nobody's lead: the others slip, they do not "lose the lead".
    expect(text(h2.events[1])).toBe('Denove pars the 2nd. Slips to 2nd, 1 back of Aronson.')
    expect(h2.events[1].kind).toBe('move')

    const h4 = vm.holes.find((h) => h.holeNumber === 4)!
    const lines = h4.events.map(text)
    // Cumulative after 4: Denove 9, Aronson 7, Hersh 6 — Denove takes it, Aronson drops, Hersh slips.
    expect(lines[0]).toBe('Denove birdies the 4th. Takes the lead by 2.')
    expect(lines[1]).toBe('Aronson doubles the 4th. Drops to 2nd, 2 back of Denove. First zero of the round.')
    expect(lines[2]).toBe('Hersh picks up on the 4th. Slips to 3rd, 3 back of Denove. First zero of the round.')
    expect(h4.events[2].meta).toBe('picked up · 0 pts · position change')
    // The strip reads the top of the newest hole.
    expect(vm.latestHole).toBe(4)
    expect(text(vm.latest!)).toBe(lines[0])
    expect(vm.moreOnLatestHole).toBe(2)
  })

  it('falls back to the latest final round between rounds', () => {
    const vm = buildFieldReport(makeDb('final'))!
    expect(vm.live).toBe(false)
    expect(vm.roundNumber).toBe(1)
  })
})
