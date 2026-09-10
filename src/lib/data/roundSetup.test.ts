import { describe, it, expect } from 'vitest'
import { roundPlayerEntries } from './roundSetup'
import type { RoundPlayerRow } from './types'

// Regression for audit finding F-001: "Save tees" flipped a did-not-play player back to
// playing and wiped a manual override, because the editor hard-coded both.

const ROUND = 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr'
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function row(playerId: string, status: RoundPlayerRow['status'], override: number | null = null): RoundPlayerRow {
  return {
    round_id: ROUND, player_id: playerId, tee_id: 'tee-old', index_used: 10, allowance_used: 1, cap_used: 18,
    course_handicap: 10, playing_handicap: 10, cap_applied: false, strokes_received: 10,
    manual_override: override, status,
  }
}

describe('roundPlayerEntries', () => {
  it('keeps a saved did-not-play status and manual override when only tees are touched', () => {
    const out = roundPlayerEntries({
      roundId: ROUND,
      participants: [
        { playerId: A, row: row(A, 'playing') },
        { playerId: B, row: row(B, 'did_not_play', 12) },
      ],
      teeById: { [A]: 'tee-new', [B]: 'tee-new' },
      statusById: {},
      indexById: new Map([[A, 9.2], [B, 16.8]]),
      allowance: 1,
      cap: 18,
    })
    expect(out.map((e) => e.status)).toEqual(['playing', 'did_not_play'])
    expect(out[1].manualOverride).toBe(12)
    expect(out[0].manualOverride).toBeNull()
    expect(out.map((e) => e.teeId)).toEqual(['tee-new', 'tee-new'])
    expect(out[1].indexUsed).toBe(16.8)
  })

  it('applies an explicit status choice and defaults a brand-new row to playing', () => {
    const out = roundPlayerEntries({
      roundId: ROUND,
      participants: [
        { playerId: A, row: row(A, 'playing') },
        { playerId: B, row: null },
      ],
      teeById: { [A]: 't', [B]: 't' },
      statusById: { [A]: 'did_not_play' },
      indexById: new Map([[A, 9.2]]),
      allowance: 1,
      cap: 18,
    })
    expect(out[0].status).toBe('did_not_play')
    expect(out[1].status).toBe('playing')
    expect(out[1].indexUsed).toBe(0)
  })
})
