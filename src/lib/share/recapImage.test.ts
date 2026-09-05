import { describe, it, expect } from 'vitest'
import { recapImageFilename } from './recapImage'

describe('recapImageFilename', () => {
  it('slugs the course name and carries the round number', () => {
    expect(recapImageFilename('Streamsong Red', 1)).toBe('bod2027-r1-streamsong-red.png')
    expect(recapImageFilename('Bone Valley (Chain)', 4)).toBe('bod2027-r4-bone-valley-chain.png')
  })
})
