// Display formatting. Golf trip runs in Florida; tee times + dates are ALWAYS rendered in
// America/New_York, never the device locale (CLAUDE.md §Conventions).
const TZ = 'America/New_York'

const dayFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: TZ,
})

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TZ,
})

/** "Thu, Feb 4" from a date-only string or timestamptz. */
export function formatDay(iso: string): string {
  // date-only ('2027-02-04') → parse as ET midnight to avoid an off-by-one from UTC.
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00-05:00`) : new Date(iso)
  return dayFmt.format(d)
}

/** "1:10 PM ET" from a timestamptz. */
export function formatTeeTime(iso: string | null): string | null {
  if (!iso) return null
  return `${timeFmt.format(new Date(iso))} ET`
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
