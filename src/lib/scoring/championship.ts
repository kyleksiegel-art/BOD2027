// Overall championship: cumulative points across counting rounds, standings with
// competition ranking, position change vs. the previous round, gap to leader, and the
// live projection. Ties in the standings are resolved by tiebreak.ts, not here.

import { roundHalfAwayFromZero } from './rounding'
import type { RoundStatus, RoundPlayerStatus } from './types'

/** One player's result in one round, as it feeds the cumulative total. */
export interface RoundPointsEntry {
  roundNumber: number
  status: RoundStatus
  points: number // the player's counted points for the round (0 for a DNP)
  /** True when the round contributes to the cumulative total. The CALLER decides which
   *  statuses count and sets this flag; the engine just sums where it is true. The app
   *  counts `final` and the live `in_progress` round (the overall board is inclusive of
   *  the round in play) and never `upcoming`/`abandoned` — see src/lib/data/compute.ts. */
  counts: boolean
}

export interface PlayerChampionship {
  playerId: string
  byRound: RoundPointsEntry[]
}

/** Sum only the rounds that count toward the championship. */
export function totalPoints(byRound: RoundPointsEntry[]): number {
  return byRound.filter((r) => r.counts).reduce((s, r) => s + r.points, 0)
}

export interface StandingRow {
  playerId: string
  total: number
  position: number // competition ranking: ties share a position, the next one skips
  gapToLeader: number // leaderTotal - total (>= 0)
  positionChange: number | null // previousPosition - position; + = moved up; null if no prior
}

/**
 * Rank players by total points (higher is better) with standard competition ranking
 * (1, 2, 2, 4). `previousPositions` (playerId -> position after the prior round) drives
 * the position-change arrow; omit it for the first counting round.
 *
 * NOTE: equal totals share a rank here. Breaking that tie for a single champion is
 * tiebreak.ts's job (holes won, then countback); this function reports the raw standing.
 */
export function computeStandings(
  players: PlayerChampionship[],
  previousPositions?: Map<string, number>,
): StandingRow[] {
  const totals = players.map((p) => ({ playerId: p.playerId, total: totalPoints(p.byRound) }))
  totals.sort((a, b) => b.total - a.total)

  const leaderTotal = totals.length > 0 ? totals[0].total : 0

  const rows: StandingRow[] = []
  for (let i = 0; i < totals.length; i++) {
    const { playerId, total } = totals[i]
    // Competition ranking: position is 1 + count of players strictly ahead.
    const position = i > 0 && totals[i - 1].total === total ? rows[i - 1].position : i + 1
    const prev = previousPositions?.get(playerId)
    rows.push({
      playerId,
      total,
      position,
      gapToLeader: leaderTotal - total,
      positionChange: prev === undefined ? null : prev - position,
    })
  }
  return rows
}

/** Cumulative standings through a given round number (inclusive), for position-change. */
export function standingsThroughRound(
  players: PlayerChampionship[],
  throughRoundNumber: number,
): StandingRow[] {
  const sliced = players.map((p) => ({
    playerId: p.playerId,
    byRound: p.byRound.filter((r) => r.roundNumber <= throughRoundNumber),
  }))
  return computeStandings(sliced)
}

/**
 * Projected finish: points-so-far ÷ holes-played × 18, to one decimal.
 * Suppressed (null) until a player is thru 5 holes — one early birdie otherwise
 * projects a nonsense 54 — and never shown for a DNP player.
 */
export function computeProjection(
  totalPointsSoFar: number,
  holesCompleted: number,
  status: RoundPlayerStatus,
): number | null {
  if (status === 'did_not_play') return null
  if (holesCompleted < 5) return null
  const raw = (totalPointsSoFar / holesCompleted) * 18
  // one decimal place, half-away-from-zero
  return roundHalfAwayFromZero(raw * 10) / 10
}
