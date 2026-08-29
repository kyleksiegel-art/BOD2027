// Course/playing handicap, the house cap, and stroke allocation. Pure functions of
// (index, tee rating/slope, par, allowance, cap) — all cached in Dexie, so this runs
// identically offline. The tee is an INPUT here, never a constant: a day-of tee change
// re-runs computeHandicap with the new tee's rating/slope and everything re-derives.

import { roundHalfAwayFromZero } from './rounding'
import type { HandicapInput, HandicapResult, HandicapFallback, HoleInfo } from './types'

/**
 * WHS 2024: Course Handicap = Index × (Slope ÷ 113) + (Course Rating − Par).
 * Carry unrounded, apply the allowance, then round exactly once (never twice).
 * Finally cap the playing handicap (house rule, default 18) — applied LAST.
 *
 * Bone Valley fallbacks (distinct, because the banners differ):
 *   - rating known, slope null  => slope 113   (CH = Index + (Rating − Par))
 *   - rating and slope both null => CH = Index  (no rating/par term at all)
 */
export function computeHandicap(input: HandicapInput): HandicapResult {
  const { index, rating, slope, par, allowancePct, cap } = input

  let fallback: HandicapFallback = 'none'
  let slopeUsed: number
  let indexTimesSlope: number
  let ratingMinusPar: number
  let courseHandicapUnrounded: number

  if (rating === null && slope === null) {
    // Nothing published: Course Handicap = Index, full stop.
    fallback = 'index-only'
    slopeUsed = 113
    indexTimesSlope = index
    ratingMinusPar = 0
    courseHandicapUnrounded = index
  } else {
    if (slope === null) {
      fallback = 'slope-default'
      slopeUsed = 113
    } else {
      slopeUsed = slope
    }
    // rating is non-null here (both-null handled above). The `?? par` only guards the
    // undocumented slope-known/rating-null shape, collapsing its rating term to zero.
    const ratingUsed = rating ?? par
    indexTimesSlope = index * (slopeUsed / 113)
    ratingMinusPar = ratingUsed - par
    courseHandicapUnrounded = indexTimesSlope + ratingMinusPar
  }

  const afterAllowance = courseHandicapUnrounded * allowancePct
  const playingHandicap = roundHalfAwayFromZero(afterAllowance)
  // Cap bites only on a strict exceed: a value landing exactly on the cap is NOT
  // "cap applied" (brief: an index computing to exactly 18 caps to 18, cap_applied=false).
  const capApplied = playingHandicap > cap
  const strokesReceived = capApplied ? cap : playingHandicap

  return {
    index,
    ratingUsed: rating,
    slopeUsed,
    par,
    allowancePct,
    cap,
    indexTimesSlope,
    ratingMinusPar,
    courseHandicapUnrounded,
    afterAllowance,
    playingHandicap,
    capApplied,
    strokesReceived,
    fallback,
  }
}

/**
 * A manual override ("you're getting 12, forget the math") replaces the computed
 * strokes-received total entirely. The worksheet still shows the computed value
 * alongside so it's obvious the math was bypassed.
 */
export function resolveStrokesReceived(
  computed: number,
  manualOverride: number | null | undefined,
): { value: number; overrideApplied: boolean } {
  if (manualOverride === null || manualOverride === undefined) {
    return { value: computed, overrideApplied: false }
  }
  return { value: manualOverride, overrideApplied: true }
}

/**
 * Distribute a playing handicap across the 18 holes by stroke index.
 *  - Positive: SI 1 first, SI 2 next, … wrapping above 18 for a 2nd stroke (3rd above 36).
 *  - Plus (negative): REMOVE strokes from the highest index down (SI 18, then 17, …);
 *    those holes get −1, so net = gross + 1.
 * Returns a map holeNumber -> strokes received on that hole.
 *
 * With the default cap of 18 the wrap can never fire in practice, but the cap is a
 * setting — the wrap is implemented and tested so raising the cap can't silently break.
 */
export function allocateStrokes(playingHandicap: number, holes: HoleInfo[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const h of holes) result.set(h.holeNumber, 0)

  const n = holes.length
  if (playingHandicap === 0 || n === 0) return result

  const holeBySi = new Map<number, number>() // strokeIndex -> holeNumber
  for (const h of holes) holeBySi.set(h.strokeIndex, h.holeNumber)

  // `remaining` strictly decreases each time a hole is hit, so the loop always
  // terminates; `guard` is a belt-and-suspenders backstop against a malformed SI set.
  if (playingHandicap > 0) {
    let remaining = playingHandicap
    let si = 1
    let guard = 0
    const maxIter = playingHandicap + n
    while (remaining > 0 && guard++ < maxIter) {
      const hole = holeBySi.get(si)
      if (hole !== undefined) {
        result.set(hole, (result.get(hole) ?? 0) + 1)
        remaining--
      }
      si = si === n ? 1 : si + 1
    }
  } else {
    let remaining = -playingHandicap
    let si = n
    let guard = 0
    const maxIter = remaining + n
    while (remaining > 0 && guard++ < maxIter) {
      const hole = holeBySi.get(si)
      if (hole !== undefined) {
        result.set(hole, (result.get(hole) ?? 0) - 1)
        remaining--
      }
      si = si === 1 ? n : si - 1
    }
  }

  return result
}
