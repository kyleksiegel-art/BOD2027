// COMPARATOR SITE 2 — the Realtime handler.
//
// Six tables are published (CLAUDE.md §Schema shape). Two of them, `scores` and
// `ctp_results`, carry the comparator columns and are contended: four phones may write the
// same cell. A remote event for those NEVER lands as a blind put. It must beat the local
// row, and it must beat anything this device still owes the server for that cell. Without
// the first check an older remote value clobbers a newer local one on screen; without the
// second, a routine broadcast undoes an entry made thirty seconds ago in a dead zone.
//
// The other four are uncontended — nothing on a phone writes them — so the server is
// unconditionally right and a put is correct.
//
// The token is deliberately NOT handed to Realtime: `supabase.realtime.setAuth()` expects a
// JWT and ours is an opaque 128-bit string. The connection stays on the anon key, which is
// all a public read channel needs.
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { queryClient } from '@/lib/data/queryClient'
import { incomingWins, stampOf } from './comparator'
import { clearEchoed, ctpKey, flushOutbox, pendingStamps, rpKey, scoreKey, shieldAllows } from './outbox'
import type { CtpResultRow, RoundPlayerRow, ScoreRow } from '@/lib/data/types'

// Supabase types a change payload over `Record<string, unknown>`; our row interfaces have
// no index signature, so they are widened here rather than polluted with one.
type Change<T> = RealtimePostgresChangesPayload<T & Record<string, unknown>>

/** Apply one `scores` event. Exported so the tests can drive it without a socket. */
export async function applyScoreEvent(payload: Change<ScoreRow>): Promise<void> {
  if (payload.eventType === 'DELETE') {
    // Nothing in this app deletes a score — a correction sets gross_strokes null — but a
    // dashboard edit emits one, and a row left behind locally would be a ghost.
    const old = payload.old as Partial<ScoreRow>
    if (old.round_id && old.player_id && old.hole_number !== undefined) {
      await db.scores.delete([old.round_id, old.player_id, old.hole_number])
    }
    return
  }

  const row = payload.new as ScoreRow
  const key = scoreKey(row.round_id, row.player_id, row.hole_number)
  await clearEchoed(key, stampOf(row))

  const pending = await pendingStamps()
  const local = await db.scores.get([row.round_id, row.player_id, row.hole_number])
  if (!incomingWins(row, local)) return
  if (!shieldAllows(key, stampOf(row), pending)) return
  await db.scores.put(row)
}

/** Apply one `ctp_results` event. Same three checks, different key. */
export async function applyCtpEvent(payload: Change<CtpResultRow>): Promise<void> {
  if (payload.eventType === 'DELETE') {
    const old = payload.old as Partial<CtpResultRow>
    if (old.round_id && old.hole_number !== undefined) {
      await db.ctp_results.delete([old.round_id, old.hole_number])
    }
    return
  }

  const row = payload.new as CtpResultRow
  const key = ctpKey(row.round_id, row.hole_number)
  await clearEchoed(key, stampOf(row))

  const pending = await pendingStamps()
  const local = await db.ctp_results.get([row.round_id, row.hole_number])
  if (!incomingWins(row, local)) return
  if (!shieldAllows(key, stampOf(row), pending)) return
  await db.ctp_results.put(row)
}

/**
 * Apply one `round_players` event. Contended now that day-of tee changes are queued: a
 * remote tee change must clear this device's matching pending entry (self-echo) and beat
 * both the local row and anything still owed for that (round, player). Points re-derive
 * automatically — compute.ts reads round_players from Dexie through useLiveQuery.
 */
export async function applyRoundPlayerEvent(payload: Change<RoundPlayerRow>): Promise<void> {
  if (payload.eventType === 'DELETE') {
    const old = payload.old as Partial<RoundPlayerRow>
    if (old.round_id && old.player_id) {
      await db.round_players.delete([old.round_id, old.player_id])
    }
    return
  }

  const row = payload.new as RoundPlayerRow
  const key = rpKey(row.round_id, row.player_id)
  await clearEchoed(key, stampOf(row))

  const pending = await pendingStamps()
  const local = await db.round_players.get([row.round_id, row.player_id])
  if (!incomingWins(row, local)) return
  if (!shieldAllows(key, stampOf(row), pending)) return
  await db.round_players.put(row)
}

let channel: RealtimeChannel | null = null

/**
 * Subscribe to the six published tables. Idempotent — calling twice keeps one channel.
 *
 * A (re)subscription is also a reconnect signal: flush what we owe, then refetch, in that
 * order. Any event we missed while the socket was down is in the refetch.
 */
export function startRealtime(): () => void {
  if (channel) return stopRealtime

  const ch = supabase.channel('bod2027-sync')

  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, (p) => {
    void applyScoreEvent(p as Change<ScoreRow>)
  })
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'ctp_results' }, (p) => {
    void applyCtpEvent(p as Change<CtpResultRow>)
  })
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'round_players' }, (p) => {
    void applyRoundPlayerEvent(p as Change<RoundPlayerRow>)
  })

  // Uncontended tables. A change to any of them can move the points table or a round's
  // status, so the whole read model is refetched rather than patched by hand — the same one
  // network→Dexie path the admin write path uses.
  for (const table of ['rounds', 'settings', 'players'] as const) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      void queryClient.invalidateQueries({ queryKey: ['hydrate'] })
    })
  }

  ch.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return
    void flushOutbox().then(() => queryClient.invalidateQueries({ queryKey: ['hydrate'] }))
  })

  channel = ch
  return stopRealtime
}

export function stopRealtime(): void {
  if (!channel) return
  void supabase.removeChannel(channel)
  channel = null
}
