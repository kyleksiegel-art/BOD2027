import { describe, it, expect } from 'vitest'
import { buildMoney } from './money'
import type { Db } from './compute'
import type {
  PlayerRow,
  CourseRow,
  TeeRow,
  HoleRow,
  RoundRow,
  RoundPlayerRow,
  ScoreRow,
  SettingRow,
} from './types'

// A minimal but COMPLETE Db: two players, one course whose card is fully published, one tee
// with rating 72 / slope 113 / par 72 (so course handicap == index and index 0 means no
// strokes — net == gross), and holes that are par 4 except four par 3s.

const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'
const COURSE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const TEE = 'tttttttt-tttt-tttt-tttt-tttttttttttt'
const ROUND = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr'

const PAR3_HOLES = [3, 6, 12, 16]

function holesFor(courseId: string): HoleRow[] {
  return Array.from({ length: 18 }, (_, i) => {
    const n = i + 1
    return {
      id: `${courseId}-h${n}`,
      course_id: courseId,
      hole_number: n,
      par: PAR3_HOLES.includes(n) ? 3 : 4,
      stroke_index: n,
    }
  })
}

function roundPlayer(playerId: string, roundId = ROUND): RoundPlayerRow {
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

/** gross-per-hole for a player: par everywhere, minus one stroke on the given birdie holes. */
function scoresFor(playerId: string, birdieHoles: number[] = [], roundId = ROUND): ScoreRow[] {
  return Array.from({ length: 18 }, (_, i) => {
    const n = i + 1
    const par = PAR3_HOLES.includes(n) ? 3 : 4
    return {
      id: `${playerId}-${roundId}-s${n}`,
      round_id: roundId,
      player_id: playerId,
      hole_number: n,
      gross_strokes: birdieHoles.includes(n) ? par - 1 : par,
      picked_up: false,
    }
  })
}

interface Opts {
  buyInCents?: number
  firstCents?: number
  secondCents?: number
  roundCents?: number
  roundStatus?: RoundRow['status']
  p1Birdies?: number[]
  p2Birdies?: number[]
}

// Defaults: $500/man × 2 = $1000 pot; 1st $600, 2nd $200, one round at $200 → reconciles.
function makeDb(opts: Opts = {}): Db {
  const {
    buyInCents = 50000,
    firstCents = 60000,
    secondCents = 20000,
    roundCents = 20000,
    roundStatus = 'final',
    p1Birdies = [1], // P1 wins outright by one birdie
    p2Birdies = [],
  } = opts

  const players: PlayerRow[] = [
    { id: P1, name: 'Player One', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 0 } as unknown as PlayerRow,
    { id: P2, name: 'Player Two', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 1 } as unknown as PlayerRow,
  ]
  const courses: CourseRow[] = [
    { id: COURSE, name: 'Red', data_is_placeholder: false } as unknown as CourseRow,
  ]
  const tees: TeeRow[] = [
    { id: TEE, course_id: COURSE, name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 6500 } as unknown as TeeRow,
  ]
  const rounds: RoundRow[] = [
    { id: ROUND, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status: roundStatus, holes_counted: null },
  ]
  const settings: SettingRow[] = [
    {
      key: 'purse_amounts',
      value: {
        buy_in_per_player_cents: buyInCents,
        champ_first_cents: firstCents,
        champ_second_cents: secondCents,
        round_winner_cents: roundCents,
      },
    },
  ]

  return {
    players,
    courses,
    tees,
    holes: holesFor(COURSE),
    hole_yardages: [],
    rounds,
    round_players: [roundPlayer(P1), roundPlayer(P2)],
    scores: [...scoresFor(P1, p1Birdies), ...scoresFor(P2, p2Birdies)],
    ctp_results: [],
    settings,
  }
}

describe('buildMoney — pot + payouts', () => {
  it('pays 1st, 2nd and the round winner; reconciles to the buy-ins', () => {
    const m = buildMoney(makeDb())
    expect(m.totalPotCents).toBe(100000) // $500 × 2
    expect(m.championshipTotalCents).toBe(80000) // 600 + 200
    expect(m.roundWinnersTotalCents).toBe(20000) // one round × $200

    expect(m.firstPlace?.playerIds).toEqual([P1])
    expect(m.secondPlace?.playerIds).toEqual([P2])
    expect(m.rounds[0].roundWinner?.playerIds).toEqual([P1])

    const p1 = m.players.find((p) => p.playerId === P1)!
    const p2 = m.players.find((p) => p.playerId === P2)!
    expect(p1.championshipCents).toBe(60000)
    expect(p1.roundWinningsCents).toBe(20000)
    expect(p1.winningsCents).toBe(80000)
    expect(p1.netCents).toBe(30000) // +$300
    expect(p2.championshipCents).toBe(20000)
    expect(p2.roundWinningsCents).toBe(0)
    expect(p2.netCents).toBe(-30000)

    expect(m.reconciliation).toEqual({
      totalInCents: 100000,
      awardedCents: 100000,
      pendingCents: 0,
      balanced: true,
    })
    expect(m.settleable).toBe(true)
    expect(m.transfers).toEqual([{ from: P2, to: P1, cents: 30000 }])
  })
})

describe('buildMoney — ties pool the tied places and split', () => {
  it('a tie for 1st splits (1st + 2nd) evenly, and the round purse splits too', () => {
    // Both make the same one birdie → equal points → tied for 1st (share positions 1 and 2).
    const m = buildMoney(makeDb({ p1Birdies: [1], p2Birdies: [1] }))
    expect(m.firstPlace?.playerIds.sort()).toEqual([P1, P2].sort())
    expect(m.secondPlace).toBeNull() // the 1st-place tie absorbs 2nd

    const p1 = m.players.find((p) => p.playerId === P1)!
    const p2 = m.players.find((p) => p.playerId === P2)!
    // (60000 + 20000) / 2 = 40000 championship each; round purse 20000 / 2 = 10000 each.
    expect(p1.championshipCents).toBe(40000)
    expect(p2.championshipCents).toBe(40000)
    expect(p1.roundWinningsCents).toBe(10000)
    expect(p2.roundWinningsCents).toBe(10000)
    expect(p1.netCents).toBe(0)
    expect(p2.netCents).toBe(0)
    expect(m.reconciliation.balanced).toBe(true)
    expect(m.transfers).toEqual([]) // nobody owes anybody
  })
})

describe('buildMoney — pending before every round is final', () => {
  it('reserves an undecided round as pending and blocks settlement', () => {
    const base = makeDb({ buyInCents: 60000 }) // $600 × 2 = $1200 pot
    const R2 = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrr02'
    base.rounds.push({ id: R2, round_number: 2, date: '2027-02-05', course_id: COURSE, tee_time: null, status: 'upcoming', holes_counted: null })
    const m = buildMoney(base)

    // Obligations: champ 80000 + round 20000×2 = 120000 = the pot. Round 2 unplayed → pending.
    expect(m.rounds.find((r) => r.roundNumber === 2)!.roundWinner).toBeNull()
    expect(m.reconciliation.pendingCents).toBe(20000)
    expect(m.reconciliation.awardedCents).toBe(100000)
    expect(m.reconciliation.balanced).toBe(true)
    expect(m.settleable).toBe(false)
    expect(m.transfers).toEqual([])
  })
})

describe('buildMoney — abandoned round pays no winner', () => {
  it('an abandoned round carries no round obligation', () => {
    const base = makeDb()
    const R2 = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrr02'
    base.rounds.push({ id: R2, round_number: 2, date: '2027-02-05', course_id: COURSE, tee_time: null, status: 'abandoned', holes_counted: null })
    const m = buildMoney(base)

    const r2 = m.rounds.find((r) => r.roundNumber === 2)!
    expect(r2.counts).toBe(false)
    expect(r2.roundPurseCents).toBe(0)
    // Only round 1's $200 is a round obligation; still balances against the $1000 pot.
    expect(m.roundWinnersTotalCents).toBe(20000)
    expect(m.reconciliation.balanced).toBe(true)
  })
})

describe('buildMoney — reconciliation tripwire', () => {
  it('flags amounts that do not add up to the buy-ins', () => {
    // Round winner $300 instead of $200 → obligations 110000 ≠ 100000 pot.
    const m = buildMoney(makeDb({ roundCents: 30000 }))
    expect(m.reconciliation.balanced).toBe(false)
    expect(m.settleable).toBe(true) // round is final…
    expect(m.transfers).toEqual([]) // …but an unbalanced ledger never settles
  })

  it('reports no money when nothing is configured', () => {
    const db = makeDb()
    db.settings = [{ key: 'purse_amounts', value: {} }]
    const m = buildMoney(db)
    expect(m.hasMoney).toBe(false)
    expect(m.totalPotCents).toBe(0)
  })
})
