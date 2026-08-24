// Display formatting. Golf trip runs in Florida; tee times + dates are ALWAYS rendered in
// America/New_York, never the device locale (CLAUDE.md §Conventions).
const TZ = 'America/New_York'

const dayFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: TZ,
})

const dayLongFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: TZ,
})

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TZ,
})

// date-only ('2027-02-04') → parse as ET noon to avoid an off-by-one from UTC.
function toDate(iso: string): Date {
  return iso.length === 10 ? new Date(`${iso}T12:00:00-05:00`) : new Date(iso)
}

/** "Thu, Feb 4" from a date-only string or timestamptz. */
export function formatDay(iso: string): string {
  return dayFmt.format(toDate(iso))
}

/** "Thursday, February 4" — the timeline's day headers. */
export function formatDayLong(iso: string): string {
  return dayLongFmt.format(toDate(iso))
}

const etDateFmt = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TZ,
})

/** The America/New_York calendar date of an instant, as 'YYYY-MM-DD' (en-CA gives ISO order). */
export function etDateString(d: Date): string {
  return etDateFmt.format(d)
}

/** "1:10 PM ET" from a timestamptz. */
export function formatTeeTime(iso: string | null): string | null {
  if (!iso) return null
  return `${timeFmt.format(new Date(iso))} ET`
}

const timeInputFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TZ,
})

/** A timestamptz → "13:10" in ET, for an <input type="time">. '' when null. */
export function etTimeInputValue(iso: string | null): string {
  if (!iso) return ''
  return timeInputFmt.format(new Date(iso))
}

/**
 * A round's ET date ('YYYY-MM-DD') + a "HH:MM" clock time → a timestamptz string. The trip
 * is entirely in February, which is EST (UTC−5) year in, year out — the same fixed offset
 * FIRST_TEE_ISO uses — so composing at −05:00 is exact, no DST edge to chase.
 */
export function composeEtTimestamp(dateOnly: string, hhmm: string): string | null {
  if (!hhmm) return null
  return `${dateOnly}T${hhmm}:00-05:00`
}

const ROUND_STATUS_LABEL: Record<string, string> = {
  upcoming: 'Upcoming',
  in_progress: 'In progress',
  final: 'Final',
  abandoned: 'Abandoned',
}
export const roundStatusLabel = (s: string): string => ROUND_STATUS_LABEL[s] ?? s

/** Signed points-gap for the standings ("–", "-4"). */
export function formatGap(gap: number): string {
  return gap === 0 ? '—' : `-${gap}`
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Integer cents → "$12.50". The ledger is always in cents; round only here (brief §Money). */
export function formatMoney(cents: number): string {
  return usd.format(cents / 100)
}

/** Signed money for a net line: "+$40.00", "−$40.00", "$0.00". */
export function formatMoneySigned(cents: number): string {
  if (cents === 0) return usd.format(0)
  const s = usd.format(Math.abs(cents) / 100)
  return cents > 0 ? `+${s}` : `−${s}`
}
