import { describe, it, expect } from 'vitest'
import {
  stablefordPoints,
  computeHoleResult,
  computePlayerRound,
  commonCompletedHoleCount,
} from './round'
import type { HoleInfo, HoleScore } from './types'

describe('stablefordPoints — every row plus both clamps', () => {
  it('maps net-to-par to the default table', () => {
    expect(stablefordPoints(-3)).toBe(5)
    expect(stablefordPoints(-2)).toBe(4)
    expect(stablefordPoints(-1)).toBe(3)
    expect(stablefordPoints(0)).toBe(2)
    expect(stablefordPoints(1)).toBe(1)
    expect(stablefordPoints(2)).toBe(0)
  })
  it('clamps both open ends', () => {
    expect(stablefordPoints(-4)).toBe(5) // 4-or-more under still caps at +5
    expect(stablefordPoints(-9)).toBe(5)
    expect(stablefordPoints(3)).toBe(0) // 3 over is still 0
    expect(stablefordPoints(10)).toBe(0)
  })
})

describe('computeHoleResult', () => {
  const par4: HoleInfo = { holeNumber: 1, par: 4, strokeIndex: 1 }
  const par3: HoleInfo = { holeNumber: 5, par: 3, strokeIndex: 6 }
  const par5: HoleInfo = { holeNumber: 2, par: 5, strokeIndex: 2 }
  const score = (over: Partial<HoleScore>): HoleScore => ({ holeNumber: 1, grossStrokes: null, pickedUp: false, ...over })

  it('a par 5 played in 2 (net −3) scores the top clamp +5', () => {
    const r = computeHoleResult(par5, score({ holeNumber: 2, grossStrokes: 2 }), 0)
    expect(r.net).toBe(2)
    expect(r.netToPar).toBe(-3)
    expect(r.points).toBe(5)
  })

  it('a hole-in-one on a par 3 by a player receiving a stroke scores +5', () => {
    // gross 1, one stroke received → net 0 on a par 3 → 3 under → +5
    const r = computeHoleResult(par3, score({ holeNumber: 5, grossStrokes: 1 }), 1)
    expect(r.net).toBe(0)
    expect(r.netToPar).toBe(-3)
    expect(r.points).toBe(5)
  })

  it('a picked-up hole scores 0 and counts as played', () => {
    const r = computeHoleResult(par4, score({ pickedUp: true }), 1)
    expect(r.points).toBe(0)
    expect(r.completed).toBe(true)
    expect(r.net).toBeNull()
  })

  it('an unentered hole has null points and does not count', () => {
    const r = computeHoleResult(par4, score({ grossStrokes: null, pickedUp: false }), 1)
    expect(r.points).toBeNull()
    expect(r.completed).toBe(false)
  })

  it('a plus handicap removes a stroke: net = gross + 1', () => {
    const r = computeHoleResult(par4, score({ grossStrokes: 4 }), -1)
    expect(r.net).toBe(5) // 4 − (−1)
    expect(r.net).toBe(4 + 1)
    expect(r.netToPar).toBe(1)
    expect(r.points).toBe(1)
  })
})

describe('computePlayerRound', () => {
  const holes: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }))
  const oneStrokeEach = new Map<number, number>(holes.map((h) => [h.holeNumber, 1]))

  const grossAll = (g: number): Map<number, HoleScore> =>
    new Map(holes.map((h) => [h.holeNumber, { holeNumber: h.holeNumber, grossStrokes: g, pickedUp: false }]))

  it('a DNP player totals 0 and is flagged', () => {
    const r = computePlayerRound({ holes, scores: grossAll(5), strokesByHole: oneStrokeEach, status: 'did_not_play' })
    expect(r.status).toBe('did_not_play')
    expect(r.totalPoints).toBe(0)
    expect(r.holesCompleted).toBe(0)
  })

  it('a full round sums points across all 18 holes', () => {
    // net 4 on a par 4 = level = 2 pts, ×18 = 36
    const r = computePlayerRound({ holes, scores: grossAll(5), strokesByHole: oneStrokeEach, status: 'playing' })
    expect(r.holesCompleted).toBe(18)
    expect(r.totalPoints).toBe(36)
  })

  it('a shortened round counts only holes within the cutoff', () => {
    const r = computePlayerRound({
      holes,
      scores: grossAll(5),
      strokesByHole: oneStrokeEach,
      status: 'playing',
      holesCounted: 9,
    })
    expect(r.holeResults).toHaveLength(9)
    expect(r.holesCompleted).toBe(9)
    expect(r.totalPoints).toBe(18) // 9 × 2
  })
})

describe('commonCompletedHoleCount — shortened-round cutoff', () => {
  const set = (upTo: number) => new Set(Array.from({ length: upTo }, (_, i) => i + 1))

  it('is the prefix completed by every PLAYING player; a DNP never lowers it', () => {
    const cutoff = commonCompletedHoleCount([
      { status: 'playing', completedHoles: set(14) },
      { status: 'playing', completedHoles: set(14) },
      { status: 'playing', completedHoles: set(14) },
      { status: 'did_not_play', completedHoles: new Set() }, // must be ignored
    ])
    expect(cutoff).toBe(14)
  })

  it('is dragged down to the shortest playing prefix', () => {
    const cutoff = commonCompletedHoleCount([
      { status: 'playing', completedHoles: set(14) },
      { status: 'playing', completedHoles: set(10) },
    ])
    expect(cutoff).toBe(10)
  })
})
