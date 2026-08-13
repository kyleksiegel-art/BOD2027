import { describe, it, expect } from 'vitest'
import { roundHalfAwayFromZero } from './rounding'

describe('roundHalfAwayFromZero', () => {
  it('rounds .5 away from zero, symmetrically', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3)
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3)
    expect(roundHalfAwayFromZero(0.5)).toBe(1)
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1)
  })

  it('rounds non-half values to the nearest integer', () => {
    expect(roundHalfAwayFromZero(2.4)).toBe(2)
    expect(roundHalfAwayFromZero(2.6)).toBe(3)
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2)
    expect(roundHalfAwayFromZero(16.52)).toBe(17)
    expect(roundHalfAwayFromZero(16.49)).toBe(16)
  })

  it('leaves integers and zero untouched', () => {
    expect(roundHalfAwayFromZero(0)).toBe(0)
    expect(roundHalfAwayFromZero(18)).toBe(18)
    expect(roundHalfAwayFromZero(-2)).toBe(-2)
  })
})
