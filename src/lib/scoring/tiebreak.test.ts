import { describe, it, expect } from 'vitest'
import {
  outrightHoleWinner,
  tallyHolesWon,
  countbackHoleStages,
  resolveCountback,
  DEFAULT_COUNTBACK_ROUND_ORDER,
} from './tiebreak'
import type { HoleNetCell, CountbackRound, CountbackContext } from './tiebreak'
import type { RoundStatus } from './types'

describe('outrightHoleWinner — step 2 (holes won)', () => {
  const cell = (playerId: string, net: number | null, completed = true): HoleNetCell => ({ playerId, net, completed })

  it('the single lowest net wins the hole', () => {
    expect(outrightHoleWinner([cell('a', 3), cell('b', 4), cell('c', 5)])).toBe('a')
  })

  it('a shared low score means nobody wins the hole', () => {
    expect(outrightHoleWinner([cell('a', 3), cell('b', 3), cell('c', 5)])).toBeNull()
  })

  it('a picked-up hole (completed, net null) cannot win', () => {
    // a completed net 4 vs. a pickup → only one eligible score → nobody wins
    expect(outrightHoleWinner([cell('a', 4), cell('b', null, true)])).toBeNull()
    // but a pickup does not block a genuine 2-player outright win
    expect(outrightHoleWinner([cell('a', 3), cell('b', 5), cell('c', null, true)])).toBe('a')
  })

  it('fewer than two completed scores → nobody wins', () => {
    expect(outrightHoleWinner([cell('a', 3), cell('b', null, false)])).toBeNull()
  })
})

describe('tallyHolesWon', () => {
  it('counts outright wins across holes, skipping halved holes', () => {
    const holes: HoleNetCell[][] = [
      [{ playerId: 'a', net: 3, completed: true }, { playerId: 'b', net: 4, completed: true }], // a
      [{ playerId: 'a', net: 4, completed: true }, { playerId: 'b', net: 4, completed: true }], // halved
      [{ playerId: 'a', net: 5, completed: true }, { playerId: 'b', net: 3, completed: true }], // b
    ]
    const t = tallyHolesWon(holes)
    expect(t.get('a')).toBe(1)
    expect(t.get('b')).toBe(1)
  })
})

describe('countbackHoleStages', () => {
  it('full 18-hole round: 10–18, 13–18, 16–18, then 18', () => {
    expect(countbackHoleStages(18)).toEqual([
      [10, 11, 12, 13, 14, 15, 16, 17, 18],
      [13, 14, 15, 16, 17, 18],
      [16, 17, 18],
      [18],
    ])
  })

  it('shortened round that never reached hole 10: last 6 counted, last 3, final counted', () => {
    expect(countbackHoleStages(7)).toEqual([
      [2, 3, 4, 5, 6, 7],
      [5, 6, 7],
      [7],
    ])
  })
})

// --- countback context helpers --------------------------------------------
const round = (
  roundNumber: number,
  status: RoundStatus,
  holesCounted: number,
  points: Record<string, Record<number, number>>,
): CountbackRound => ({
  roundNumber,
  status,
  holesCounted,
  pointsByPlayerHole: new Map(
    Object.entries(points).map(([pid, byHole]) => [pid, new Map(Object.entries(byHole).map(([h, p]) => [Number(h), p]))]),
  ),
})

const ctx = (rounds: CountbackRound[], order = DEFAULT_COUNTBACK_ROUND_ORDER): CountbackContext => ({
  rounds: new Map(rounds.map((r) => [r.roundNumber, r])),
  roundOrder: order,
})

describe('resolveCountback — step 3', () => {
  it('breaks a tie on the back-nine countback of the preference round', () => {
    // Round 3, full 18: a has one more point on hole 18 → wins the 10–18 stage.
    const c = ctx([round(3, 'final', 18, { a: { 18: 2 }, b: { 18: 1 } })])
    const r = resolveCountback(['a', 'b'], c)
    expect(r.resolved).toBe(true)
    expect(r.order[0]).toBe('a')
    expect(r.decidedBy?.roundNumber).toBe(3)
    expect(r.decidedBy?.holes).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18])
  })

  it('honours the round preference order (an earlier round decides before a later one)', () => {
    // Round 3 favours a (barely); round 4 favours b heavily. Order [3,4,2,1] → 3 decides → a.
    const c = ctx([
      round(3, 'final', 18, { a: { 18: 1 }, b: {} }),
      round(4, 'final', 18, { a: {}, b: { 18: 5 } }),
    ])
    const r = resolveCountback(['a', 'b'], c)
    expect(r.resolved).toBe(true)
    expect(r.order[0]).toBe('a')
    expect(r.decidedBy?.roundNumber).toBe(3)
  })

  it('skips abandoned rounds; if every round is abandoned it is an unbreakable tie', () => {
    const c = ctx([
      round(3, 'abandoned', 18, { a: { 18: 5 }, b: {} }),
      round(4, 'abandoned', 18, { a: { 18: 5 }, b: {} }),
    ])
    const r = resolveCountback(['a', 'b'], c)
    expect(r.resolved).toBe(false)
    expect(r.decidedBy?.roundNumber ?? null).toBeNull()
  })

  it('uses the shortened-round fallback when the round never reached hole 10', () => {
    // holesCounted 7 → stages start at the last 6 counted (holes 2–7). Differ on hole 6.
    const c = ctx([round(3, 'final', 7, { a: { 6: 3 }, b: { 6: 1 } })])
    const r = resolveCountback(['a', 'b'], c)
    expect(r.resolved).toBe(true)
    expect(r.order[0]).toBe('a')
    expect(r.decidedBy?.holes).toEqual([2, 3, 4, 5, 6, 7])
  })
})
