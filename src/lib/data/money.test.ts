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
  CtpResultRow,
  SettingRow,
} from './types'

// A minimal but COMPLETE Db: two players, one course whose card is fully published, one tee
// with rating 72 / slope 113 / par 72 (so course handicap == index and index 0 means no
// strokes — net == gross), and holes that are par 4 except four par 3s. Enough for the pot
// split, the CTP carry, the settlement and the reconciliation to run for real.

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

function roundPlayer(playerId: string): RoundPlayerRow {
  return {
    round_id: ROUND,
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
function scoresFor(playerId: string, birdieHoles: number[] = []): ScoreRow[] {
  return Array.from({ length: 18 }, (_, i) => {
    const n = i + 1
    const par = PAR3_HOLES.includes(n) ? 3 : 4
    return {
      id: `${playerId}-s${n}`,
      round_id: ROUND,
      player_id: playerId,
      hole_number: n,
      gross_strokes: birdieHoles.includes(n) ? par - 1 : par,
      picked_up: false,
    }
  })
}

interface Opts {
  purseMode?: string
  buyInCents?: number
  ctpCarryMode?: string
  roundStatus?: RoundRow['status']
  holesCounted?: number | null
  ctp?: CtpResultRow[]
  p1Birdies?: number[]
  p2Birdies?: number[]
}

function makeDb(opts: Opts = {}): Db {
  const {
    purseMode = 'buyin',
    buyInCents = 10000,
    ctpCarryMode = 'carry',
    roundStatus = 'final',
    holesCounted = null,
    ctp = [],
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
    { id: ROUND, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status: roundStatus, holes_counted: holesCounted },
  ]
  const settings: SettingRow[] = [
    { key: 'purse_mode', value: purseMode },
    { key: 'purse_weights', value: { championship: 0.4, roundWinners: 0.3, ctp: 0.3 } },
    { key: 'purse_amounts', value: { buy_in_per_player_cents: buyInCents, fixed_cents: { championship: 0, roundWinners: 0, ctp: 0 } } },
    { key: 'ctp_carry_mode', value: ctpCarryMode },
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
    ctp_results: ctp,
    settings,
  }
}

function ctpRow(hole: number, playerId: string | null, feet: number | null): CtpResultRow {
  return { id: `ctp-${hole}`, round_id: ROUND, hole_number: hole, player_id: playerId, distance_feet: feet }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('buildMoney — pot split', () => {
  it('splits a $100/player buy-in 40/30/30 and sums back to the buy-ins exactly', () => {
    const m = buildMoney(makeDb())
    expect(m.totalPotCents).toBe(20000)
    expect(m.championshipTotalCents).toBe(8000)
    expect(m.roundWinnersTotalCents).toBe(6000)
    expect(m.ctpTotalCents).toBe(6000)
    // With one counting round, that round holds the whole of each pot.
    const r = m.rounds[0]
    expect(r.championshipShareCents).toBe(8000)
    expect(r.roundPurseCents).toBe(6000)
    expect(r.ctpPotCents).toBe(6000)
  })
})

describe('buildMoney — payouts and reconciliation', () => {
  it('awards championship + round purse to the sole leader and CTP to hole winners; reconciles to the cent', () => {
    const ctp = PAR3_HOLES.map((h) => ctpRow(h, P1, 12.5)) // P1 wins every CTP
    const m = buildMoney(makeDb({ ctp }))

    expect(m.championSet?.playerIds).toEqual([P1])
    expect(m.rounds[0].roundWinner?.playerIds).toEqual([P1])

    const p1 = m.players.find((p) => p.playerId === P1)!
    const p2 = m.players.find((p) => p.playerId === P2)!
    expect(p1.championshipCents).toBe(8000)
    expect(p1.roundWinningsCents).toBe(6000)
    expect(p1.ctpWinningsCents).toBe(6000)
    expect(p1.winningsCents).toBe(20000)
    expect(p1.netCents).toBe(10000) // +$100
    expect(p2.netCents).toBe(-10000) // −$100

    expect(m.reconciliation).toEqual({
      totalInCents: 20000,
      awardedCents: 20000,
      pendingCents: 0,
      balanced: true,
    })
    // Fully final → settlement is available and minimal: one payment.
    expect(m.settleable).toBe(true)
    expect(m.transfers).toEqual([{ from: P2, to: P1, cents: 10000 }])
  })

  it('a carried CTP pot with no winner returns to contributors at the last par 3', () => {
    // Every par 3 recorded as no-winner (null player_id). Carry within the round, void at the end.
    const ctp = PAR3_HOLES.map((h) => ctpRow(h, null, null))
    const m = buildMoney(makeDb({ ctp }))

    const holes = m.rounds[0].ctpPerHole
    expect(holes.map((h) => h.status)).toEqual(['carry', 'carry', 'carry', 'void'])
    // The final hole voids the whole accumulated pot (all four slices).
    expect(holes[3].potCents).toBe(6000)

    // The 6000 comes back to the two contributors, evenly.
    const p1 = m.players.find((p) => p.playerId === P1)!
    const p2 = m.players.find((p) => p.playerId === P2)!
    expect(p1.refundCents).toBe(3000)
    expect(p2.refundCents).toBe(3000)
    expect(sum(m.players.map((p) => p.ctpWinningsCents))).toBe(0)

    // Championship (P1) + round purse (P1) + refund (both) still sums to the buy-ins.
    expect(m.reconciliation?.balanced).toBe(true)
    expect(m.reconciliation?.pendingCents).toBe(0)
  })

  it('void carry mode returns each unclaimed par 3 immediately', () => {
    const ctp = PAR3_HOLES.map((h) => ctpRow(h, null, null))
    const m = buildMoney(makeDb({ ctp, ctpCarryMode: 'void' }))
    expect(m.rounds[0].ctpPerHole.map((h) => h.status)).toEqual(['void', 'void', 'void', 'void'])
    // Each hole's slice (1500) is refunded on its own; total refund still 6000.
    expect(sum(m.players.map((p) => p.refundCents))).toBe(6000)
    expect(m.reconciliation?.balanced).toBe(true)
  })
})

describe('buildMoney — shortened round', () => {
  it("folds a cut-off par 3's CTP slice into the last played par 3 (no cents vanish)", () => {
    // holes_counted = 12 cuts off the par 3 at hole 16; par 3s 3, 6, 12 remain in play.
    const m = buildMoney(makeDb({ holesCounted: 12 }))
    const holes = m.rounds[0].ctpPerHole
    expect(holes.map((h) => h.holeNumber)).toEqual([3, 6, 12]) // hole 16 not shown
    // No CTP entered on a final round → the whole pot returns at the last played par 3 (hole 12),
    // and it carries the cut-off hole's slice: 1500 + 1500 (its own) + 3000 (carried) = 6000.
    expect(holes[2].status).toBe('void')
    expect(holes[2].potCents).toBe(6000)
    expect(m.reconciliation?.balanced).toBe(true)
    expect(m.reconciliation?.pendingCents).toBe(0)
    expect(sum(m.players.map((p) => p.refundCents))).toBe(6000)
  })
})

describe('buildMoney — abandoned round redistributes', () => {
  it('an abandoned round reserves nothing; its shares go to the remaining counting rounds', () => {
    // Add a second, abandoned round on the same course.
    const base = makeDb()
    const R2 = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrr02'
    base.rounds.push({ id: R2, round_number: 2, date: '2027-02-05', course_id: COURSE, tee_time: null, status: 'abandoned', holes_counted: null })
    const m = buildMoney(base)

    const r1 = m.rounds.find((r) => r.roundNumber === 1)!
    const r2 = m.rounds.find((r) => r.roundNumber === 2)!
    // Round 1 still holds the entire round-winner and CTP pots — the abandoned round took none.
    expect(r1.roundPurseCents).toBe(6000)
    expect(r1.ctpPotCents).toBe(6000)
    expect(r2.counts).toBe(false)
    expect(r2.roundPurseCents).toBe(0)
    expect(r2.ctpPotCents).toBe(0)
    // Championship shares stay additive across counting rounds (just round 1 here).
    expect(r1.championshipShareCents).toBe(8000)
    expect(r2.championshipShareCents).toBe(0)
  })
})

describe('buildMoney — frozen-figure parity', () => {
  it('derives additive per-round shares the same way rpc_finalize_round freezes them', () => {
    // rpc_finalize_round (supabase/tests/admin_path.sql) freezes each round's share with the
    // same allocateEvenCents / allocateProportionalCents split this uses. Two players × $100 →
    // championship 8000 / round 6000 / ctp 6000, evenly across four counting rounds.
    const base = makeDb()
    for (let rn = 2; rn <= 4; rn++) {
      base.rounds.push({
        id: `rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrr0${rn}`,
        round_number: rn,
        date: `2027-02-0${2 + rn}`,
        course_id: COURSE, // same card → 4 par 3s each, so CTP splits evenly across rounds
        tee_time: null,
        status: 'final',
        holes_counted: null,
      })
    }
    const m = buildMoney(base)
    expect(m.rounds).toHaveLength(4)
    for (const r of m.rounds) {
      expect(r.championshipShareCents).toBe(2000) // 8000 / 4
      expect(r.roundPurseCents).toBe(1500) // 6000 / 4
      expect(r.ctpPotCents).toBe(1500) // 6000 across [4,4,4,4]
      expect(r.par3Count).toBe(4)
    }
    // And the per-round rows stay additive back to the trip pots.
    expect(sum(m.rounds.map((r) => r.championshipShareCents))).toBe(m.championshipTotalCents)
    expect(sum(m.rounds.map((r) => r.roundPurseCents))).toBe(m.roundWinnersTotalCents)
    expect(sum(m.rounds.map((r) => r.ctpPotCents))).toBe(m.ctpTotalCents)
  })
})

describe('buildMoney — pending before finalization', () => {
  it('an in-progress round with unrecorded CTPs leaves that money pending, not misawarded', () => {
    const m = buildMoney(makeDb({ roundStatus: 'in_progress', ctp: [] }))
    // Round purse is provisionally awarded to the live leader, but the CTP pot is pending.
    expect(m.rounds[0].ctpPerHole.every((h) => h.status === 'pending')).toBe(true)
    expect(m.reconciliation?.pendingCents).toBeGreaterThan(0)
    expect(m.reconciliation?.balanced).toBe(true) // awarded + pending === buy-ins
    expect(m.settleable).toBe(false) // no settlement until every round is final
    expect(m.transfers).toEqual([])
  })
})

describe('buildMoney — fixed mode', () => {
  it('uses explicit pot amounts and skips buy-in reconciliation', () => {
    const db = makeDb({ purseMode: 'fixed' })
    db.settings = db.settings.map((s) =>
      s.key === 'purse_amounts'
        ? { key: 'purse_amounts', value: { fixed_cents: { championship: 5000, roundWinners: 3000, ctp: 2000 } } }
        : s,
    )
    const m = buildMoney(db)
    expect(m.mode).toBe('fixed')
    expect(m.championshipTotalCents).toBe(5000)
    expect(m.roundWinnersTotalCents).toBe(3000)
    expect(m.ctpTotalCents).toBe(2000)
    expect(m.totalPotCents).toBe(10000)
    expect(m.reconciliation).toBeNull()
    expect(m.players.every((p) => p.buyInCents === 0)).toBe(true)
  })
})
