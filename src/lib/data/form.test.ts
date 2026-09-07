import { describe, it, expect } from 'vitest'
import { buildPlayerForm } from './form'
import type { Db } from './compute'
import type { PlayerRow, CourseRow, TeeRow, HoleRow, RoundRow, RoundPlayerRow, ScoreRow } from './types'

// Two scratch players (index 0, rating 72 / slope 113 / par 72 → net == gross) on an all-par-4
// course. Points read straight off the gross: birdie 3, par 2, bogey 1, double 0 — so every
// figure can be worked out by hand.

const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'
const COURSE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const TEE = 'tttttttt-tttt-tttt-tttt-tttttttttttt'
const R1 = 'r1r1r1r1-r1r1-r1r1-r1r1-r1r1r1r1r1r1'
const R2 = 'r2r2r2r2-r2r2-r2r2-r2r2-r2r2r2r2r2r2'
const R3 = 'r3r3r3r3-r3r3-r3r3-r3r3-r3r3r3r3r3r3'

function holesFor(courseId: string): HoleRow[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: `${courseId}-h${i + 1}`,
    course_id: courseId,
    hole_number: i + 1,
    par: 4,
    stroke_index: i + 1,
  }))
}

function roundPlayer(playerId: string, roundId: string, status: 'playing' | 'did_not_play' = 'playing'): RoundPlayerRow {
  return {
    round_id: roundId,
    player_id: playerId,
    tee_id: TEE,
    index_used: 0,
    allowance_used: 1,
    cap_used: 18,
    course_handicap: 0,
    playing_handicap: 0,
    cap_applied: false,
    strokes_received: 0,
    manual_override: null,
    status,
  }
}

/** Gross for holes 1..thru: par 4 plus a delta (−1 birdie, +1 bogey, +2 double), 'pu' = picked up. */
function scoresFor(playerId: string, roundId: string, thru: number, deltas: Record<number, number | 'pu'> = {}): ScoreRow[] {
  return Array.from({ length: thru }, (_, i) => {
    const n = i + 1
    const d = deltas[n]
    return {
      id: `${playerId}-${roundId}-s${n}`,
      round_id: roundId,
      player_id: playerId,
      hole_number: n,
      gross_strokes: d === 'pu' ? null : 4 + (typeof d === 'number' ? d : 0),
      picked_up: d === 'pu',
    }
  })
}

function makeDb(opts: { r3?: boolean; p2SitsOutR2?: boolean; r1Shortened?: boolean } = {}): Db {
  const players: PlayerRow[] = [
    { id: P1, name: 'Jon Aronson', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 0 } as unknown as PlayerRow,
    { id: P2, name: 'Chris Denove', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 1 } as unknown as PlayerRow,
  ]
  const courses: CourseRow[] = [{ id: COURSE, name: 'Streamsong Red', data_is_placeholder: false } as unknown as CourseRow]
  const tees: TeeRow[] = [{ id: TEE, course_id: COURSE, name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 6500 } as unknown as TeeRow]
  const rounds: RoundRow[] = [
    { id: R1, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status: 'final', holes_counted: opts.r1Shortened ? 15 : null },
    { id: R2, round_number: 2, date: '2027-02-05', course_id: COURSE, tee_time: null, status: 'in_progress', holes_counted: null },
    // Round 3 is upcoming unless asked for — it must never count.
    { id: R3, round_number: 3, date: '2027-02-06', course_id: COURSE, tee_time: null, status: opts.r3 ? 'final' : 'upcoming', holes_counted: null },
  ]

  const roundPlayers = [
    roundPlayer(P1, R1),
    roundPlayer(P2, R1),
    roundPlayer(P1, R2),
    roundPlayer(P2, R2, opts.p2SitsOutR2 ? 'did_not_play' : 'playing'),
    roundPlayer(P1, R3),
    roundPlayer(P2, R3),
  ]

  const scores: ScoreRow[] = [
    // R1, P1, all 18: doubles on 4 and 12, birdie on 18. So holes 1–3 score, 4 blanks,
    // 5–11 score (a run of 7), 12 blanks, 13–18 score (a run of 6).
    ...scoresFor(P1, R1, 18, { 4: 2, 12: 2, 18: -1 }),
    // R1, P2, all 18: level par — one unbroken run of 18, worst 3 = 6.
    ...scoresFor(P2, R1, 18),
    // R2 (live), P1, thru 5: double on 2 and 3 → worst 3 (H1–3) = 2 pts; run of 2 at the end.
    ...scoresFor(P1, R2, 5, { 2: 2, 3: 2 }),
    ...(opts.p2SitsOutR2 ? [] : scoresFor(P2, R2, 5, { 5: 'pu' })),
    // R3 only counts when asked; give P1 an eagle so the strip can be checked.
    ...(opts.r3 ? scoresFor(P1, R3, 2, { 1: -2 }) : []),
    ...(opts.r3 ? scoresFor(P2, R3, 2) : []),
  ]

  return {
    players,
    courses,
    tees,
    holes: holesFor(COURSE),
    hole_yardages: [],
    rounds,
    round_players: roundPlayers,
    scores,
    ctp_results: [],
    settings: [],
  }
}

describe('buildPlayerForm', () => {
  it('has nothing to say before a hole is completed', () => {
    const db = makeDb()
    db.scores = []
    expect(buildPlayerForm(db).size).toBe(0)
  })

  it('counts only final and in-progress rounds', () => {
    const form = buildPlayerForm(makeDb()).get(P1)!
    // R1's 18 + R2's 5. Round 3 is upcoming and must not appear.
    expect(form.holesPlayed).toBe(23)
    expect(form.throughLabel).toBe('through R2, hole 5 · 23 holes')
  })

  it('finds the longest run of scoring holes, tie broken by points then the later round', () => {
    const form = buildPlayerForm(makeDb()).get(P1)!
    // R1: 1–3, then 5–11 (seven), then 13–18 (six). The seven wins.
    expect(form.bestRun).toEqual({
      holes: 7,
      roundNumber: 1,
      courseName: 'Streamsong Red',
      from: 5,
      to: 11,
      points: 14,
    })
    // P2 played level par for all 18 — one unbroken run.
    expect(buildPlayerForm(makeDb()).get(P2)!.bestRun!.holes).toBe(18)
  })

  it('finds the worst three-hole stretch across rounds, earliest on a tie', () => {
    const form = buildPlayerForm(makeDb()).get(P1)!
    // R2 H1–3 is 2 + 0 + 0 = 2, worse than anything in R1.
    expect(form.worstStretch).toEqual({ points: 2, roundNumber: 2, courseName: 'Streamsong Red', from: 1 })
    // P2 never blanked in R1 and picked up on R2's 5th: H3–5 = 2 + 2 + 0 = 4.
    expect(buildPlayerForm(makeDb()).get(P2)!.worstStretch!.points).toBe(4)
  })

  it('splits the nines by points per hole, and stays quiet until both nines have holes', () => {
    const form = buildPlayerForm(makeDb()).get(P1)!
    // Front: R1 holes 1–9 (2,2,2,0,2,2,2,2,2 = 16) + R2 holes 1–5 (2,0,0,2,2 = 6) = 22 over 14.
    // Back: R1 holes 10–18 (2,2,0,2,2,2,2,2,3 = 17) over 9.
    expect(form.front).toEqual({ points: 22, holes: 14 })
    expect(form.back).toEqual({ points: 17, holes: 9 })
    // 1.571/hole front vs 1.889/hole back → the back is the better nine.
    expect(form.splitLean).toBe('back')
    expect(form.splitNote).toBe('1.6 points a hole on the front, 1.9 on the back.')

    // A player with only front-nine holes in gets no note at all — the split needs both nines.
    const early = makeDb({ p2SitsOutR2: true })
    early.scores = early.scores.filter((sc) => !(sc.round_id === R1 && sc.player_id === P2 && sc.hole_number > 6))
    const p2 = buildPlayerForm(early).get(P2)!
    expect(p2.front).toEqual({ points: 12, holes: 6 })
    expect(p2.back).toEqual({ points: 0, holes: 0 })
    expect(p2.splitNote).toBeNull()
    expect(p2.splitLean).toBeNull()
  })

  it('gives one strip per round played, newest first, flagging eagles and pick-ups', () => {
    const form = buildPlayerForm(makeDb({ r3: true })).get(P1)!
    // R1 (18 in), R2 (5 in), R3 (2 in) → newest first.
    expect(form.strips.map((st) => st.roundNumber)).toEqual([3, 2, 1])
    expect(form.strips.map((st) => st.complete)).toEqual([false, false, true])
    // R1: 18 pars (36) − two doubles (−4) + the birdie on 18 (+1) = 33.
    expect(form.strips[2].points).toBe(33)

    const r3 = form.strips[0]
    expect(r3.cells).toHaveLength(18)
    expect(r3.cells[0]).toMatchObject({ points: 4, eagle: true, counted: true })
    expect(r3.cells[2]).toMatchObject({ holeNumber: 3, points: null, played: false, counted: true })

    // A DNP round is absent entirely — P2 played round 1 only.
    const sat = buildPlayerForm(makeDb({ p2SitsOutR2: true })).get(P2)!
    expect(sat.strips.map((st) => st.roundNumber)).toEqual([1])
    expect(sat.holesPlayed).toBe(18)

    // The pick-up on R2's 5th shows as played, zero points.
    const p2 = buildPlayerForm(makeDb()).get(P2)!
    expect(p2.strips[0].roundNumber).toBe(2)
    expect(p2.strips[0].cells[4]).toMatchObject({ holeNumber: 5, points: 0, played: true, pickedUp: true })
  })

  it('keeps every strip 18 wide so a shortened round still lines up hole-for-hole', () => {
    const form = buildPlayerForm(makeDb({ r1Shortened: true })).get(P1)!
    const r1 = form.strips.find((st) => st.roundNumber === 1)!
    expect(r1.holesCounted).toBe(15)
    expect(r1.cells).toHaveLength(18)
    // Holes 16–18 are past the cutoff: not counted, and not treated as merely unplayed.
    expect(r1.cells.slice(15).every((c) => !c.counted && !c.played)).toBe(true)
    expect(r1.cells.slice(0, 15).every((c) => c.counted)).toBe(true)
    // Every strip is the same width, whatever each round's cutoff.
    expect(new Set(form.strips.map((st) => st.cells.length))).toEqual(new Set([18]))
  })
})
