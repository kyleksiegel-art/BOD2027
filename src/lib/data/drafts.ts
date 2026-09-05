// Persistence for the Enter screen's unsaved holes (CLAUDE.md §"Nothing auto-saves").
//
// The screen still owns the in-memory value — a ref, so two taps in one frame both land —
// and writes through here after every tap. On mount, and whenever the round changes, it
// reloads from Dexie, so an iOS eviction between hole 12 and hole 13 costs nothing. A row
// is removed the moment the hole has no edits left, which is also what happens on Save.
import { db } from '@/lib/db'
import type { EnterDraftRow } from './types'

export async function loadEnterDrafts(roundId: string): Promise<EnterDraftRow[]> {
  return db.enter_drafts.where('round_id').equals(roundId).toArray()
}

/** True when the row carries nothing worth keeping. */
export function isEmptyDraft(row: EnterDraftRow): boolean {
  return Object.keys(row.players).length === 0 && !row.ctp_touched
}

/** Write the hole's current unsaved state, or delete the row if there is none left. */
export async function putEnterDraft(row: EnterDraftRow): Promise<void> {
  if (isEmptyDraft(row)) {
    await db.enter_drafts.delete([row.round_id, row.hole_number])
  } else {
    await db.enter_drafts.put(row)
  }
}

export async function clearEnterDraft(roundId: string, holeNumber: number): Promise<void> {
  await db.enter_drafts.delete([roundId, holeNumber])
}
