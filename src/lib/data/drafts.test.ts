import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { loadEnterDrafts, putEnterDraft, clearEnterDraft, isEmptyDraft } from './drafts'

const R1 = 'r0000000-0000-0000-0000-000000000001'
const R2 = 'r0000000-0000-0000-0000-000000000002'
const KYLE = 'p0000000-0000-0000-0000-00000000kyle'
const JON = 'p0000000-0000-0000-0000-000000000jon'

beforeEach(async () => {
  await db.enter_drafts.clear()
})

describe('enter drafts persistence', () => {
  it('survives the database being closed and reopened — the force-quit case', async () => {
    await putEnterDraft({
      round_id: R1,
      hole_number: 13,
      players: { [KYLE]: { grossStrokes: 5, pickedUp: false }, [JON]: { grossStrokes: null, pickedUp: true } },
      ctp_touched: false,
      ctp_winner: null,
    })
    db.close()
    await db.open()
    const rows = await loadEnterDrafts(R1)
    expect(rows).toHaveLength(1)
    expect(rows[0].hole_number).toBe(13)
    expect(rows[0].players[KYLE]).toEqual({ grossStrokes: 5, pickedUp: false })
    expect(rows[0].players[JON]).toEqual({ grossStrokes: null, pickedUp: true })
  })

  it('loads only the requested round', async () => {
    await putEnterDraft({ round_id: R1, hole_number: 3, players: { [KYLE]: { grossStrokes: 4, pickedUp: false } }, ctp_touched: false, ctp_winner: null })
    await putEnterDraft({ round_id: R2, hole_number: 3, players: { [KYLE]: { grossStrokes: 6, pickedUp: false } }, ctp_touched: false, ctp_winner: null })
    const r1 = await loadEnterDrafts(R1)
    expect(r1).toHaveLength(1)
    expect(r1[0].players[KYLE].grossStrokes).toBe(4)
  })

  it('a put with nothing left in it removes the row (what Save does)', async () => {
    await putEnterDraft({ round_id: R1, hole_number: 7, players: { [KYLE]: { grossStrokes: 4, pickedUp: false } }, ctp_touched: true, ctp_winner: JON })
    // Scores saved, CTP still unsaved: the row stays, holding only the pick.
    await putEnterDraft({ round_id: R1, hole_number: 7, players: {}, ctp_touched: true, ctp_winner: JON })
    let rows = await loadEnterDrafts(R1)
    expect(rows).toHaveLength(1)
    expect(rows[0].ctp_winner).toBe(JON)
    // CTP saved too: nothing left, row gone.
    await putEnterDraft({ round_id: R1, hole_number: 7, players: {}, ctp_touched: false, ctp_winner: null })
    rows = await loadEnterDrafts(R1)
    expect(rows).toHaveLength(0)
  })

  it('keeps an explicit "no winner" CTP pick distinct from an untouched one', async () => {
    await putEnterDraft({ round_id: R1, hole_number: 5, players: {}, ctp_touched: true, ctp_winner: null })
    const rows = await loadEnterDrafts(R1)
    expect(rows).toHaveLength(1)
    expect(rows[0].ctp_touched).toBe(true)
    expect(rows[0].ctp_winner).toBeNull()
    expect(isEmptyDraft(rows[0])).toBe(false)
  })

  it('clearEnterDraft drops one hole and leaves the others', async () => {
    await putEnterDraft({ round_id: R1, hole_number: 1, players: { [KYLE]: { grossStrokes: 4, pickedUp: false } }, ctp_touched: false, ctp_winner: null })
    await putEnterDraft({ round_id: R1, hole_number: 2, players: { [KYLE]: { grossStrokes: 4, pickedUp: false } }, ctp_touched: false, ctp_winner: null })
    await clearEnterDraft(R1, 1)
    const rows = await loadEnterDrafts(R1)
    expect(rows.map((r) => r.hole_number)).toEqual([2])
  })
})
