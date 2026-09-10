import { describe, it, expect } from 'vitest'
import { buildEnterHole, buildRoundRecap, resolveRoundWinnerIds, buildRoundDetail, type Db } from './compute'
import { resolveRoundWinner } from './money'
import type { PlayerRow, CourseRow, TeeRow, HoleRow, RoundRow, RoundPlayerRow, ScoreRow } from './types'

// Regressions from the 2026-09-09 audit:
//   F-010 — the recap card named everyone level on points as "Winner · pays" while the
//           Money page paid the countback winner. Both must now come from one resolver.
//   F-009 — a finalized round is closed to score entry on the Enter screen.
//
// Two scratch players on an all-par-4 course (index 0 → net == gross → par 2, birdie 3,
// bogey 1). A birdies the 1st and bogeys the 18th; B birdies the 2nd and bogeys the 17th:
// both 36 points, level on 10–18 (17), 13–18 (11) and 16–18 (5); the 18th alone decides it,
// A 1 v B 2 → B wins the round on countback.

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const COURSE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const TEE = 'tttttttt-tttt-tttt-tttt-tttttttttttt'
const ROUND = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr'

function rp(playerId: string): RoundPlayerRow {
  return {
    round_id: ROUND, player_id: playerId, tee_id: TEE, index_used: 0, allowance_used: 1, cap_used: 18,
    course_handicap: 0, playing_handicap: 0, cap_applied: false, strokes_received: 0, manual_override: null, status: 'playing',
  }
}

function scores(playerId: string, deltas: Record<number, number>): ScoreRow[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: `${playerId}-${i + 1}`, round_id: ROUND, player_id: playerId, hole_number: i + 1,
    gross_strokes: 4 + (deltas[i + 1] ?? 0), picked_up: false,
  }))
}

function makeDb(status: RoundRow['status']): Db {
  const players = [
    { id: A, name: 'Jon Aronson', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 0 },
    { id: B, name: 'Kyle Siegel', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 1 },
  ] as unknown as PlayerRow[]
  const holes: HoleRow[] = Array.from({ length: 18 }, (_, i) => ({ id: `h${i + 1}`, course_id: COURSE, hole_number: i + 1, par: 4, stroke_index: i + 1 }))
  return {
    players,
    courses: [{ id: COURSE, name: 'Streamsong Red', data_is_placeholder: false } as unknown as CourseRow],
    tees: [{ id: TEE, course_id: COURSE, name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 7000 } as unknown as TeeRow],
    holes,
    hole_yardages: [],
    rounds: [{ id: ROUND, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status, holes_counted: null }],
    round_players: [rp(A), rp(B)],
    scores: [...scores(A, { 1: -1, 18: 1 }), ...scores(B, { 2: -1, 17: 1 })],
    ctp_results: [],
    settings: [],
  }
}

describe('round winner on a points tie', () => {
  it('the recap names the countback winner alone, and Money pays the same player', () => {
    const db = makeDb('final')
    const detail = buildRoundDetail(1, db)!
    expect(resolveRoundWinnerIds(detail)).toEqual({ ids: [B], onCountback: true })

    const recap = buildRoundRecap(1, db)!
    expect(recap.act).toBe('final')
    expect(recap.winners.map((w) => w.name)).toEqual(['Kyle Siegel'])
    expect(recap.onCountback).toBe(true)
    expect(recap.margin).toBe(0)
    expect(recap.headline.map((s) => s.text).join('')).toBe('Kyle takes the Red on countback.')

    const money = resolveRoundWinner(detail)
    expect(money?.playerIds).toEqual([B])
  })

  it('while the round is live, players level on points still share the lead', () => {
    const recap = buildRoundRecap(1, makeDb('in_progress'))!
    // Everyone is thru 18 so the act is "final" by completeness even though the status is
    // in_progress — the countback applies there too. Trim the scores to make it live.
    expect(recap.act).toBe('final')
    const db = makeDb('in_progress')
    db.scores = db.scores.filter((s) => s.hole_number <= 12)
    const live = buildRoundRecap(1, db)!
    expect(live.act).not.toBe('final')
    expect(live.winners.length).toBe(2)
    expect(live.onCountback).toBe(false)
  })
})

describe('a finalized round is closed to score entry', () => {
  it('buildEnterHole blocks with round_closed', () => {
    expect(buildEnterHole(1, 5, makeDb('final'))?.blocked).toEqual({ reason: 'round_closed', issues: [] })
    expect(buildEnterHole(1, 5, makeDb('abandoned'))?.blocked).toEqual({ reason: 'round_closed', issues: [] })
    expect(buildEnterHole(1, 5, makeDb('in_progress'))?.blocked).toBeNull()
  })
})
