// THE comparator. Row-level last-write-wins ordered by the tuple
// (client_updated_at_effective, client_id), written once and applied identically at all
// four sites (CLAUDE.md §"The four comparator sites"):
//
//   1. the SQL guard inside rpc_upsert_scores / rpc_upsert_ctp  (supabase/migrations)
//   2. the Realtime handler                                     (src/lib/sync/realtime.ts)
//   3. hydration and refetch                                    (src/lib/data/hydrate.ts)
//   4. the pending-write shield                                 (src/lib/sync/outbox.ts)
//
// It must agree EXACTLY with the SQL, including the client_id tie-break, or two devices
// will disagree about who won and never converge. That agreement is asserted against real
// Postgres in supabase/tests/comparator_parity.sql, not just here.
//
// Two details that look like pedantry and are not:
//
// * Postgres compares timestamptz at MICROSECOND precision. `Date.parse` truncates to
//   milliseconds, so two rows Postgres orders would compare equal here — and "equal" means
//   "incoming loses", which silently drops a write. So timestamps are normalised into
//   (epoch seconds, microseconds) and compared at full precision.
// * Postgres compares uuid by its 16 bytes. For canonical lowercase hex text with hyphens
//   in fixed positions, byte order and string order are the same, so a lowercased string
//   compare is exact. Both PostgREST and crypto.randomUUID() emit lowercase; lowercasing
//   here means a hand-written uppercase uuid can't quietly sort differently than it does
//   in the database.

/** The ordering tuple. `effective` is `client_updated_at_effective` — never `_raw`. */
export interface Stamp {
  effective: string
  clientId: string
}

/** Anything carrying the comparator columns: a Dexie row, a Realtime payload, an RPC row. */
export interface StampedRow {
  client_updated_at_effective?: string | null
  client_id?: string | null
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}:?\d{2})?$/

/**
 * Parse a timestamp into [epoch seconds, microseconds] so nothing below the millisecond is
 * thrown away. Postgres renders `2027-02-04T18:22:31.123456+00:00`; this client sends
 * `2027-02-04T18:22:31.123Z`; both must land on the same axis.
 *
 * A timestamp with no zone is read as UTC, matching how PostgREST renders timestamptz.
 */
export function parseStampTime(value: string): [number, number] {
  const m = ISO.exec(value.trim())
  if (!m) {
    // Not a shape we recognise. Fall back to Date rather than throwing inside a sync
    // handler — losing microseconds is survivable, a crash mid-flush is not.
    const ms = Date.parse(value)
    if (Number.isNaN(ms)) return [0, 0]
    return [Math.floor(ms / 1000), (((ms % 1000) + 1000) % 1000) * 1000]
  }
  const [, y, mo, d, h, mi, s, frac, zone] = m
  const secondsUtc =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 1000
  let offsetSeconds = 0
  if (zone && zone !== 'Z' && zone !== 'z') {
    const sign = zone[0] === '-' ? -1 : 1
    const digits = zone.slice(1).replace(':', '')
    offsetSeconds = sign * (Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4)) * 60)
  }
  // Pad/truncate the fraction to exactly 6 digits — Postgres's resolution.
  const micros = frac ? Number((frac + '000000').slice(0, 6)) : 0
  return [secondsUtc - offsetSeconds, micros]
}

/**
 * Order two stamps the way `(client_updated_at_effective, client_id) > (...)` does in SQL.
 * Returns <0, 0, or >0.
 */
export function compareStamps(a: Stamp, b: Stamp): number {
  const [as, au] = parseStampTime(a.effective)
  const [bs, bu] = parseStampTime(b.effective)
  if (as !== bs) return as < bs ? -1 : 1
  if (au !== bu) return au < bu ? -1 : 1
  const ac = a.clientId.toLowerCase()
  const bc = b.clientId.toLowerCase()
  if (ac === bc) return 0
  return ac < bc ? -1 : 1
}

/**
 * Read the ordering tuple off a row. A row missing either column has never been through
 * the write path (Phase 4's seed hydrate, say); it sorts below everything, so any stamped
 * write beats it — which is what we want, and matches SQL, where a null comparator column
 * makes the guard's `>` null and the update is skipped only because the row can't exist
 * without a stamp in the first place.
 */
export function stampOf(row: StampedRow | undefined | null): Stamp | null {
  if (!row) return null
  const { client_updated_at_effective: eff, client_id: cid } = row
  if (!eff || !cid) return null
  return { effective: eff, clientId: cid }
}

/**
 * THE decision. May `incoming` overwrite `existing`?
 *
 * - No existing row: yes.
 * - Existing row has no stamp: yes (an unstamped row predates the write path).
 * - Incoming has no stamp but existing does: NO — an unstamped row must never clobber a
 *   stamped one. This is the case that turns a routine refetch into 18 lost holes.
 * - Both stamped: strictly greater tuple wins. Ties lose, exactly as SQL's `>` does.
 */
export function incomingWins(
  incoming: StampedRow | Stamp | null,
  existing: StampedRow | Stamp | null | undefined,
): boolean {
  const a = asStamp(incoming)
  const b = asStamp(existing)
  if (b === null) return true
  if (a === null) return false
  return compareStamps(a, b) > 0
}

function asStamp(v: StampedRow | Stamp | null | undefined): Stamp | null {
  if (!v) return null
  if ('effective' in v && 'clientId' in v) return v as Stamp
  return stampOf(v as StampedRow)
}
