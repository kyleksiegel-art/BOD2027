// Half-away-from-zero rounding. JS `Math.round` is round-half-UP (toward +Infinity):
// Math.round(-0.5) === -0 and Math.round(2.5) === 3, which is asymmetric at negatives.
// The WHS rounds .5 away from zero. Taking the magnitude first, rounding, then
// reapplying the sign gives symmetric half-away-from-zero: 2.5 -> 3, -2.5 -> -3.
//
// Deliberately no epsilon fudge: the only exact-half inputs in this app are direct
// test values (2.5, -2.5), which are exactly representable; real course-handicap
// arithmetic never lands precisely on .5. Adding an epsilon would risk bumping a
// genuine x.4999 up, which is worse than the (nonexistent) problem it would solve.
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}
