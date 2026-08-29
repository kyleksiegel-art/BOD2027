// Pure scoring types. No React, no network imports — see CLAUDE.md "Scoring in one
// paragraph" and "Data-layering rule". Everything here is derivable from stored gross
// scores plus the per-round handicap snapshot; nothing here reads the database.

/** A hole's fixed definition on a course. Stroke index is stored once per course
 *  (`holes.stroke_index`), never per tee — see schema.md. */
export interface HoleInfo {
  holeNumber: number // 1..18
  par: number // course par for the hole (Bone Valley may be null upstream; scoring requires it)
  strokeIndex: number // 1..18, a complete permutation across the course
}

/** Net Stableford points. The six values live in `settings.points_table` and are
 *  retroactive (applied at compute time), so editing one recomputes every leaderboard.
 *  The two open-ended rows (clamps) are structural and not configurable. */
export interface PointsTable {
  threeOrMoreUnder: number // net <= par - 3   (default 5)
  twoUnder: number //        net == par - 2   (default 4)
  oneUnder: number //        net == par - 1   (default 3)
  level: number //           net == par       (default 2)
  oneOver: number //         net == par + 1   (default 1)
  twoOrMoreOver: number //   net >= par + 2   (default 0)
}

export const DEFAULT_POINTS_TABLE: PointsTable = {
  threeOrMoreUnder: 5,
  twoUnder: 4,
  oneUnder: 3,
  level: 2,
  oneOver: 1,
  twoOrMoreOver: 0,
}

export type RoundPlayerStatus = 'playing' | 'did_not_play'
export type RoundStatus = 'upcoming' | 'in_progress' | 'final' | 'abandoned'

/** Inputs to the WHS course-handicap formula. `index` is negative for plus handicaps. */
export interface HandicapInput {
  index: number
  rating: number | null // tee course rating; null only for unpublished Bone Valley
  slope: number | null // tee slope; null-with-rating-known => default 113
  par: number // course par (Black is 73, not 72)
  allowancePct: number // 1.0 default; 0.95 is the WHS Appendix C alternative
  cap: number // house-rule cap on the playing handicap, default 18
}

/** Which Bone Valley fallback (if any) was used, so the UI can show the right banner. */
export type HandicapFallback = 'none' | 'slope-default' | 'index-only'

/** Full derivation of a player's strokes for a round — every intermediate value is
 *  exposed so the handicap worksheet can render the audit trail (brief §worksheet). */
export interface HandicapResult {
  index: number
  ratingUsed: number | null
  slopeUsed: number // effective slope (113 when defaulted)
  par: number
  allowancePct: number
  cap: number
  indexTimesSlope: number // index * (slope / 113), unrounded
  ratingMinusPar: number // rating - par (0 in index-only mode)
  courseHandicapUnrounded: number // carried unrounded per 2024 WHS
  afterAllowance: number // courseHandicapUnrounded * allowancePct, unrounded
  playingHandicap: number // rounded exactly once, half-away-from-zero
  capApplied: boolean // true only when playingHandicap strictly exceeds the cap
  strokesReceived: number // final playing handicap after the cap
  fallback: HandicapFallback
}

/** A single stored score cell — the whole tuple the outbox replaces atomically. */
export interface HoleScore {
  holeNumber: number
  grossStrokes: number | null // null = not entered (unless pickedUp)
  pickedUp: boolean // scores 0, counts as played; mutually exclusive with a gross score
}

/** Per-hole scoring result derived from a HoleScore + allocated strokes. */
export interface HoleResult {
  holeNumber: number
  par: number
  strokesReceived: number // allocated to this hole; negative for a plus handicap
  grossStrokes: number | null
  pickedUp: boolean
  net: number | null // gross - strokesReceived; null when the hole isn't completed
  netToPar: number | null // net - par
  points: number | null // Stableford points; null = not entered (does not yet count)
  completed: boolean // an entered gross score or a picked-up flag
}
