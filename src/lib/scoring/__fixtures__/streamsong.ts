// Real Streamsong scorecard data, transcribed from the resort's own printed cards
// (the "2021" scorecard PDFs provided by Kyle; identical rating/slope to the resort
// website and BlueGolf detailed scorecards). Used to hand-verify the scoring engine
// against published numbers — this is TEST DATA, not the app's seed source (Phase 2
// owns the DB seeds). Per-hole stroke index is the men's "Handicap (M)" row.
//
// Source: Streamsong Resort official scorecards —
//   Red-2021-Scorecard.pdf, Blue-2021-Scorecard.pdf, Black-2021-Scorecard.pdf.
// Rating/slope are the Green (championship) tees on each course.

import type { HoleInfo } from '../types'

export interface TeeRef {
  course: string
  tee: string
  rating: number
  slope: number
  par: number
}

// --- Green-tee rating / slope / par ---------------------------------------
export const RED_GREEN: TeeRef = { course: 'Red', tee: 'Green', rating: 74.1, slope: 137, par: 72 }
export const BLUE_GREEN: TeeRef = { course: 'Blue', tee: 'Green', rating: 74.0, slope: 134, par: 72 }
export const BLACK_GREEN: TeeRef = { course: 'Black', tee: 'Green', rating: 74.7, slope: 135, par: 73 }

// --- Per-hole par + stroke index (Handicap M) -----------------------------
// Streamsong Red (par 72)
export const RED_HOLES: HoleInfo[] = [
  { holeNumber: 1, par: 4, strokeIndex: 4 },
  { holeNumber: 2, par: 5, strokeIndex: 2 },
  { holeNumber: 3, par: 4, strokeIndex: 14 },
  { holeNumber: 4, par: 4, strokeIndex: 16 },
  { holeNumber: 5, par: 4, strokeIndex: 6 },
  { holeNumber: 6, par: 3, strokeIndex: 18 },
  { holeNumber: 7, par: 5, strokeIndex: 12 },
  { holeNumber: 8, par: 3, strokeIndex: 10 },
  { holeNumber: 9, par: 4, strokeIndex: 8 },
  { holeNumber: 10, par: 4, strokeIndex: 9 },
  { holeNumber: 11, par: 4, strokeIndex: 5 },
  { holeNumber: 12, par: 4, strokeIndex: 3 },
  { holeNumber: 13, par: 5, strokeIndex: 15 },
  { holeNumber: 14, par: 3, strokeIndex: 11 },
  { holeNumber: 15, par: 4, strokeIndex: 1 },
  { holeNumber: 16, par: 3, strokeIndex: 7 },
  { holeNumber: 17, par: 4, strokeIndex: 13 },
  { holeNumber: 18, par: 5, strokeIndex: 17 },
]

// Streamsong Blue (par 72)
export const BLUE_HOLES: HoleInfo[] = [
  { holeNumber: 1, par: 4, strokeIndex: 14 },
  { holeNumber: 2, par: 5, strokeIndex: 10 },
  { holeNumber: 3, par: 4, strokeIndex: 8 },
  { holeNumber: 4, par: 4, strokeIndex: 4 },
  { holeNumber: 5, par: 3, strokeIndex: 16 },
  { holeNumber: 6, par: 4, strokeIndex: 18 },
  { holeNumber: 7, par: 3, strokeIndex: 12 },
  { holeNumber: 8, par: 4, strokeIndex: 2 },
  { holeNumber: 9, par: 5, strokeIndex: 6 },
  { holeNumber: 10, par: 3, strokeIndex: 15 },
  { holeNumber: 11, par: 4, strokeIndex: 1 },
  { holeNumber: 12, par: 4, strokeIndex: 11 },
  { holeNumber: 13, par: 4, strokeIndex: 17 },
  { holeNumber: 14, par: 5, strokeIndex: 9 },
  { holeNumber: 15, par: 4, strokeIndex: 7 },
  { holeNumber: 16, par: 3, strokeIndex: 13 },
  { holeNumber: 17, par: 5, strokeIndex: 5 },
  { holeNumber: 18, par: 4, strokeIndex: 3 },
]

// Streamsong Black (par 73 — note holes 10 & 12 are par 5, giving the extra stroke)
export const BLACK_HOLES: HoleInfo[] = [
  { holeNumber: 1, par: 5, strokeIndex: 12 },
  { holeNumber: 2, par: 4, strokeIndex: 16 },
  { holeNumber: 3, par: 4, strokeIndex: 4 },
  { holeNumber: 4, par: 5, strokeIndex: 2 },
  { holeNumber: 5, par: 3, strokeIndex: 6 },
  { holeNumber: 6, par: 4, strokeIndex: 18 },
  { holeNumber: 7, par: 3, strokeIndex: 14 },
  { holeNumber: 8, par: 4, strokeIndex: 8 },
  { holeNumber: 9, par: 4, strokeIndex: 10 },
  { holeNumber: 10, par: 5, strokeIndex: 11 },
  { holeNumber: 11, par: 4, strokeIndex: 3 },
  { holeNumber: 12, par: 5, strokeIndex: 7 },
  { holeNumber: 13, par: 4, strokeIndex: 9 },
  { holeNumber: 14, par: 4, strokeIndex: 15 },
  { holeNumber: 15, par: 3, strokeIndex: 17 },
  { holeNumber: 16, par: 4, strokeIndex: 1 },
  { holeNumber: 17, par: 3, strokeIndex: 13 },
  { holeNumber: 18, par: 5, strokeIndex: 5 },
]

/** Assert a course's stroke indexes form a complete 1..18 permutation. */
export function isCompleteStrokeIndex(holes: HoleInfo[]): boolean {
  const seen = new Set(holes.map((h) => h.strokeIndex))
  if (seen.size !== 18) return false
  for (let i = 1; i <= 18; i++) if (!seen.has(i)) return false
  return true
}
