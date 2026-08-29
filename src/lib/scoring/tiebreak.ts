// Tiebreakers for the Overall Championship and for a single round. The chain:
//   1. Highest total points          (championship.ts ranking — not here)
//   2. Most holes won outright        (tallyHolesWon)
//   3. Countback on the latest counting round, in a preference order (resolveCountback)
//   4. Declared a tie                 (resolveCountback returns resolved: false)
//
// A hole is "won outright" by the single lowest NET score among players who completed
// it. A picked-up or unentered hole cannot win and ranks below any completed score; if
// fewer than two players completed the hole, nobody wins it. Higher points win every
// countback stage — this is a points game, do not import stroke play's lower-is-better.

import type { RoundStatus } from './types'

/**
 * Preference order for the overall countback. The brief specifies "Round 3, then 4, 2,
 * 1", with the rationale that Round 3 should be a course with a trustworthy (non-
 * placeholder) stroke index. This is PARAMETERIZED, not hard-coded, because the tee-
 * sheet swap (R2=Black, R3=Blue) means the literal order no longer maps to the original
 * "Black first" reasoning. See docs/spec/handoff.md — the final call is a one-line change
 * to this default.
 */
export const DEFAULT_COUNTBACK_ROUND_ORDER: readonly number[] = [3, 4, 2, 1]

// ---------------------------------------------------------------------------
// Step 2 — holes won outright
// ---------------------------------------------------------------------------

/** One player's standing on one hole for the holes-won comparison. */
export interface HoleNetCell {
  playerId: string
  net: number | null // net score; null when not completed with a score
  completed: boolean // entered a gross score OR picked up
}

/** The outright winner of a single hole, or null if the hole is halved / unwinnable. */
export function outrightHoleWinner(cells: HoleNetCell[]): string | null {
  // Only completed holes WITH a net score are eligible; a pickup is completed but has
  // net null, so it can never win, exactly as specified.
  const eligible = cells.filter((c) => c.completed && c.net !== null) as {
    playerId: string
    net: number
  }[]
  if (eligible.length < 2) return null

  let min = Infinity
  for (const c of eligible) if (c.net < min) min = c.net
  const winners = eligible.filter((c) => c.net === min)
  return winners.length === 1 ? winners[0].playerId : null
}

/**
 * Tally outright hole wins across a set of holes. The caller passes only holes that are
 * eligible: from counting (non-abandoned) rounds, and within each round's counted
 * cutoff. Returns playerId -> holes won (absent players have won zero).
 */
export function tallyHolesWon(holes: HoleNetCell[][]): Map<string, number> {
  const tally = new Map<string, number>()
  for (const cells of holes) {
    const winner = outrightHoleWinner(cells)
    if (winner !== null) tally.set(winner, (tally.get(winner) ?? 0) + 1)
  }
  return tally
}

// ---------------------------------------------------------------------------
// Step 3 — countback
// ---------------------------------------------------------------------------

/** All the round data the countback needs, keyed by round number. */
export interface CountbackRound {
  roundNumber: number
  status: RoundStatus
  holesCounted: number // 18 for a full round; fewer for a shortened one
  /** playerId -> (holeNumber -> Stableford points). A missing hole counts as 0 points. */
  pointsByPlayerHole: Map<string, Map<number, number>>
}

export interface CountbackContext {
  rounds: Map<number, CountbackRound>
  roundOrder: readonly number[]
}

/** Build the ordered list of hole-windows to sum, from the deepest back. */
export function countbackHoleStages(holesCounted: number): number[][] {
  const range = (lo: number, hi: number): number[] => {
    const out: number[] = []
    for (let h = lo; h <= hi; h++) out.push(h)
    return out
  }

  if (holesCounted >= 18) {
    // Standard: holes 10–18, then 13–18, then 16–18, then hole 18.
    return [range(10, 18), range(13, 18), range(16, 18), [18]]
  }
  if (holesCounted >= 10) {
    // Shortened but reached hole 10: clamp the standard windows to the counted end.
    return [range(10, holesCounted), range(13, holesCounted), range(16, holesCounted), [holesCounted]].filter(
      (s) => s.length > 0,
    )
  }
  // Shortened, never reached hole 10: count back from the END of the counted holes —
  // last 6 counted, then last 3, then the final counted hole.
  const end = holesCounted
  if (end <= 0) return []
  return [range(Math.max(1, end - 5), end), range(Math.max(1, end - 2), end), [end]].filter((s) => s.length > 0)
}

function sumStage(round: CountbackRound, playerId: string, holes: number[]): number {
  const byHole = round.pointsByPlayerHole.get(playerId)
  if (!byHole) return 0
  let sum = 0
  for (const h of holes) sum += byHole.get(h) ?? 0
  return sum
}

/** Where a pairwise countback was decided, for the "which holes were used" UI copy. */
export interface CountbackDecision {
  cmp: number // < 0 => a ranks ahead of b; > 0 => b ahead; 0 => still tied
  roundNumber: number | null
  holes: number[] | null
}

/**
 * Compare two players by countback: walk the preference order of rounds (skipping any
 * that are missing or abandoned), and within each round walk the descending hole
 * windows, returning at the first window where their summed points differ.
 */
export function compareCountback(a: string, b: string, ctx: CountbackContext): CountbackDecision {
  for (const rn of ctx.roundOrder) {
    const round = ctx.rounds.get(rn)
    if (!round || round.status === 'abandoned') continue
    for (const holes of countbackHoleStages(round.holesCounted)) {
      const pa = sumStage(round, a, holes)
      const pb = sumStage(round, b, holes)
      if (pa !== pb) return { cmp: pb - pa, roundNumber: rn, holes } // higher points ranks first
    }
  }
  return { cmp: 0, roundNumber: null, holes: null }
}

export interface CountbackResolution {
  order: string[] // tied players, best-to-worst after countback
  resolved: boolean // false => an unbreakable tie remains at the top (declare a tie)
  decidedBy: CountbackDecision | null // how the top position was settled, for the UI
}

/**
 * Resolve a set of tied players by countback. Used for both the overall championship
 * (roundOrder = preference order) and a single round (roundOrder = [that round]).
 * If every relevant round is abandoned, no comparison can be made and resolved is false.
 */
export function resolveCountback(tiedPlayerIds: string[], ctx: CountbackContext): CountbackResolution {
  const order = [...tiedPlayerIds].sort((a, b) => compareCountback(a, b, ctx).cmp)

  // Resolved iff the top player strictly beats the runner-up. (We report resolution of
  // the CHAMPION; deeper ties among lower places don't unseat a decided winner.)
  let resolved = false
  let decidedBy: CountbackDecision | null = null
  if (order.length <= 1) {
    resolved = order.length === 1
  } else {
    decidedBy = compareCountback(order[0], order[1], ctx)
    resolved = decidedBy.cmp < 0
  }

  return { order, resolved, decidedBy }
}

// ---------------------------------------------------------------------------
// Step 1 — best single round
// ---------------------------------------------------------------------------

/**
 * Compare two players by their best single round: highest one-round points wins; if
 * equal, second-best, then third, and so on. Each argument is the player's per-round
 * counted points (order irrelevant — sorted here). A DNP round is 0 and stays in the list.
 * Returns < 0 when `a` ranks ahead, > 0 when `b` does, 0 when every ranked round is equal.
 */
export function compareBestRounds(aPoints: readonly number[], bPoints: readonly number[]): number {
  const a = [...aPoints].sort((x, y) => y - x)
  const b = [...bPoints].sort((x, y) => y - x)
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av !== bv) return bv - av // higher wins → a ahead (negative) when av > bv
  }
  return 0
}

// ---------------------------------------------------------------------------
// The overall chain — best single round → holes won → countback
// ---------------------------------------------------------------------------

/** Everything the overall tiebreaker needs, precomputed once for the whole field. */
export interface OverallTiebreakContext {
  /** playerId -> that player's per-round counted points (DNP = 0). Step 1. */
  roundPointsById: Map<string, readonly number[]>
  /** playerId -> outright holes won across counting rounds (tallyHolesWon). Step 2. */
  holesWonById: Map<string, number>
  /** Round data + preference order for the countback. Step 3. */
  countback: CountbackContext
}

/**
 * The Overall Championship tiebreaker, run only on players level on total points:
 *   1. Best single round (then second-best, then third …)
 *   2. Most holes won outright
 *   3. Countback on the latest counting round (preference order, closing-hole windows)
 * Returns < 0 when `a` ranks ahead, > 0 when `b` does, 0 for a genuinely unbreakable tie.
 */
export function compareOverall(a: string, b: string, ctx: OverallTiebreakContext): number {
  const s1 = compareBestRounds(ctx.roundPointsById.get(a) ?? [], ctx.roundPointsById.get(b) ?? [])
  if (s1 !== 0) return s1

  const ha = ctx.holesWonById.get(a) ?? 0
  const hb = ctx.holesWonById.get(b) ?? 0
  if (ha !== hb) return hb - ha // more holes won ranks ahead

  return compareCountback(a, b, ctx.countback).cmp
}
