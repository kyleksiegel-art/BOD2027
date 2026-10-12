import { db } from '@/lib/db'

/**
 * The radio call's memory on this phone (Kyle 2026-10-11), kept in `sync_meta` like the last
 * crash — local-only, never a server mirror, no schema change:
 *
 *  - `radio_calls`  — the last CALL_LOG_MAX calls played, word for word, so Admin can replay one.
 *  - `radio_recent` — the line templates used lately, so the next call avoids them (see
 *                     radioCall.ts `signature`). Capped; the oldest fall off and come back.
 *
 * Never throws: a phone that can't write here just loses its replay list, not the call.
 */

export const CALL_LOG_KEY = 'radio_calls'
export const RECENT_KEY = 'radio_recent'
export const CALL_LOG_MAX = 20
export const RECENT_MAX = 160

export interface LoggedCall {
  at: string // ISO, when it played
  label: string // "Round 2 · live, through 12"
  lines: string[]
}

export async function readCallLog(): Promise<LoggedCall[]> {
  try {
    const row = await db.sync_meta.get(CALL_LOG_KEY)
    return Array.isArray(row?.value) ? (row!.value as LoggedCall[]) : []
  } catch {
    return []
  }
}

export async function readRecentSignatures(): Promise<string[]> {
  try {
    const row = await db.sync_meta.get(RECENT_KEY)
    return Array.isArray(row?.value) ? (row!.value as string[]) : []
  } catch {
    return []
  }
}

/** Record a call that just played: newest first in the log, its templates onto the recent list. */
export async function logCall(call: LoggedCall, used: string[]): Promise<void> {
  try {
    const [log, recent] = await Promise.all([readCallLog(), readRecentSignatures()])
    const nextRecent = [...used, ...recent.filter((s) => !used.includes(s))].slice(0, RECENT_MAX)
    await db.sync_meta.bulkPut([
      { key: CALL_LOG_KEY, value: [call, ...log].slice(0, CALL_LOG_MAX) },
      { key: RECENT_KEY, value: nextRecent },
    ])
  } catch {
    // Best effort: the call already played.
  }
}
