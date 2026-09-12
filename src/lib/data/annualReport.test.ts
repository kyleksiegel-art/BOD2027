import { describe, it, expect } from 'vitest'
import { buildAnnualReport } from './annualReport'
import type { Db } from './compute'
import type {
  PlayerRow,
  CourseRow,
  TeeRow,
  HoleRow,
  RoundRow,
  RoundPlayerRow,
  ScoreRow,
  CtpResultRow,
  SettingRow,
} from './types'

// Three scratch players (index 0, rating 72 / slope 113 / par 72 → net == gross), two rounds on
// one all-par-4 course. Points read straight off the gross — birdie 3, par 2, double 0 — so the
// whole report can be asserted by hand:
//   R1: Aronson birdies 1 & 2 → 38; Denove level → 36; Hersh doubles the 5th → 34.
//   R2: Aronson level → 36; Denove birdies 1 → 37; Hersh level → 36.
//   Overall: Aronson 74, Denove 73, Hersh 70. Aronson leads wire to wire and takes the season.

const P1 = '11111111-1111-1111-1111-111111111111' // Jon Aronson
const P2 = '22222222-2222-2222-2222-222222222222' // Chris Denove
const P3 = '33333333-3333-3333-3333-333333333333' // Adam Hersh
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

function scoresFor(playerId: string, roundId: string, deltas: Record<number, number> = {}, thru = 18): ScoreRow[] {
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
  }).slice(0, thru)
}

const PURSE: SettingRow[] = [
  {
    key: 'purse_amounts',
    value: {
      buy_in_per_player_cents: 20000,
      champ_first_cents: 30000,
      champ_second_cents: 10000,
      round_winner_cents: 10000,
    },
  } as unknown as SettingRow,
]

function makeDb(r2Status: RoundRow['status'], r2Thru = 18): Db {
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
  const ctp: CtpResultRow[] = [
    { id: 'ctp-r1-h5', round_id: R1, hole_number: 5, player_id: P3, distance_feet: null },
  ]
  return {
    players,
    courses,
    tees,
    holes: holesFor(COURSE),
    hole_yardages: [],
    rounds,
    round_players: [
      roundPlayer(P1, R1), roundPlayer(P2, R1), roundPlayer(P3, R1),
      roundPlayer(P1, R2), roundPlayer(P2, R2), roundPlayer(P3, R2),
    ],
    scores: [
      ...scoresFor(P1, R1, { 1: -1, 2: -1 }),
      ...scoresFor(P2, R1),
      ...scoresFor(P3, R1, { 5: 2 }),
      ...scoresFor(P1, R2, {}, r2Thru),
      ...scoresFor(P2, R2, { 1: -1 }, r2Thru),
      ...scoresFor(P3, R2, {}, r2Thru),
    ],
    ctp_results: ctp,
    settings: PURSE,
  }
}

const letterText = (vm: NonNullable<ReturnType<typeof buildAnnualReport>>) =>
  vm.letter.map((p) => p.map((s) => s.text).join('')).join('\n')

describe('buildAnnualReport', () => {
  it('is null while the last round is still in progress', () => {
    expect(buildAnnualReport(makeDb('in_progress', 12))).toBeNull()
  })

  it('is null while a round is still upcoming', () => {
    expect(buildAnnualReport(makeDb('upcoming'))).toBeNull()
  })

  it('stays hidden until the round is finalized — all scores in but still in progress is not enough', () => {
    // Tied to the deliberate finalize, not "all scores in": an in_progress round with all 18
    // scores does NOT surface the capstone (Kyle 2026-09-11).
    expect(buildAnnualReport(makeDb('in_progress', 18))).toBeNull()
  })

  it('appears the moment the last round is finalized', () => {
    expect(buildAnnualReport(makeDb('final'))).not.toBeNull()
  })

  it('names the champion, the standings and the money off the same builders', () => {
    const vm = buildAnnualReport(makeDb('final'))!
    expect(vm.headline).toBe('Jon takes 2027.')
    expect(vm.dateLabel).toBe('February 4–5, 2027')
    expect(vm.champion).toMatchObject({ name: 'Jon Aronson', total: 74, shared: false })
    expect(vm.champion.winnings).toBe('$400.00') // $300 championship + $100 round win
    expect(vm.champion.winningsDetail).toBe('1st overall + one round win')

    // Standings: Aronson 74, Denove 73, Hersh 70 — clear ranking, no ties.
    expect(vm.standings.map((r) => [r.position, r.name, r.total])).toEqual([
      [1, 'Jon Aronson', 74],
      [2, 'Chris Denove', 73],
      [3, 'Adam Hersh', 70],
    ])

    // Round winners: Aronson takes R1 (38), Denove takes R2 (37).
    expect(vm.roundWinners.map((w) => [w.roundNumber, w.winnerNames[0], w.points])).toEqual([
      [1, 'Jon Aronson', 38],
      [2, 'Chris Denove', 37],
    ])

    // Money reconciles: $600 pot = $300 + $100 + 2×$100.
    expect(vm.money.totalPot).toBe('$600.00')
    expect(vm.money.balanced).toBe(true)
    expect(vm.money.balanceLabel).toBe('$600.00')
  })

  it('derives the superlatives the group asked for', () => {
    const vm = buildAnnualReport(makeDb('final'))!
    const byKey = Object.fromEntries(vm.superlatives.map((sup) => [sup.key, sup]))
    expect(byKey['low-round']).toMatchObject({ value: '38', who: 'Jon', detail: 'Blue · Thu' })
    expect(byKey['holes-won']).toMatchObject({ value: '2', who: 'Jon' }) // sole low net on R1 1 & 2
    expect(byKey['net-birdies']).toMatchObject({ value: '2', who: 'Jon' })
    expect(byKey['roughest']).toMatchObject({ value: '+2', who: 'Adam', detail: 'net · Blue 5th' })
    expect(byKey['ctp']).toMatchObject({ value: '1', who: 'Adam' })
  })

  it('writes a letter that names every player once', () => {
    const body = letterText(buildAnnualReport(makeDb('final'))!)
    expect(body).toContain('Jon Aronson takes the season with 74 points, 1 clear of Denove.')
    expect(body).toContain('Aronson led from Thursday and was never caught.')
    expect(body).toContain('Chris Denove pushed hardest')
    expect(body).toContain('Adam Hersh found the roughest hole, +2 net on the Blue 5th.')
    expect(body).toContain('goes home with $400.00')
    expect(body).toContain('$600.00 in, every dollar accounted for. Same time next year.')
    for (const last of ['Aronson', 'Denove', 'Hersh']) expect(body).toContain(last)
  })
})
