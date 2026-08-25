/**
 * Static trip copy and build-time constants ONLY.
 *
 * Supabase is authoritative at runtime for everything mutable — players,
 * indexes, tees, tee times, scorecards, itinerary, point values, purse. This
 * file must never grow to hold anything editable mid-trip; if a value could
 * change without a redeploy, it belongs in the database, not here.
 *
 * The values below are safe to hardcode: they are branding and the booked tee
 * sheet (ground truth, supplied 2025-07-31; see docs/spec/decisions.md).
 */

export const TRIP = {
  name: 'The Board of Directors',
  venue: 'Streamsong Resort',
  venueCity: 'Bowling Green, Florida',
  dates: 'February 4–7, 2027',
  timezone: 'America/New_York',
} as const

/**
 * First tee is 1:10 PM ET, Thu Feb 4, 2027 — the real first-shot moment,
 * referenced in copy. February is EST (UTC−5); the fixed offset keeps every
 * time correct in any viewer's timezone.
 */
export const FIRST_TEE_ISO = '2027-02-04T13:10:00-05:00'

/**
 * Countdown target: midnight ET as the calendar flips from Feb 3 to Feb 4.
 * The counter hits zero when we wake up on day one, so the hero is already
 * showing the live board (see Home's `showLive`) rather than a clock, before
 * anyone tees off. An admin flipping a round live still trips `showLive` early.
 */
export const COUNTDOWN_TARGET_ISO = '2027-02-04T00:00:00-05:00'

export const PLAYERS = [
  'Jon Aronson',
  'Kyle Siegel',
  'Adam Hersh',
  'Chris Denove',
] as const

/**
 * The booked card, in play order. Fri/Sat courses are swapped relative to the
 * original brief — the booking is ground truth (Black Fri / Blue Sat).
 * Placeholder static copy for the scaffold; Phase 2 seeds this into `rounds`
 * and the UI reads it from Supabase thereafter.
 */
export const ROUNDS = [
  {
    no: 1,
    course: 'Streamsong Red',
    architect: 'Coore & Crenshaw',
    day: 'Thu, Feb 4',
    tee: '1:10 PM ET',
  },
  {
    no: 2,
    course: 'Streamsong Black',
    architect: 'Gil Hanse & Jim Wagner',
    day: 'Fri, Feb 5',
    tee: '10:33 AM ET',
  },
  {
    no: 3,
    course: 'Streamsong Blue',
    architect: 'Tom Doak',
    day: 'Sat, Feb 6',
    tee: '10:35 AM ET',
  },
  {
    no: 4,
    course: 'Bone Valley',
    architect: 'David McLay Kidd',
    day: 'Sun, Feb 7',
    tee: '8:28 AM ET',
  },
] as const
