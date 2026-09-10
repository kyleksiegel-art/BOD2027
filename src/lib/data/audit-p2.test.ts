import { describe, it, expect } from 'vitest'
import { buildStandings, buildRoundRecap, type Db } from './compute'
import { formatStandingBack, formatPosition } from '@/lib/format'
import type { PlayerRow, CourseRow, TeeRow, HoleRow, RoundRow, RoundPlayerRow, ScoreRow, CtpResultRow } from './types'

// Regressions from the 2026-09-09 audit, standings/recap family:
//   F-012 — Standings showed two "LEADER" rows on a tie, no "T1", and never said which
//           tiebreaker decided the order.
//   F-005 — the recap CTP chips said "carry" for a hole with no result recorded.

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const COURSE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const TEE = 'tttttttt-tttt-tttt-tttt-tttttttttttt'
const ROUND = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr'

function rp(playerId: string): RoundPlayerRow {
  return {
    round_id: ROUND, player_id: playerId, tee_id: TEE, index_used: 0, allowance_used: 1, cap_used: 18,
    course_handicap: 0, playing_handicap: 0, cap_applied: false, strokes_received: 0, manual_override: null, status: 'playing',
  }
}
function scores(playerId: string, deltas: Record<number, number>): ScoreRow[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: `${playerId}-${i + 1}`, round_id: ROUND, player_id: playerId, hole_number: i + 1,
    gross_strokes: 4 + (deltas[i + 1] ?? 0), picked_up: false,
  }))
}
function makeDb(aDeltas: Record<number, number>, bDeltas: Record<number, number>, ctp: CtpResultRow[] = []): Db {
  return {
    players: [
      { id: A, name: 'Jon Aronson', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 0 },
      { id: B, name: 'Kyle Siegel', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 1 },
    ] as unknown as PlayerRow[],
    courses: [{ id: COURSE, name: 'Streamsong Red', data_is_placeholder: false } as unknown as CourseRow],
    tees: [{ id: TEE, course_id: COURSE, name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 7000 } as unknown as TeeRow],
    holes: Array.from({ length: 18 }, (_, i) => ({ id: `h${i + 1}`, course_id: COURSE, hole_number: i + 1, par: i === 2 || i === 6 ? 3 : 4, stroke_index: i + 1 })) as HoleRow[],
    hole_yardages: [],
    rounds: [{ id: ROUND, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status: 'final', holes_counted: null }] as RoundRow[],
    round_players: [rp(A), rp(B)],
    scores: [...scores(A, aDeltas), ...scores(B, bDeltas)],
    ctp_results: ctp,
    settings: [],
  }
}

describe('standings tiebreak clarity (F-012)', () => {
  it('a countback-decided tie: positions 1/2, no shared position, a note saying how', () => {
    // Both 36 points; holes won 2–2; countback level until the 18th, where Kyle wins.
    const s = buildStandings(makeDb({ 1: -1, 18: 1 }, { 2: -1, 17: 1 }))
    expect(s.rows.map((r) => [r.name, r.position, r.tie])).toEqual([
      ['Kyle Siegel', 1, false],
      ['Jon Aronson', 2, false],
    ])
    expect(s.rows[0].total).toBe(s.rows[1].total) // level on points
    expect(s.tiebreakNote).toMatch(/Kyle leads on countback, R1 hole 18/)
    // The runner-up is level on points but must NOT read "LEADER".
    expect(formatStandingBack(s.rows[1].position, s.rows[1].gapToLeader)).toBe('LEVEL')
    expect(formatStandingBack(s.rows[0].position, s.rows[0].gapToLeader)).toBe('LEADER')
  })

  it('a genuinely unbreakable tie: both share position 1 and render T1', () => {
    const s = buildStandings(makeDb({ 1: -1 }, { 1: -1 })) // identical cards
    expect(s.rows.every((r) => r.position === 1 && r.tie)).toBe(true)
    expect(s.tiebreakNote).toMatch(/level after every tiebreaker/)
    expect(formatPosition(s.rows[0].position, s.rows[0].tie)).toBe('T1')
  })

  it('a clear points lead needs no note', () => {
    const s = buildStandings(makeDb({ 1: -1, 2: -1 }, {}))
    expect(s.rows[0].position).toBe(1)
    expect(s.rows[0].tie).toBe(false)
    expect(s.tiebreakNote).toBeNull()
  })
})

describe('recap CTP labels (F-005)', () => {
  it('distinguishes a recorded no-winner from a hole with nothing entered', () => {
    // Par 3s are holes 3 and 7. Record an explicit no-winner on hole 3; leave hole 7 blank.
    const noWinner: CtpResultRow = {
      id: 'ctp1', round_id: ROUND, hole_number: 3, player_id: null, distance_feet: null,
      client_updated_at_raw: '2027-02-04T20:00:00Z', client_updated_at_effective: '2027-02-04T20:00:00Z', client_id: A,
    } as unknown as CtpResultRow
    const recap = buildRoundRecap(1, makeDb({}, {}, [noWinner]))!
    const byHole = new Map(recap.ctpWinners.map((c) => [c.holeNumber, c]))
    expect(byHole.get(3)).toMatchObject({ name: null, recorded: true })
    expect(byHole.get(7)).toMatchObject({ name: null, recorded: false, open: false })
  })
})
