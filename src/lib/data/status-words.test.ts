import { describe, it, expect } from 'vitest'
import { roundScoresIn } from './compute'
import { formatLiveLine, roundStatusLabel } from '@/lib/format'

// One vocabulary for a round: Upcoming → Live → Scores in → Final.
describe('round status words', () => {
  it('calls an in-progress round "Live", never "In progress"', () => {
    expect(roundStatusLabel('in_progress')).toBe('Live')
    expect(roundStatusLabel('final')).toBe('Final')
  })

  it('is "scores in" only when every playing player is through the counted holes', () => {
    const p = (thru: number, status: 'playing' | 'did_not_play' = 'playing') =>
      ({ status, thru }) as Parameters<typeof roundScoresIn>[0]['players'][number]
    expect(roundScoresIn({ holesCounted: 18, players: [p(18), p(18), p(0, 'did_not_play')] })).toBe(true)
    expect(roundScoresIn({ holesCounted: 18, players: [p(18), p(17)] })).toBe(false)
    expect(roundScoresIn({ holesCounted: 15, players: [p(15), p(15)] })).toBe(true)
    expect(roundScoresIn({ holesCounted: 18, players: [] })).toBe(false)
  })

  it('says "thru 18" on a finished line, not a cryptic "F"', () => {
    expect(formatLiveLine({ status: 'playing', todayPoints: 46, thru: 18, complete: true })).toBe('+46 today · thru 18')
    expect(formatLiveLine({ status: 'playing', todayPoints: 0, thru: 10, complete: false })).toBe('E today · thru 10')
  })
})
