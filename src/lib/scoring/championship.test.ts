import { describe, it, expect } from 'vitest'
import {
  totalPoints,
  computeStandings,
  standingsThroughRound,
  computeProjection,
} from './championship'
import type { PlayerChampionship, RoundPointsEntry } from './championship'

const entry = (roundNumber: number, points: number, over: Partial<RoundPointsEntry> = {}): RoundPointsEntry => ({
  roundNumber,
  status: 'final',
  points,
  counts: true,
  ...over,
})

describe('totalPoints — counting rules', () => {
  it('sums final rounds and a DNP (0), and excludes abandoned / in-progress', () => {
    const byRound: RoundPointsEntry[] = [
      entry(1, 34), // final, counts
      entry(2, 0, { status: 'final' }), // DNP scored 0 but the round still counts
      entry(3, 40, { status: 'abandoned', counts: false }), // excluded entirely
      entry(4, 12, { status: 'in_progress', counts: false }), // not counted yet
    ]
    expect(totalPoints(byRound)).toBe(34)
  })

  it('a shortened round contributes its reduced total', () => {
    const byRound = [entry(1, 30), entry(2, 18, { status: 'final' })] // R2 shortened → fewer pts
    expect(totalPoints(byRound)).toBe(48)
  })
})

describe('computeStandings', () => {
  const players: PlayerChampionship[] = [
    { playerId: 'jon', byRound: [entry(1, 30), entry(2, 30)] }, // 60
    { playerId: 'kyle', byRound: [entry(1, 40), entry(2, 32)] }, // 72
    { playerId: 'adam', byRound: [entry(1, 30), entry(2, 30)] }, // 60
    { playerId: 'chris', byRound: [entry(1, 20), entry(2, 25)] }, // 45
  ]

  it('ranks by total, shares positions on ties (competition ranking), and reports the gap', () => {
    const s = computeStandings(players)
    expect(s.map((r) => r.playerId)).toEqual(['kyle', 'jon', 'adam', 'chris'])
    expect(s[0]).toMatchObject({ position: 1, total: 72, gapToLeader: 0 })
    // jon and adam tie at 60 → both position 2, next skips to 4
    expect(s[1]).toMatchObject({ position: 2, total: 60, gapToLeader: 12 })
    expect(s[2]).toMatchObject({ position: 2, total: 60 })
    expect(s[3]).toMatchObject({ position: 4, total: 45, gapToLeader: 27 })
  })

  it('reports position change vs. the previous round', () => {
    const prev = new Map(standingsThroughRound(players, 1).map((r) => [r.playerId, r.position]))
    const now = computeStandings(players, prev)
    const kyle = now.find((r) => r.playerId === 'kyle')!
    // After R1: kyle 40 (1st). After R2 kyle still 1st → change 0.
    expect(kyle.positionChange).toBe(0)
    // chris was last both rounds.
    expect(now.find((r) => r.playerId === 'chris')!.positionChange).toBe(0)
  })
})

describe('computeProjection', () => {
  it('is suppressed until thru 5 holes', () => {
    expect(computeProjection(6, 4, 'playing')).toBeNull()
    expect(computeProjection(6, 5, 'playing')).not.toBeNull()
  })

  it('is never shown for a DNP player', () => {
    expect(computeProjection(10, 9, 'did_not_play')).toBeNull()
  })

  it('projects points/holes × 18 to one decimal', () => {
    expect(computeProjection(18, 9, 'playing')).toBe(36) // 2.0/hole × 18
    expect(computeProjection(15, 7, 'playing')).toBe(38.6) // 15/7×18 = 38.571… → 38.6
  })
})
