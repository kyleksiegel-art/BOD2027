// Per-hole net + Stableford points, and per-player round rollups. Handles picked-up
// holes, unentered holes, DNP players, and the shortened-round cutoff. Pure — points
// are always derived from stored gross scores, never stored (brief: store gross only).

import { DEFAULT_POINTS_TABLE } from './types'
import type {
  HoleInfo,
  HoleScore,
  HoleResult,
  PointsTable,
  RoundPlayerStatus,
} from './types'

/**
 * Net Stableford points for a net-relative-to-par value. Six discrete values with two
 * open-ended clamps: 3-or-more under caps at the top row; 2-or-more over is the bottom.
 * Higher is better — this is a points-accumulation game, not stroke play.
 */
export function stablefordPoints(
  netToPar: number,
  table: PointsTable = DEFAULT_POINTS_TABLE,
): number {
  if (netToPar <= -3) return table.threeOrMoreUnder
  if (netToPar === -2) return table.twoUnder
  if (netToPar === -1) return table.oneUnder
  if (netToPar === 0) return table.level
  if (netToPar === 1) return table.oneOver
  return table.twoOrMoreOver // netToPar >= 2
}

/** Derive one hole's result from its stored cell and the strokes allocated to it. */
export function computeHoleResult(
  hole: HoleInfo,
  score: HoleScore,
  strokesReceived: number,
  table: PointsTable = DEFAULT_POINTS_TABLE,
): HoleResult {
  const base = {
    holeNumber: hole.holeNumber,
    par: hole.par,
    strokesReceived,
  }

  // Picked up: 0 points, but the hole counts as played (toward "thru X").
  if (score.pickedUp) {
    return { ...base, grossStrokes: null, pickedUp: true, net: null, netToPar: null, points: 0, completed: true }
  }

  // Not entered yet: no gross, no picked-up flag. Does not count toward anything.
  if (score.grossStrokes === null) {
    return { ...base, grossStrokes: null, pickedUp: false, net: null, netToPar: null, points: null, completed: false }
  }

  const net = score.grossStrokes - strokesReceived
  const netToPar = net - hole.par
  return {
    ...base,
    grossStrokes: score.grossStrokes,
    pickedUp: false,
    net,
    netToPar,
    points: stablefordPoints(netToPar, table),
    completed: true,
  }
}

export interface PlayerRoundInput {
  holes: HoleInfo[] // the course's 18 holes
  scores: Map<number, HoleScore> // by hole number; a missing entry is "not entered"
  strokesByHole: Map<number, number> // allocation from allocateStrokes()
  status: RoundPlayerStatus
  pointsTable?: PointsTable
  /** Shortened-round cutoff (rounds.holes_counted). null/undefined => all 18 count. */
  holesCounted?: number | null
}

export interface PlayerRoundResult {
  status: RoundPlayerStatus
  holeResults: HoleResult[] // only holes within the counted window
  totalPoints: number // sum over completed, counted holes; a DNP scores 0
  holesCompleted: number // "thru X": entered-or-picked-up holes within the counted window
}

/**
 * Roll up a single player's round. Only holes 1..holesCounted contribute to the total
 * (a shortened round that "counts"); a DNP contributes nothing and totals 0.
 */
export function computePlayerRound(input: PlayerRoundInput): PlayerRoundResult {
  const table = input.pointsTable ?? DEFAULT_POINTS_TABLE
  const cutoff = input.holesCounted ?? 18

  if (input.status === 'did_not_play') {
    return { status: 'did_not_play', holeResults: [], totalPoints: 0, holesCompleted: 0 }
  }

  const holeResults: HoleResult[] = []
  let totalPoints = 0
  let holesCompleted = 0

  for (const hole of input.holes) {
    if (hole.holeNumber > cutoff) continue
    const score = input.scores.get(hole.holeNumber) ?? {
      holeNumber: hole.holeNumber,
      grossStrokes: null,
      pickedUp: false,
    }
    const strokes = input.strokesByHole.get(hole.holeNumber) ?? 0
    const r = computeHoleResult(hole, score, strokes, table)
    holeResults.push(r)
    if (r.completed) holesCompleted++
    if (r.points !== null) totalPoints += r.points
  }

  return { status: 'playing', holeResults, totalPoints, holesCompleted }
}

/**
 * The shortened-round cutoff: the number of holes completed by EVERY participating
 * player, counted as a prefix from hole 1 (a round stops at some hole). DNP players are
 * excluded from this calculation — a DNP must never lower the cutoff for everyone else.
 */
export function commonCompletedHoleCount(
  players: { status: RoundPlayerStatus; completedHoles: Set<number> }[],
): number {
  const playing = players.filter((p) => p.status === 'playing')
  if (playing.length === 0) return 0

  let count = 0
  for (let h = 1; h <= 18; h++) {
    if (playing.every((p) => p.completedHoles.has(h))) count++
    else break
  }
  return count
}
