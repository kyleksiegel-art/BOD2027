import { describe, it, expect } from 'vitest'
import { computeHandicap, allocateStrokes, resolveStrokesReceived } from './handicap'
import type { HandicapInput, HoleInfo } from './types'
import {
  RED_GREEN,
  BLUE_GREEN,
  BLACK_GREEN,
  RED_HOLES,
  BLUE_HOLES,
  BLACK_HOLES,
  isCompleteStrokeIndex,
} from './__fixtures__/streamsong'

const base = (over: Partial<HandicapInput>): HandicapInput => ({
  index: 0,
  rating: null,
  slope: null,
  par: 72,
  allowancePct: 1,
  cap: 18,
  ...over,
})

// A synthetic tee where rating === par and slope === 113 makes Course Handicap === Index
// exactly, isolating the cap / allowance / allocation logic from real course arithmetic.
const flatTee = (index: number, over: Partial<HandicapInput> = {}): HandicapInput =>
  base({ index, rating: 72, slope: 113, par: 72, ...over })

describe('computeHandicap — hand-verified worked examples (one tee per course)', () => {
  // RED, Green tees: rating 74.1, slope 137, par 72, index 8.0, allowance 100%.
  //   index × (slope/113) = 8.0 × (137/113) = 8.0 × 1.212389… = 9.699115…
  //   + (rating − par)    = + (74.1 − 72)   = + 2.1
  //   course handicap     = 11.799115…  → round once → 12   (cap 18 not applied)
  it('Streamsong Red / Green, index 8.0 → playing handicap 12', () => {
    const r = computeHandicap(base({ index: 8.0, rating: RED_GREEN.rating, slope: RED_GREEN.slope, par: RED_GREEN.par }))
    expect(r.courseHandicapUnrounded).toBeCloseTo(11.7991, 3)
    expect(r.playingHandicap).toBe(12)
    expect(r.capApplied).toBe(false)
    expect(r.strokesReceived).toBe(12)
    expect(r.fallback).toBe('none')
  })

  // BLUE, Green tees: rating 74.0, slope 134, par 72, index 12.4.
  //   12.4 × (134/113) = 12.4 × 1.185840… = 14.704425…
  //   + (74.0 − 72)    = + 2.0
  //   = 16.704425…  → round → 17
  it('Streamsong Blue / Green, index 12.4 → playing handicap 17', () => {
    const r = computeHandicap(base({ index: 12.4, rating: BLUE_GREEN.rating, slope: BLUE_GREEN.slope, par: BLUE_GREEN.par }))
    expect(r.courseHandicapUnrounded).toBeCloseTo(16.7044, 3)
    expect(r.playingHandicap).toBe(17)
    expect(r.capApplied).toBe(false)
  })

  // BLACK, Green tees: rating 74.7, slope 135, PAR 73 (not 72), index 12.4.
  // This reproduces the brief's own worksheet example exactly:
  //   12.4 × (135/113) = 12.4 × 1.194690… = 14.814159…  (brief shows 14.82)
  //   + (74.7 − 73)    = + 1.7
  //   = 16.514159…  (brief shows 16.52)  → round → 17
  it('Streamsong Black / Green (par 73), index 12.4 → playing handicap 17', () => {
    const r = computeHandicap(base({ index: 12.4, rating: BLACK_GREEN.rating, slope: BLACK_GREEN.slope, par: BLACK_GREEN.par }))
    expect(r.ratingMinusPar).toBeCloseTo(1.7, 6) // uses par 73, not 72
    expect(r.courseHandicapUnrounded).toBeCloseTo(16.5142, 3)
    expect(r.playingHandicap).toBe(17)
    expect(r.capApplied).toBe(false)
  })

  it('a plus handicap comes out negative and is unaffected by the cap', () => {
    // Black / Green, index −3.5: −3.5 × 1.194690… = −4.181416…; + 1.7 = −2.481416… → −2
    const r = computeHandicap(base({ index: -3.5, rating: BLACK_GREEN.rating, slope: BLACK_GREEN.slope, par: BLACK_GREEN.par }))
    expect(r.courseHandicapUnrounded).toBeCloseTo(-2.4814, 3)
    expect(r.playingHandicap).toBe(-2)
    expect(r.capApplied).toBe(false)
    expect(r.strokesReceived).toBe(-2)
  })
})

describe('computeHandicap — allowance', () => {
  it('rounds once, after the allowance (100% and 95%)', () => {
    const at100 = computeHandicap(base({ index: 12.4, rating: BLACK_GREEN.rating, slope: BLACK_GREEN.slope, par: 73, allowancePct: 1 }))
    expect(at100.playingHandicap).toBe(17)

    // 16.514159… × 0.95 = 15.688451… → 16
    const at95 = computeHandicap(base({ index: 12.4, rating: BLACK_GREEN.rating, slope: BLACK_GREEN.slope, par: 73, allowancePct: 0.95 }))
    expect(at95.afterAllowance).toBeCloseTo(15.6884, 3)
    expect(at95.playingHandicap).toBe(16)
  })
})

describe('computeHandicap — the 18 cap', () => {
  it('caps 19, 24, and 40 to 18 with capApplied = true', () => {
    for (const index of [19, 24, 40]) {
      const r = computeHandicap(flatTee(index))
      expect(r.playingHandicap).toBe(index) // pre-cap value preserved for the worksheet
      expect(r.strokesReceived).toBe(18)
      expect(r.capApplied).toBe(true)
    }
  })

  it('a value landing exactly on 18 caps to 18 with capApplied = false', () => {
    const r = computeHandicap(flatTee(18))
    expect(r.strokesReceived).toBe(18)
    expect(r.capApplied).toBe(false)
  })

  it('applies the cap AFTER the allowance and rounding (24 @ 95% → 23 → 18, never 17)', () => {
    // 24 × 0.95 = 22.8 → round → 23 → cap → 18.  A cap-before-allowance bug gives 24→18→17.
    const r = computeHandicap(flatTee(24, { allowancePct: 0.95 }))
    expect(r.afterAllowance).toBeCloseTo(22.8, 6)
    expect(r.playingHandicap).toBe(23)
    expect(r.strokesReceived).toBe(18)
    expect(r.capApplied).toBe(true)
  })

  it('never caps a plus handicap', () => {
    const r = computeHandicap(flatTee(-2))
    expect(r.strokesReceived).toBe(-2)
    expect(r.capApplied).toBe(false)
  })
})

describe('computeHandicap — Bone Valley fallbacks', () => {
  it('rating known, slope null → uses slope 113', () => {
    // CH = index × (113/113) + (rating − par) = index + (rating − par)
    const r = computeHandicap(base({ index: 10, rating: 72, slope: null, par: 72 }))
    expect(r.fallback).toBe('slope-default')
    expect(r.slopeUsed).toBe(113)
    expect(r.courseHandicapUnrounded).toBeCloseTo(10, 6)
  })

  it('rating and slope both null → Course Handicap = Index', () => {
    const r = computeHandicap(base({ index: 14.6, rating: null, slope: null, par: 72 }))
    expect(r.fallback).toBe('index-only')
    expect(r.courseHandicapUnrounded).toBe(14.6)
    expect(r.playingHandicap).toBe(15)
  })
})

describe('allocateStrokes', () => {
  // strokeIndex === holeNumber makes the expected holes trivial to predict.
  const simple: HoleInfo[] = Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }))
  const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0)

  it('playing handicap 0 → no strokes anywhere', () => {
    const a = allocateStrokes(0, simple)
    expect(total(a)).toBe(0)
  })

  it('playing handicap 5 → one stroke on SI 1..5 only', () => {
    const a = allocateStrokes(5, simple)
    for (let h = 1; h <= 18; h++) expect(a.get(h)).toBe(h <= 5 ? 1 : 0)
    expect(total(a)).toBe(5)
  })

  it('playing handicap 18 → one stroke on every hole', () => {
    const a = allocateStrokes(18, simple)
    for (let h = 1; h <= 18; h++) expect(a.get(h)).toBe(1)
    expect(total(a)).toBe(18)
  })

  it('playing handicap 22 → wraps: two strokes on SI 1..4, one elsewhere', () => {
    const a = allocateStrokes(22, simple)
    for (let h = 1; h <= 18; h++) expect(a.get(h)).toBe(h <= 4 ? 2 : 1)
    expect(total(a)).toBe(22)
  })

  it('playing handicap 38 → three strokes on SI 1..2, two elsewhere', () => {
    const a = allocateStrokes(38, simple)
    for (let h = 1; h <= 18; h++) expect(a.get(h)).toBe(h <= 2 ? 3 : 2)
    expect(total(a)).toBe(38)
  })

  it('playing handicap −2 → removes a stroke from SI 18 and 17', () => {
    const a = allocateStrokes(-2, simple)
    expect(a.get(18)).toBe(-1)
    expect(a.get(17)).toBe(-1)
    expect(a.get(16)).toBe(0)
    expect(total(a)).toBe(-2)
  })

  it('strokes-received hole list matches the printed Black scorecard stroke index', () => {
    // A playing handicap of 12 gets a stroke on exactly the holes printed SI 1..12.
    const a = allocateStrokes(12, BLACK_HOLES)
    for (const h of BLACK_HOLES) expect(a.get(h.holeNumber)).toBe(h.strokeIndex <= 12 ? 1 : 0)
    expect(total(a)).toBe(12)
  })
})

describe('fixtures — printed stroke indexes are complete 1..18 permutations', () => {
  it('Red, Blue, Black', () => {
    expect(isCompleteStrokeIndex(RED_HOLES)).toBe(true)
    expect(isCompleteStrokeIndex(BLUE_HOLES)).toBe(true)
    expect(isCompleteStrokeIndex(BLACK_HOLES)).toBe(true)
  })
})

describe('resolveStrokesReceived — manual override', () => {
  it('null override uses the computed value', () => {
    expect(resolveStrokesReceived(14, null)).toEqual({ value: 14, overrideApplied: false })
  })
  it('a set override replaces the computed value entirely', () => {
    expect(resolveStrokesReceived(14, 12)).toEqual({ value: 12, overrideApplied: true })
  })
})
