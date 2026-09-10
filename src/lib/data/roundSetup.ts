// The Rounds editor's "Save tees" payload, as a pure function so it can be tested without
// React. The rule it encodes came out of the 2026-09-09 audit: saving tees must change tees
// and nothing else. Before this, the editor sent `status: 'playing'` and `manual_override:
// null` for every participant, so a player marked did-not-play was silently put back in the
// field by any tee save — and nothing in the UI could mark a DNP in the first place.
import type { RoundPlayerRow } from './types'
import type { RoundPlayerInput } from './admin'

export type RpStatus = RoundPlayerRow['status']

export interface RoundSetupParticipant {
  playerId: string
  /** The saved row, if any — the source of the status/override we must not lose. */
  row: RoundPlayerRow | null
}

export function roundPlayerEntries(args: {
  roundId: string
  participants: RoundSetupParticipant[]
  /** playerId -> chosen tee id */
  teeById: Record<string, string>
  /** playerId -> chosen status; a missing key keeps the saved status (default playing). */
  statusById: Record<string, RpStatus>
  /** playerId -> the player's live trip index. */
  indexById: Map<string, number>
  allowance: number
  cap: number
}): RoundPlayerInput[] {
  return args.participants.map((p) => ({
    roundId: args.roundId,
    playerId: p.playerId,
    teeId: args.teeById[p.playerId],
    indexUsed: args.indexById.get(p.playerId) ?? 0,
    allowanceUsed: args.allowance,
    capUsed: args.cap,
    status: args.statusById[p.playerId] ?? p.row?.status ?? 'playing',
    // Preserved, never reset: a tee change is not a reason to forget an agreed override.
    manualOverride: p.row?.manual_override ?? null,
  }))
}
