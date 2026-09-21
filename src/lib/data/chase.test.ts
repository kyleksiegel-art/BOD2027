import { describe, it, expect } from 'vitest'
import { buildStandings, type Db } from './compute'
import { formatChaseLine } from '@/lib/format'
import type { PlayerRow, CourseRow, TeeRow, HoleRow, RoundRow, RoundPlayerRow, ScoreRow } from './types'

// "What it takes" — the line under each standings row while a round is live. Two players,
// scratch, par 4 everywhere (so net par = 2 pts, max per hole = 5 with the default table).
// Round 1 is final; round 2 is live; round 3 is upcoming unless a test says otherwise.

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const COURSE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const BONE = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const TEE = 'tttttttt-tttt-tttt-tttt-tttttttttttt'
const R1 = 'r1r1r1r1-rrrr-rrrr-rrrr-rrrrrrrrrrrr'
const R2 = 'r2r2r2r2-rrrr-rrrr-rrrr-rrrrrrrrrrrr'
const R3 = 'r3r3r3r3-rrrr-rrrr-rrrr-rrrrrrrrrrrr'

function rp(roundId: string, playerId: string, status: 'playing' | 'did_not_play' = 'playing'): RoundPlayerRow {
  return {
    round_id: roundId, player_id: playerId, tee_id: TEE, index_used: 0, allowance_used: 1, cap_used: 18,
    course_handicap: 0, playing_handicap: 0, cap_applied: false, strokes_received: 0, manual_override: null, status,
  }
}
/** `thru` holes of gross scores; `deltas` are strokes off par per hole (negative = birdie). */
function scores(roundId: string, playerId: string, thru: number, deltas: Record<number, number> = {}): ScoreRow[] {
  return Array.from({ length: thru }, (_, i) => ({
    id: `${roundId}-${playerId}-${i + 1}`, round_id: roundId, player_id: playerId, hole_number: i + 1,
    gross_strokes: 4 + (deltas[i + 1] ?? 0), picked_up: false,
  }))
}
interface Opts {
  aThru: number; bThru: number
  aDeltas?: Record<number, number>; bDeltas?: Record<number, number>
  r1Deltas?: Record<string, Record<number, number>>
  withUpcoming?: boolean
  bDnp?: boolean
}
function makeDb(o: Opts): Db {
  const rounds: RoundRow[] = [
    { id: R1, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status: 'final', holes_counted: null },
    { id: R2, round_number: 2, date: '2027-02-05', course_id: COURSE, tee_time: null, status: 'in_progress', holes_counted: null },
  ] as RoundRow[]
  if (o.withUpcoming ?? true) {
    rounds.push({ id: R3, round_number: 3, date: '2027-02-06', course_id: BONE, tee_time: null, status: 'upcoming', holes_counted: null } as RoundRow)
  }
  return {
    players: [
      { id: A, name: 'Adam Hersh', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 0 },
      { id: B, name: 'Kyle Siegel', title: null, handicap_index: 0, index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: 1 },
    ] as unknown as PlayerRow[],
    courses: [
      { id: COURSE, name: 'Streamsong Red', data_is_placeholder: false },
      { id: BONE, name: 'Streamsong Bone Valley', data_is_placeholder: false },
    ] as unknown as CourseRow[],
    tees: [{ id: TEE, course_id: COURSE, name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 7000 } as unknown as TeeRow],
    holes: Array.from({ length: 18 }, (_, i) => ({ id: `h${i + 1}`, course_id: COURSE, hole_number: i + 1, par: 4, stroke_index: i + 1 })) as HoleRow[],
    hole_yardages: [],
    rounds,
    round_players: [rp(R1, A), rp(R1, B), rp(R2, A), rp(R2, B, o.bDnp ? 'did_not_play' : 'playing')],
    scores: [
      ...scores(R1, A, 18, o.r1Deltas?.A ?? {}),
      ...scores(R1, B, 18, o.r1Deltas?.B ?? {}),
      ...scores(R2, A, o.aThru, o.aDeltas),
      ...scores(R2, B, o.bThru, o.bDeltas),
    ],
    ctp_results: [],
    settings: [],
  }
}
const byName = (db: Db) => {
  const s = buildStandings(db)
  return Object.fromEntries(s.rows.map((r) => [r.name.split(' ')[0], r]))
}

describe('what it takes (standings chase line)', () => {
  it('leader leads by the gap with holes to play; chaser needs gap + 1 over the holes left', () => {
    // Round 1 level (36 each). Round 2 thru 13: Adam 3 birdies (29), Kyle level par (26) → gap 3.
    const rows = byName(makeDb({ aThru: 13, bThru: 13, aDeltas: { 2: -1, 5: -1, 9: -1 } }))
    expect(rows.Adam.chase).toEqual({ kind: 'leads', by: 3, holesLeft: 5 })
    expect(rows.Kyle.chase).toEqual({ kind: 'needs', leaderName: 'Adam', by: 4, holesLeft: 5 })
    expect(formatChaseLine(rows.Adam.chase!)).toBe('Leads by 3 · 5 to play')
    expect(formatChaseLine(rows.Kyle.chase!)).toBe('Outscore Adam by 4 over 5 holes')
  })

  it('uses the chaser\'s own holes left when the group is spread', () => {
    const rows = byName(makeDb({ aThru: 13, bThru: 12, aDeltas: { 2: -1 } }))
    // Adam 27 vs Kyle 24 (one hole fewer) → gap 3, Kyle has 6 to play.
    expect(rows.Kyle.chase).toEqual({ kind: 'needs', leaderName: 'Adam', by: 4, holesLeft: 6 })
  })

  it('out of reach today (but not for the week) when the gap beats max points × holes left', () => {
    // Kyle 8 birdies over 17 holes → 42 vs Adam 34 → gap 8; Adam has 1 hole left (max 5). R3 to come.
    const rows = byName(makeDb({ aThru: 17, bThru: 17, bDeltas: { 1: -1, 2: -1, 3: -1, 4: -1, 5: -1, 6: -1, 7: -1, 8: -1 } }))
    expect(rows.Adam.chase).toEqual({ kind: 'out_today', roundsToCome: 1, nextCourse: 'Streamsong Bone Valley' })
    expect(formatChaseLine(rows.Adam.chase!)).toBe('Out of reach today · Bone Valley left')
    expect(rows.Kyle.chase).toEqual({ kind: 'leads', by: 8, holesLeft: 1 })
  })

  it('out of reach for the week when no upcoming round is left; the leader has clinched', () => {
    const rows = byName(makeDb({ aThru: 17, bThru: 17, bDeltas: { 1: -1, 2: -1, 3: -1, 4: -1, 5: -1, 6: -1, 7: -1, 8: -1 }, withUpcoming: false }))
    expect(rows.Adam.chase).toEqual({ kind: 'out' })
    expect(rows.Kyle.chase).toEqual({ kind: 'clinched' })
    expect(formatChaseLine(rows.Kyle.chase!)).toBe('Clinched')
  })

  it('level on points → both read "Level with"; a finished round drops the "to play" tail', () => {
    const rows = byName(makeDb({ aThru: 18, bThru: 18 }))
    expect(rows.Adam.chase).toEqual({ kind: 'level', withName: 'Kyle', holesLeft: 0 })
    expect(formatChaseLine(rows.Adam.chase!)).toBe('Level with Kyle')
  })

  it('a DNP has no holes today: out of reach today, with the week still open', () => {
    const rows = byName(makeDb({ aThru: 13, bThru: 0, bDnp: true, aDeltas: { 1: -1 } }))
    expect(rows.Kyle.chase).toEqual({ kind: 'out_today', roundsToCome: 1, nextCourse: 'Streamsong Bone Valley' })
  })

  it('no live round → no line', () => {
    const db = makeDb({ aThru: 18, bThru: 18 })
    db.rounds = db.rounds.map((r) => (r.id === R2 ? { ...r, status: 'final' } : r)) as RoundRow[]
    expect(buildStandings(db).rows.every((r) => r.chase === null)).toBe(true)
  })
})
