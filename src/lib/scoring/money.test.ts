import { describe, it, expect } from 'vitest'
import {
  allocateEvenCents,
  allocateEvenCentsRemainderLast,
  allocateProportionalCents,
  computePurse,
  settle,
  reconcile,
  DEFAULT_PURSE_WEIGHTS,
} from './money'
import type { MoneyRound, NetBalance, PurseConfig } from './money'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('cent allocation primitives', () => {
  it('allocateEvenCents splits a three-way $100 exactly, extra cents to the earliest', () => {
    const parts = allocateEvenCents(10000, 3)
    expect(parts).toEqual([3334, 3333, 3333])
    expect(sum(parts)).toBe(10000)
  })

  it('allocateEvenCentsRemainderLast sends the extra cent to the last part', () => {
    expect(allocateEvenCentsRemainderLast(10000, 3)).toEqual([3333, 3333, 3334])
  })

  it('allocateProportionalCents sums exactly and tracks the weights', () => {
    const parts = allocateProportionalCents(1700, [4, 5, 4])
    expect(sum(parts)).toBe(1700)
    expect(parts).toEqual([523, 654, 523]) // largest remainder (the 5-weight) gets the extra cent
  })
})

describe('computePurse — buy-in mode, 40/30/30', () => {
  // Four players, $100 each = $400 pot.
  const config: PurseConfig = {
    mode: 'buyin',
    weights: DEFAULT_PURSE_WEIGHTS,
    buyInPerPlayerCents: 10000,
    playerCount: 4,
  }
  // A deliberately UNEVEN set of par-3 counts (4/5/4/4). It is not the real trip — all
  // three published Streamsong cards have four par 3s each (verified against the printed
  // cards; see scripts/verify-card-data.py). Unequal counts are the point: with 4/4/4/4 the
  // proportional split and a flat split are indistinguishable, so the test would pass on a
  // broken implementation. Bone Valley's real count is still unknown, which is exactly the
  // case this protects.
  const rounds: MoneyRound[] = [
    { roundNumber: 1, par3Count: 4, abandoned: false },
    { roundNumber: 2, par3Count: 5, abandoned: false },
    { roundNumber: 3, par3Count: 4, abandoned: false },
    { roundNumber: 4, par3Count: 4, abandoned: false },
  ]

  it('splits the pot 40/30/30 to the cent', () => {
    const p = computePurse(config, rounds)
    expect(p.totalCents).toBe(40000)
    expect(p.championshipCents).toBe(16000)
    expect(p.roundWinnersTotalCents).toBe(12000)
    expect(p.ctpTotalCents).toBe(12000)
    expect(p.championshipCents + p.roundWinnersTotalCents + p.ctpTotalCents).toBe(40000)
  })

  it('splits the round-winner pot evenly across counting rounds', () => {
    const p = computePurse(config, rounds)
    expect([...p.perRoundWinnerCents.values()]).toEqual([3000, 3000, 3000, 3000])
  })

  it('weights CTP by par-3 count so every par 3 on the trip is worth ~the same', () => {
    const p = computePurse(config, rounds)
    // 12000 across 17 par 3s = ~705.9¢ each. Per-round pot ÷ its par-3 count should match.
    const perPar3 = rounds.map((r) => p.perRoundCtpCents.get(r.roundNumber)! / r.par3Count)
    const spread = Math.max(...perPar3) - Math.min(...perPar3)
    expect(spread).toBeLessThanOrEqual(1) // within a cent, purely from integer rounding
    expect(sum([...p.perRoundCtpCents.values()])).toBe(12000)
  })

  it("redistributes an abandoned round's shares across the remaining counting rounds", () => {
    const withAbandon = rounds.map((r) => (r.roundNumber === 4 ? { ...r, abandoned: true } : r))
    const p = computePurse(config, withAbandon)
    expect(p.perRoundWinnerCents.has(4)).toBe(false)
    expect([...p.perRoundWinnerCents.values()]).toEqual([4000, 4000, 4000]) // 12000 / 3
    expect(sum([...p.perRoundCtpCents.values()])).toBe(12000)
  })

  it('sends remainder cents to the last par 3 within a round', () => {
    const p = computePurse(config, rounds)
    const fivePar3s = p.perRoundCtpPerHoleCents.get(2)! // the 5-par-3 round in the fixture
    expect(fivePar3s).toHaveLength(5)
    expect(sum(fivePar3s)).toBe(p.perRoundCtpCents.get(2))
    // non-decreasing, with any extra cent on the last hole
    expect(fivePar3s[4]).toBeGreaterThanOrEqual(fivePar3s[0])
  })
})

describe('computePurse — fixed mode', () => {
  it('uses explicit pot amounts rather than weights', () => {
    const p = computePurse(
      {
        mode: 'fixed',
        weights: DEFAULT_PURSE_WEIGHTS,
        fixedCents: { championship: 20000, roundWinners: 10000, ctp: 10000 },
      },
      [
        { roundNumber: 1, par3Count: 4, abandoned: false },
        { roundNumber: 2, par3Count: 5, abandoned: false },
      ],
    )
    expect(p.championshipCents).toBe(20000)
    expect(p.totalCents).toBe(40000)
    expect(sum([...p.perRoundWinnerCents.values()])).toBe(10000)
  })
})

describe('settle — greedy net settlement', () => {
  it('clears all balances in at most n−1 transfers', () => {
    const balances: NetBalance[] = [
      { playerId: 'a', cents: 10000 }, // creditor
      { playerId: 'b', cents: -6000 },
      { playerId: 'c', cents: -4000 },
    ]
    const transfers = settle(balances)
    expect(transfers.length).toBeLessThanOrEqual(balances.length - 1)

    // every debtor's outflow and every creditor's inflow nets to its balance
    const net = new Map(balances.map((b) => [b.playerId, 0]))
    for (const t of transfers) {
      net.set(t.from, net.get(t.from)! - t.cents)
      net.set(t.to, net.get(t.to)! + t.cents)
    }
    for (const b of balances) expect(net.get(b.playerId)).toBe(b.cents)
  })

  it('matches the largest debtor to the largest creditor first', () => {
    const transfers = settle([
      { playerId: 'a', cents: 7000 },
      { playerId: 'b', cents: 3000 },
      { playerId: 'c', cents: -8000 },
      { playerId: 'd', cents: -2000 },
    ])
    // largest debtor c (−8000) pays largest creditor a (7000) first
    expect(transfers[0]).toEqual({ from: 'c', to: 'a', cents: 7000 })
  })
})

describe('reconcile — buy-in must balance to the cent', () => {
  it('a three-way split of $100 reconciles exactly', () => {
    const payouts = allocateEvenCents(10000, 3)
    expect(reconcile(10000, payouts)).toEqual({ totalInCents: 10000, totalOutCents: 10000, balanced: true })
  })

  it('flags an imbalance', () => {
    expect(reconcile(10000, [3000, 3000, 3000]).balanced).toBe(false)
  })
})
