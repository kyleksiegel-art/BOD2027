import { describe, it, expect } from 'vitest'
import { buildEnterHole, type Db } from './compute'
import type {
  PlayerRow,
  CourseRow,
  TeeRow,
  HoleRow,
  RoundPlayerRow,
  ScoreRow,
  SettingRow,
} from './types'

// The Enter screen's opening hole: the first hole on which some playing player has no
// stored score. Same flat fixture as relative-strokes.test.ts (par 4s, S.I. == hole).

const COURSE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const TEE = 'tttttttt-tttt-tttt-tttt-tttttttttttt'
const ROUND = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr'
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const C = 'cccccccc-1111-1111-1111-111111111111'
const D = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

function holes(): HoleRow[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: `${COURSE}-h${i + 1}`, course_id: COURSE, hole_number: i + 1, par: 4, stroke_index: i + 1,
  }))
}

function cell(playerId: string, hole: number, gross: number | null = 4, pickedUp = false): ScoreRow {
  return { id: `${playerId}-s${hole}`, round_id: ROUND, player_id: playerId, hole_number: hole, gross_strokes: gross, picked_up: pickedUp }
}

function rp(playerId: string, status: RoundPlayerRow['status'] = 'playing'): RoundPlayerRow {
  return {
    round_id: ROUND, player_id: playerId, tee_id: TEE, index_used: 10, allowance_used: 1, cap_used: 18,
    course_handicap: 10, playing_handicap: 10, cap_applied: false, strokes_received: 10, manual_override: null, status,
  }
}

function makeDb(field: { id: string; status?: RoundPlayerRow['status'] }[], scores: ScoreRow[]): Db {
  const players: PlayerRow[] = field.map((f, i) => ({
    id: f.id, name: `P${i + 1}`, title: null, handicap_index: 10,
    index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: i,
  }) as unknown as PlayerRow)
  return {
    players,
    courses: [{ id: COURSE, name: 'Red', data_is_placeholder: false } as unknown as CourseRow],
    tees: [{ id: TEE, course_id: COURSE, name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 6500 } as unknown as TeeRow],
    holes: holes(),
    hole_yardages: [],
    rounds: [{ id: ROUND, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status: 'in_progress', holes_counted: null }],
    round_players: field.map((f) => rp(f.id, f.status)),
    scores,
    ctp_results: [],
    settings: [{ key: 'purse_mode', value: 'buyin' }] as SettingRow[],
  }
}

const FOUR = [{ id: A }, { id: B }, { id: C }, { id: D }]
function complete(players: string[], upTo: number): ScoreRow[] {
  return players.flatMap((p) => Array.from({ length: upTo }, (_, i) => cell(p, i + 1)))
}

describe('buildEnterHole firstOpenHole', () => {
  it('is the 1st when nothing has been entered', () => {
    expect(buildEnterHole(1, 1, makeDb(FOUR, []))!.firstOpenHole).toBe(1)
  })

  it('is the hole after the last one every playing player has finished', () => {
    const db = makeDb(FOUR, complete([A, B, C, D], 12))
    expect(buildEnterHole(1, 1, db)!.firstOpenHole).toBe(13)
  })

  it('stays on a hole that is only partly entered', () => {
    const scores = [...complete([A, B, C, D], 6), cell(A, 7), cell(B, 7), cell(C, 7)]
    expect(buildEnterHole(1, 1, makeDb(FOUR, scores))!.firstOpenHole).toBe(7)
  })

  it('a pick-up counts as an entry', () => {
    const scores = [...complete([A, B, C], 3), cell(D, 1), cell(D, 2), cell(D, 3, null, true)]
    expect(buildEnterHole(1, 1, makeDb(FOUR, scores))!.firstOpenHole).toBe(4)
  })

  it('does not wait for a DNP player', () => {
    const field = [{ id: A }, { id: B }, { id: C }, { id: D, status: 'did_not_play' as const }]
    expect(buildEnterHole(1, 1, makeDb(field, complete([A, B, C], 9)))!.firstOpenHole).toBe(10)
  })

  it('is the 18th once the round is fully entered', () => {
    expect(buildEnterHole(1, 1, makeDb(FOUR, complete([A, B, C, D], 18)))!.firstOpenHole).toBe(18)
  })

  it('does not depend on which hole is being viewed', () => {
    const db = makeDb(FOUR, complete([A, B, C, D], 4))
    expect(buildEnterHole(1, 15, db)!.firstOpenHole).toBe(5)
  })

  it('is the 1st when no round_players exist yet', () => {
    expect(buildEnterHole(1, 1, makeDb([], []))!.firstOpenHole).toBe(1)
  })
})
