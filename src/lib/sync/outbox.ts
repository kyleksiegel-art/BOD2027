// The durable write queue.
//
// Every scoring mutation is (1) written into Dexie immediately so the UI reflects it, and
// (2) appended here, in ONE transaction. Only then does anything try the network. The
// outbox is the only copy of a round played in a dead zone, so nothing is ever deleted
// from it except on a server acknowledgement or an atomic transfer to `dead_letter`.
//
// Flush shape (docs/spec/decisions.md §"Outbox flush order"):
//   · group by key, send only the LATEST entry per key, drop the superseded ones —
//     safe because payloads are whole-tuple state, never deltas
//   · batch each kind into one RPC call per chunk, up to 4 chunks in parallel
//   · order per key, not globally: hole 7 must not wait behind hole 3
//
// Failure handling is the part that matters at 5pm on the 14th at Black:
//   · a NETWORK failure is not an error — it does not count an attempt, it stops the
//     flush, and everything stays queued. Otherwise four hours offline would burn the
//     retry budget and dead-letter a whole round that was never actually refused.
//   · a TERMINAL refusal (the RPC's own validation vocabulary) goes straight to
//     dead_letter with its payload intact, and the queue continues.
//   · anything else is retryable: count an attempt, dead-letter after MAX_ATTEMPTS.
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { clientId } from '@/lib/clientId'
import { nextStamp } from './clock'
import { incomingWins, compareStamps, stampOf, type Stamp } from './comparator'
import type {
  CtpPayload,
  CtpResultRow,
  DeadLetterEntry,
  OutboxEntry,
  OutboxKind,
  ScorePayload,
  ScoreRow,
} from '@/lib/data/types'

export const MAX_ATTEMPTS = 8
/** Cells per RPC call. A four-player hole is 4; a whole round of catch-up is 72. */
const CHUNK = 36
/** Chunks in flight at once. */
const CONCURRENCY = 4

const LAST_SYNC_KEY = 'sync.last_success_at'

/** The RPC's own refusal vocabulary. These are verdicts, not outages — never retried. */
const TERMINAL_ERRORS = new Set([
  'missing_required_field',
  'round_not_found',
  'round_upcoming',
  'course_data_is_placeholder',
  'no_round_player_row',
  'player_not_playing',
  'hole_not_on_course',
  'hole_is_not_a_par_3',
  'gross_strokes_out_of_range',
  'picked_up_requires_null_gross',
  'distance_negative',
])

// ── Keys ─────────────────────────────────────────────────────────────────────
// The canonical key is the Postgres unique key, rendered as a string. It is what the
// pending-write shield indexes and what groups a flush.

export function scoreKey(roundId: string, playerId: string, holeNumber: number): string {
  return `score|${roundId}|${playerId}|${holeNumber}`
}

export function ctpKey(roundId: string, holeNumber: number): string {
  return `ctp|${roundId}|${holeNumber}`
}

// ── Transport ────────────────────────────────────────────────────────────────

export interface RpcResult {
  key: Record<string, unknown>
  applied: boolean
  error: string | null
  row: (ScoreRow & CtpResultRow) | ScoreRow | CtpResultRow | null
}

/** Thrown when the request never reached the server. Costs no attempt. */
export class OfflineError extends Error {
  constructor(message = 'offline') {
    super(message)
    this.name = 'OfflineError'
  }
}

/** Thrown when the server answered, badly. Costs an attempt. */
export class TransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransportError'
  }
}

export interface Transport {
  call(fn: 'rpc_upsert_scores' | 'rpc_upsert_ctp', args: Record<string, unknown>): Promise<RpcResult[]>
}

function looksOffline(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('load failed') ||
    m.includes('fetch failed') ||
    m.includes('timeout') ||
    m.includes('aborted')
  )
}

export const supabaseTransport: Transport = {
  async call(fn, args) {
    let data: unknown
    try {
      const res = await supabase.rpc(fn, args)
      if (res.error) {
        // supabase-js catches fetch failures and hands them back as an error object rather
        // than throwing, so the offline case has to be recognised from here too.
        throw looksOffline(res.error.message)
          ? new OfflineError(res.error.message)
          : new TransportError(res.error.message)
      }
      data = res.data
    } catch (e) {
      if (e instanceof OfflineError || e instanceof TransportError) throw e
      const message = e instanceof Error ? e.message : String(e)
      throw looksOffline(message) ? new OfflineError(message) : new TransportError(message)
    }
    return (data ?? []) as RpcResult[]
  },
}

let transport: Transport = supabaseTransport

/** Test seam — swap the network for a stub. */
export function setTransport(next: Transport): void {
  transport = next
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Write cells to Dexie and to the outbox in one transaction, then hand back the entries.
 * The local row is written with `effective = raw`: the client cannot know the server's
 * 5-minute clamp, and guessing would be worse than being provisionally optimistic — the
 * server's own row replaces it on acknowledgement.
 */
export async function enqueueScores(cells: ScorePayload[]): Promise<OutboxEntry[]> {
  if (cells.length === 0) return []
  const ts = await nextStamp()
  const cid = clientId()
  const entries: OutboxEntry[] = cells.map((payload) => ({
    id: crypto.randomUUID(),
    kind: 'score' as const,
    key: scoreKey(payload.round_id, payload.player_id, payload.hole_number),
    payload,
    ts,
    client_id: cid,
    attempts: 0,
    last_error: null,
    created_at: new Date().toISOString(),
  }))

  await db.transaction('rw', [db.scores, db.outbox], async () => {
    for (const entry of entries) {
      const p = entry.payload as ScorePayload
      const existing = await db.scores.get([p.round_id, p.player_id, p.hole_number])
      await db.scores.put({
        // Keep the server id if we have one; invent a local one if this cell is new. The
        // primary key is (round, player, hole), so a provisional id never forks the row.
        id: existing?.id ?? crypto.randomUUID(),
        ...p,
        client_updated_at_raw: ts,
        client_updated_at_effective: ts,
        client_id: cid,
      })
    }
    await db.outbox.bulkAdd(entries)
  })
  return entries
}

export async function enqueueCtp(results: CtpPayload[]): Promise<OutboxEntry[]> {
  if (results.length === 0) return []
  const ts = await nextStamp()
  const cid = clientId()
  const entries: OutboxEntry[] = results.map((payload) => ({
    id: crypto.randomUUID(),
    kind: 'ctp' as const,
    key: ctpKey(payload.round_id, payload.hole_number),
    payload,
    ts,
    client_id: cid,
    attempts: 0,
    last_error: null,
    created_at: new Date().toISOString(),
  }))

  await db.transaction('rw', [db.ctp_results, db.outbox], async () => {
    for (const entry of entries) {
      const p = entry.payload as CtpPayload
      const existing = await db.ctp_results.get([p.round_id, p.hole_number])
      await db.ctp_results.put({
        id: existing?.id ?? crypto.randomUUID(),
        ...p,
        client_updated_at_raw: ts,
        client_updated_at_effective: ts,
        client_id: cid,
      })
    }
    await db.outbox.bulkAdd(entries)
  })
  return entries
}

// ── The pending-write shield (comparator site 4) ─────────────────────────────

/** The newest pending stamp per key. One Dexie read serves a whole batch of decisions. */
export async function pendingStamps(): Promise<Map<string, Stamp>> {
  const map = new Map<string, Stamp>()
  await db.outbox.each((e) => {
    const stamp: Stamp = { effective: e.ts, clientId: e.client_id }
    const seen = map.get(e.key)
    if (!seen || compareStamps(stamp, seen) > 0) map.set(e.key, stamp)
  })
  return map
}

/**
 * May an incoming remote row overwrite the local one for `key`?
 *
 * Only if it beats the newest thing this device still owes the server for that cell. A
 * remote event that loses here is not discarded information — our pending write is newer
 * and will overwrite it server-side on the next flush.
 */
export function shieldAllows(
  key: string,
  incoming: Stamp | null,
  pending: Map<string, Stamp>,
): boolean {
  const held = pending.get(key)
  if (!held) return true
  return incomingWins(incoming, held)
}

// ── Flush ────────────────────────────────────────────────────────────────────

export interface FlushReport {
  status: 'idle' | 'offline' | 'error'
  /** Entries the server acknowledged (applied OR rejected as stale — both are settled). */
  sent: number
  /** Entries moved to dead_letter this pass. */
  deadLettered: number
  /** Entries still queued when the flush returned. */
  remaining: number
  message: string | null
}

let inFlight: Promise<FlushReport> | null = null

/**
 * Drain the outbox. Safe to call from anywhere at any time: concurrent callers share the
 * one in-flight pass rather than double-sending.
 */
export function flushOutbox(): Promise<FlushReport> {
  if (inFlight) return inFlight
  inFlight = drain().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function drain(): Promise<FlushReport> {
  const all = await db.outbox.orderBy('seq').toArray()
  if (all.length === 0) {
    return { status: 'idle', sent: 0, deadLettered: 0, remaining: 0, message: null }
  }

  // Coalesce: latest per key wins, the rest are superseded and dropped. Whole-tuple
  // payloads make this safe — the winner already contains everything the losers said.
  const winners = new Map<string, OutboxEntry>()
  const superseded: number[] = []
  for (const entry of all) {
    const held = winners.get(entry.key)
    if (!held) {
      winners.set(entry.key, entry)
      continue
    }
    const cmp = compareStamps(
      { effective: entry.ts, clientId: entry.client_id },
      { effective: held.ts, clientId: held.client_id },
    )
    // Same stamp (same save batch, same key) — the later sequence number is the later tap.
    const newer = cmp > 0 || (cmp === 0 && (entry.seq ?? 0) > (held.seq ?? 0))
    if (newer) {
      superseded.push(held.seq!)
      winners.set(entry.key, entry)
    } else {
      superseded.push(entry.seq!)
    }
  }
  if (superseded.length > 0) await db.outbox.bulkDelete(superseded)

  const byKind = new Map<OutboxKind, OutboxEntry[]>()
  for (const e of winners.values()) {
    const list = byKind.get(e.kind) ?? []
    list.push(e)
    byKind.set(e.kind, list)
  }

  const batches: { kind: OutboxKind; entries: OutboxEntry[] }[] = []
  for (const [kind, entries] of byKind) {
    for (let i = 0; i < entries.length; i += CHUNK) {
      batches.push({ kind, entries: entries.slice(i, i + CHUNK) })
    }
  }

  let sent = 0
  let deadLettered = 0
  let offline = false
  let message: string | null = null

  // Concurrency cap: a shared cursor over the batch list, CONCURRENCY workers.
  let cursor = 0
  async function worker(): Promise<void> {
    for (;;) {
      if (offline) return
      const i = cursor++
      if (i >= batches.length) return
      const batch = batches[i]
      try {
        const results = await transport.call(rpcFor(batch.kind), argsFor(batch))
        const outcome = await settle(batch.entries, results)
        sent += outcome.sent
        deadLettered += outcome.deadLettered
        if (outcome.error !== null) message ??= outcome.error
      } catch (e) {
        if (e instanceof OfflineError) {
          // Not a failure of these entries — the request never landed. Stop the pass and
          // leave every attempt count untouched.
          offline = true
          message = e.message
          return
        }
        message = e instanceof Error ? e.message : String(e)
        deadLettered += await penalise(batch.entries, message, 'exhausted')
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker))

  if (sent > 0) await db.sync_meta.put({ key: LAST_SYNC_KEY, value: new Date().toISOString() })

  const remaining = await db.outbox.count()
  return {
    status: offline ? 'offline' : message !== null ? 'error' : 'idle',
    sent,
    deadLettered,
    remaining,
    message,
  }
}

function rpcFor(kind: OutboxKind): 'rpc_upsert_scores' | 'rpc_upsert_ctp' {
  return kind === 'score' ? 'rpc_upsert_scores' : 'rpc_upsert_ctp'
}

function argsFor(batch: { kind: OutboxKind; entries: OutboxEntry[] }): Record<string, unknown> {
  const wire = batch.entries.map((e) => ({
    ...e.payload,
    client_updated_at_raw: e.ts,
    client_id: e.client_id,
  }))
  return batch.kind === 'score' ? { cells: wire } : { results: wire }
}

/** Rebuild the canonical key from the key the RPC echoed back, so results match entries. */
function keyOfResult(kind: OutboxKind, key: Record<string, unknown>): string {
  return kind === 'score'
    ? scoreKey(String(key.round_id), String(key.player_id), Number(key.hole_number))
    : ctpKey(String(key.round_id), Number(key.hole_number))
}

interface Settlement {
  sent: number
  deadLettered: number
  /** The first refusal in this batch, so the UI can say what the server actually said. */
  error: string | null
}

/** Apply one batch's results: acknowledge, dead-letter, or count an attempt. */
async function settle(entries: OutboxEntry[], results: RpcResult[]): Promise<Settlement> {
  const byKey = new Map(entries.map((e) => [e.key, e]))
  const settled: number[] = []
  const rows: { kind: OutboxKind; row: ScoreRow | CtpResultRow }[] = []
  const dead: { entry: OutboxEntry; error: string; reason: DeadLetterEntry['reason'] }[] = []
  const retry: { entry: OutboxEntry; error: string }[] = []

  for (const result of results) {
    const entry = byKey.get(keyOfResult(entries[0].kind, result.key))
    if (!entry) continue
    byKey.delete(entry.key)

    if (result.error === null || result.error === 'stale') {
      // "stale" is a settled outcome, not a failure: the server's row is newer and is the
      // one we should be showing. The returned winner is the rollback.
      settled.push(entry.seq!)
      if (result.row) rows.push({ kind: entry.kind, row: result.row })
    } else if (TERMINAL_ERRORS.has(result.error)) {
      dead.push({ entry, error: result.error, reason: 'terminal' })
    } else {
      retry.push({ entry, error: result.error })
    }
  }

  // Anything the server never mentioned: treat as retryable rather than assume success.
  for (const entry of byKey.values()) retry.push({ entry, error: 'no_result_returned' })

  let deadLettered = dead.length
  await db.transaction(
    'rw',
    [db.outbox, db.dead_letter, db.scores, db.ctp_results],
    async () => {
      if (settled.length > 0) await db.outbox.bulkDelete(settled)
      for (const { entry, error, reason } of dead) await transferToDeadLetter(entry, error, reason)
      for (const { entry, error } of retry) {
        const attempts = entry.attempts + 1
        if (attempts >= MAX_ATTEMPTS) {
          await transferToDeadLetter({ ...entry, attempts }, error, 'exhausted')
          deadLettered += 1
        } else {
          await db.outbox.update(entry.seq!, { attempts, last_error: error })
        }
      }
      await applyServerRows(rows)
    },
  )

  return { sent: settled.length, deadLettered, error: dead[0]?.error ?? retry[0]?.error ?? null }
}

/** A whole batch failed against a server that did answer. Count one attempt each. */
async function penalise(
  entries: OutboxEntry[],
  error: string,
  reason: DeadLetterEntry['reason'],
): Promise<number> {
  let moved = 0
  await db.transaction('rw', [db.outbox, db.dead_letter], async () => {
    for (const entry of entries) {
      const attempts = entry.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await transferToDeadLetter({ ...entry, attempts }, error, reason)
        moved += 1
      } else {
        await db.outbox.update(entry.seq!, { attempts, last_error: error })
      }
    }
  })
  return moved
}

/**
 * Atomic transfer, never a delete. The item keeps its id, payload, timestamps and attempt
 * count so Diagnostics can retry or export it — the brief's "never permanently delete an
 * unsynced mutation."
 */
async function transferToDeadLetter(
  entry: OutboxEntry,
  error: string,
  reason: DeadLetterEntry['reason'],
): Promise<void> {
  const { seq, ...rest } = entry
  await db.dead_letter.put({
    ...rest,
    seq,
    last_error: error,
    failed_at: new Date().toISOString(),
    reason,
  })
  if (seq !== undefined) await db.outbox.delete(seq)
}

/**
 * Write server-acknowledged rows into Dexie. Three cases, and the middle one is subtle.
 *
 * 1. The shield, as everywhere else: a NEWER local write queued while this request was in
 *    flight is what the screen should show, and the server will agree on the next flush.
 * 2. Our own optimistic row — same client_id, same raw stamp — is REPLACED unconditionally,
 *    even though its local `effective` may compare higher. That is the whole point: the
 *    client cannot compute the server's 5-minute clamp, so its optimistic `effective` is a
 *    guess, and this is where the guess is corrected. Left uncorrected on a badly skewed
 *    clock, that row would out-rank every later write from every other phone forever.
 * 3. Anything else goes through the comparator. A Realtime event from another device can
 *    land between the request leaving and the response arriving; the response is then a
 *    snapshot of an older moment and must not win on recency alone.
 */
async function applyServerRows(rows: { kind: OutboxKind; row: ScoreRow | CtpResultRow }[]): Promise<void> {
  if (rows.length === 0) return
  const pending = await pendingStamps()
  for (const { kind, row } of rows) {
    if (kind === 'score') {
      const r = row as ScoreRow
      const key = scoreKey(r.round_id, r.player_id, r.hole_number)
      if (!shieldAllows(key, stampOf(r), pending)) continue
      const local = await db.scores.get([r.round_id, r.player_id, r.hole_number])
      if (!isOwnOptimistic(local, r) && !incomingWins(r, local)) continue
      await db.scores.put(r)
    } else {
      const r = row as CtpResultRow
      const key = ctpKey(r.round_id, r.hole_number)
      if (!shieldAllows(key, stampOf(r), pending)) continue
      const local = await db.ctp_results.get([r.round_id, r.hole_number])
      if (!isOwnOptimistic(local, r) && !incomingWins(r, local)) continue
      await db.ctp_results.put(r)
    }
  }
}

/** Is the local row this device's own provisional copy of exactly this write? */
function isOwnOptimistic(
  local: { client_id?: string | null; client_updated_at_raw?: string | null } | undefined,
  server: { client_id?: string | null; client_updated_at_raw?: string | null },
): boolean {
  if (!local?.client_id || !local.client_updated_at_raw) return false
  return (
    local.client_id.toLowerCase() === (server.client_id ?? '').toLowerCase() &&
    local.client_updated_at_raw === server.client_updated_at_raw
  )
}

// ── The self-echo rule ───────────────────────────────────────────────────────

/**
 * Supabase Realtime has no ignore-self option, so this device's own writes come back to
 * it. That echo is proof the server holds the write, and clearing the pending marker is
 * the point — but ONLY for entries the echo actually covers.
 *
 * The rule is a timestamp comparison, not a client_id comparison: an echo of an older
 * write from this same device must not clear a NEWER pending write for the same cell.
 * Doing that shows a hole as synced while its latest value is still sitting in the queue
 * — the failure is invisible until someone checks the leaderboard on another phone.
 *
 * Returns the number of entries cleared.
 */
export async function clearEchoed(key: string, echo: Stamp | null): Promise<number> {
  if (!echo) return 0
  let cleared = 0
  await db.transaction('rw', [db.outbox], async () => {
    const entries = await db.outbox.where('key').equals(key).toArray()
    for (const entry of entries) {
      // Someone else's write is not an echo — the server decides that one on the next
      // flush, not us.
      if (entry.client_id.toLowerCase() !== echo.clientId.toLowerCase()) continue
      // Covered when the echo is at least as new as the entry: `>=`, not `>`, because the
      // echo of the entry itself carries exactly its own stamp.
      const own: Stamp = { effective: entry.ts, clientId: entry.client_id }
      if (compareStamps(echo, own) < 0) continue
      await db.outbox.delete(entry.seq!)
      cleared += 1
    }
  })
  return cleared
}

// ── Dead-letter operations (surfaced in Diagnostics, Phase 6b) ───────────────

/** Put a dead-lettered item back on the queue with a fresh attempt budget. */
export async function retryDeadLetter(id: string): Promise<boolean> {
  let ok = false
  await db.transaction('rw', [db.outbox, db.dead_letter], async () => {
    const item = await db.dead_letter.get(id)
    if (!item) return
    const { failed_at, reason, seq, ...entry } = item
    await db.outbox.add({ ...entry, attempts: 0, last_error: null })
    await db.dead_letter.delete(id)
    ok = true
  })
  return ok
}

export async function outboxCount(): Promise<number> {
  return db.outbox.count()
}

export async function lastSyncAt(): Promise<string | null> {
  const row = await db.sync_meta.get(LAST_SYNC_KEY)
  return typeof row?.value === 'string' ? row.value : null
}
