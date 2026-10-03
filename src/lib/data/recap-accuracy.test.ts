import { describe, it, expect } from 'vitest'
import { buildRoundRecap, type Db } from './compute'
import { buildRoundReport } from './report'
import { buildFieldReport, scoreVerb } from './wire'
import type { PlayerRow, CourseRow, TeeRow, HoleRow, RoundRow, RoundPlayerRow, ScoreRow } from './types'

// Recap accuracy (2026-10-02):
//   - "Scores in" is not "final": until the round is finalized the recap and report say
//     "tops", not "takes", and make no unconditional payout claim.
//   - The Field Report says "net" in the sentence for a net result, and keeps plain golf verbs
//     for what the gross score actually was.
//
// Two scratch players on an all-par-4 course (net == gross). Kyle birdies the 2nd (37 pts);
// Jon bogeys the 18th (35 pts). Kyle by 2.

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
    scores: [...scores(A, { 18: 1 }), ...scores(B, { 2: -1 })],
    ctp_results: [],
    settings: [{ key: 'purse_amounts', value: { round_winner_cents: 5000 } } as never],
  }
}

const text = (segs: { text: string }[]) => segs.map((s) => s.text).join('')

describe('scores in vs final', () => {
  it('a finalized round is won, first names only', () => {
    const recap = buildRoundRecap(1, makeDb('final'))!
    expect(recap.pending).toBe(false)
    expect(text(recap.headline)).toBe('Kyle takes the Red.')
    expect(recap.narrative).toBe('Kyle takes the Red by 2 with 37 pts.')

    const report = buildRoundReport(1, makeDb('final'))!
    expect(report.pending).toBe(false)
    expect(report.headline).toBe('Kyle holds off Jon by 2.')
    expect(text(report.paragraphs[0])).toBe('Kyle took the lead for good on the 2nd with a birdie, finishing 2 clear of Jon.')
    expect(report.paragraphs.map(text).join(' ')).not.toMatch(/Siegel|Aronson/)
  })

  it('all scores in but not finalized: the story reads the same, only the status is pending', () => {
    // Kyle 2026-10-02: "top" instead of "wins" was weird. The result is the result once every
    // score is in; the badge/footer say awaiting sign-off and the payout waits for it.
    const recap = buildRoundRecap(1, makeDb('in_progress'))!
    expect(recap.act).toBe('final')
    expect(recap.pending).toBe(true)
    expect(recap.live).toBe(false)
    expect(text(recap.headline)).toBe('Kyle takes the Red.')
    expect(recap.narrative).toBe('Kyle takes the Red by 2 with 37 pts.')

    const report = buildRoundReport(1, makeDb('in_progress'))!
    expect(report.pending).toBe(true)
    expect(report.headline).toBe('Kyle holds off Jon by 2.')
  })

  it('no em dashes in generated recap or report copy', () => {
    for (const status of ['final', 'in_progress'] as const) {
      const recap = buildRoundRecap(1, makeDb(status))!
      const report = buildRoundReport(1, makeDb(status))!
      const all = [text(recap.headline), recap.narrative, recap.dispatch, report.headline, ...report.paragraphs.map(text)]
      for (const line of all) expect(line).not.toContain('—')
    }
  })
})

describe('Field Report verbs: net in the sentence', () => {
  it('uses plain golf verbs only for what the gross score was', () => {
    // No stroke on the hole: gross is net, so the plain verb is exact.
    expect(scoreVerb(3, false, '7th', -1, false)).toBe('birdies the 7th')
    expect(scoreVerb(2, false, '7th', 0, false)).toBe('pars the 7th')
    expect(scoreVerb(1, false, '7th', 1, false)).toBe('bogeys the 7th')
    // A stroke turned a gross par into a net birdie: say "net" in the sentence.
    expect(scoreVerb(3, false, '7th', 0, true)).toBe('makes a net birdie on the 7th')
    expect(scoreVerb(4, false, '7th', 0, true)).toBe('makes a net eagle on the 7th')
    expect(scoreVerb(2, false, '7th', 1, true)).toBe('makes a net par on the 7th')
    // A real gross birdie with a stroke on top: both, gross first.
    expect(scoreVerb(4, false, '7th', -1, true)).toBe('birdies the 7th for a net eagle')
    expect(scoreVerb(4, false, '7th', -2, false)).toBe('eagles the 7th')
    // Zeros and pickups never claim a gross score.
    expect(scoreVerb(0, false, '7th', 2, false)).toBe('blanks the 7th')
    expect(scoreVerb(0, true, '7th', null, false)).toBe('picks up on the 7th')
  })

  it('the wire reads a scratch birdie as a birdie, and an all-par hole as the field parring', () => {
    const vm = buildFieldReport(makeDb('in_progress'))!
    const lines = vm.holes.flatMap((h) => h.events.map((e) => text(e.segs)))
    expect(lines.some((l) => l.startsWith('Kyle birdies the 2nd.'))).toBe(true)
    expect(lines).toContain('Field pars the 3rd. No movement.')
    for (const l of lines) expect(l).not.toContain('—')
  })
})
