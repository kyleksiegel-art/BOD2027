import { describe, it, expect } from 'vitest'
import { buildRoundDetail, type Db } from './compute'
import type {
  PlayerRow,
  CourseRow,
  TeeRow,
  HoleRow,
  RoundPlayerRow,
  ScoreRow,
  SettingRow,
} from './types'

// "Play off the low handicap": the round field's lowest playing handicap is scratch, and
// everyone else gets only the difference. tee rating 72 / slope 113 / par 72 makes course
// handicap == index, and stroke_index == hole_number so strokes fall on holes 1..N in order.

const COURSE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const TEE = 'tttttttt-tttt-tttt-tttt-tttttttttttt'
const ROUND = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr'

function holes(): HoleRow[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: `${COURSE}-h${i + 1}`,
    course_id: COURSE,
    hole_number: i + 1,
    par: 4,
    stroke_index: i + 1,
  }))
}

function scores(playerId: string): ScoreRow[] {
  return Array.from({ length: 18 }, (_, i) => ({
    id: `${playerId}-s${i + 1}`,
    round_id: ROUND,
    player_id: playerId,
    hole_number: i + 1,
    gross_strokes: 4,
    picked_up: false,
  }))
}

function rp(playerId: string, index: number, status: RoundPlayerRow['status'] = 'playing'): RoundPlayerRow {
  return {
    round_id: ROUND,
    player_id: playerId,
    tee_id: TEE,
    index_used: index,
    allowance_used: 1,
    cap_used: 18,
    course_handicap: index,
    playing_handicap: index,
    cap_applied: false,
    strokes_received: index,
    manual_override: null,
    status,
  }
}

function makeDb(field: { id: string; index: number; status?: RoundPlayerRow['status'] }[]): Db {
  const players: PlayerRow[] = field.map((f, i) => ({
    id: f.id, name: `P${i + 1}`, title: null, handicap_index: f.index,
    index_is_assigned: false, index_updated_at: null, photo_url: null, sort_order: i,
  }) as unknown as PlayerRow)
  return {
    players,
    courses: [{ id: COURSE, name: 'Red', data_is_placeholder: false } as unknown as CourseRow],
    tees: [{ id: TEE, course_id: COURSE, name: 'Green', rating: 72, slope: 113, par: 72, total_yardage: 6500 } as unknown as TeeRow],
    holes: holes(),
    hole_yardages: [],
    rounds: [{ id: ROUND, round_number: 1, date: '2027-02-04', course_id: COURSE, tee_time: null, status: 'in_progress', holes_counted: null }],
    round_players: field.map((f) => rp(f.id, f.index, f.status)),
    scores: field.flatMap((f) => scores(f.id)),
    ctp_results: [],
    settings: [{ key: 'purse_mode', value: 'buyin' }] as SettingRow[],
  }
}

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const C = 'cccccccc-1111-1111-1111-111111111111'

describe('play off the low handicap', () => {
  it('the low man plays off scratch; everyone else gets only the difference', () => {
    const vm = buildRoundDetail(1, makeDb([{ id: A, index: 8 }, { id: B, index: 12 }]))!
    const low = vm.players.find((p) => p.playerId === A)!
    const high = vm.players.find((p) => p.playerId === B)!

    expect(low.worksheet!.ownStrokes).toBe(8)
    expect(low.worksheet!.fieldLowest).toBe(8)
    expect(low.worksheet!.strokesReceivedFinal).toBe(0)
    expect(low.holeResults.every((h) => h.strokesReceived === 0)).toBe(true)

    expect(high.worksheet!.ownStrokes).toBe(12)
    expect(high.worksheet!.strokesReceivedFinal).toBe(4) // 12 − 8
    // Strokes fall on the four hardest holes (stroke index 1..4) and nowhere else.
    for (const h of high.holeResults) {
      expect(h.strokesReceived).toBe(h.holeNumber <= 4 ? 1 : 0)
    }
  })

  it('a DNP player does not set the floor and takes no strokes', () => {
    // C is a 5 but sat out; the low among PLAYING players (8, 12) is still 8.
    const vm = buildRoundDetail(1, makeDb([
      { id: A, index: 8 },
      { id: B, index: 12 },
      { id: C, index: 5, status: 'did_not_play' },
    ]))!
    expect(vm.players.find((p) => p.playerId === A)!.worksheet!.fieldLowest).toBe(8)
    expect(vm.players.find((p) => p.playerId === B)!.worksheet!.strokesReceivedFinal).toBe(4)
    const dnp = vm.players.find((p) => p.playerId === C)!
    expect(dnp.status).toBe('did_not_play')
    expect(dnp.holeResults).toHaveLength(0)
  })
})
