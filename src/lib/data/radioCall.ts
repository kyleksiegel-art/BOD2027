import { buildRoundDetail, buildStandings, resolveRoundWinnerIds } from './compute'
import type { Db, PlayerRoundVM } from './compute'
import { buildFieldStory, shotOf, SHOT } from './fieldStory'
import type { StoryEntry, StoryVM } from './fieldStory'
import { purseSettingsOf } from './money'
import { courseShortName, etDateString, formatTeeTime, ordinalOf } from '@/lib/format'

/**
 * The radio call: a broadcaster's update read out loud by the phone's built-in voice (speak.ts).
 * Kyle 2026-10-11: "cover the last few holes, what happened the past nine, what's upcoming … a
 * plethora of scenarios based on what hole we're on … let it have some fun."
 *
 * Analysis first, then prose, like the Field Report it builds on (only a half-finished hole and
 * the finale's last hole still read its lines). Which segments play depends on the PHASE:
 *
 *   preview  (no hole saved yet) → welcome, tee time, who gets shots, the week, the 1st hole
 *   early 1–3 · front 4–8 · back 10–14 · closing 15–17
 *            → open, the last couple of holes, a stretch review once there's one to review,
 *              color notes, what's at stake today and for the week, the next hole, close
 *   turn (9) → open, the front nine reviewed, notes, stakes, the 10th, close
 *   final    → a highlights show: result, how it was won, play of the day, the field, a blooper
 *
 * Every line is picked from a pool with `rand`, so two taps on the same hole sound different;
 * tests pass a fixed `rand`. Names only, never a pronoun, so no line guesses one.
 */

export type CallPhase = 'preview' | 'early' | 'front' | 'turn' | 'back' | 'closing' | 'final'

export interface RadioCallVM {
  roundNumber: number
  phase: CallPhase
  /** What this call covers right now, for the Admin card: "Round 2 · live, through 12". */
  label: string
  /** The lines to read, one utterance each. Call again for a different take. */
  script: (rand?: () => number) => string[]
  /**
   * The same, steering clear of the line templates in `avoid` (the phone's recent calls), and
   * reporting which templates it used so the next call can avoid them in turn.
   */
  compose: (rand?: () => number, avoid?: ReadonlySet<string>) => { lines: string[]; used: string[] }
}

type Hr = PlayerRoundVM['holeResults'][number]

/**
 * Trip lore (Kyle 2026-10-11): one label each when the field is introduced, nothing more ("too
 * much emphasis on the champion bit"). Adam Hersh won the inaugural Board of Directors; Jon
 * Aronson and Chris Denove are the returning champions; Kyle Siegel built the app. Matched by surname.
 */
const LORE = { inaugural: 'Hersh', returning: ['Aronson', 'Denove'], builder: 'Siegel' }
const surname = (name: string) => name.trim().split(/\s+/).slice(-1)[0] ?? ''

interface Pl {
  id: string
  first: string
  holes: Map<number, Hr>
  ownStrokes: number // own playing strokes before the low-man subtraction (preview only)
  strokes: number // strokes actually received today
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const words = (n: number) => NUMBER_WORDS[n] ?? String(n)
const first = (name: string) => name.split(/\s+/)[0] || name
const plural = (n: number, one: string, many = `${one}s`) => `${words(n)} ${n === 1 ? one : many}`
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
const dollars = (cents: number) => `$${Math.round(cents / 100)}`

/**
 * The round the call follows: the live one; else the next one when it's that round's day (the
 * first-tee preview, before anyone presses Start round); else the last final one; else round 1.
 */
function focusRounds(db: Db, todayET: string): { roundNumber: number; preview: boolean }[] {
  const rounds = db.rounds.filter((r) => r.status !== 'abandoned').sort((a, b) => a.round_number - b.round_number)
  const live = rounds.find((r) => r.status === 'in_progress')
  if (live) return [{ roundNumber: live.round_number, preview: false }]
  const next = rounds.find((r) => r.status === 'upcoming')
  const lastFinal = rounds.filter((r) => r.status === 'final').pop()
  const out: { roundNumber: number; preview: boolean }[] = []
  if (next && (!lastFinal || next.date === todayET)) out.push({ roundNumber: next.round_number, preview: true })
  if (lastFinal) out.push({ roundNumber: lastFinal.round_number, preview: false })
  return out
}

export function buildRadioCall(db: Db, todayET: string = etDateString(new Date())): RadioCallVM | null {
  // A preview of a round nobody has been set up for yet falls back to the last final round.
  for (const focus of focusRounds(db, todayET)) {
    const vm = callFor(db, focus)
    if (vm) return vm
  }
  return null
}

function callFor(db: Db, focus: { roundNumber: number; preview: boolean }): RadioCallVM | null {
  const detail = buildRoundDetail(focus.roundNumber, db)
  if (!detail || !detail.holes || detail.course.data_is_placeholder) return null
  const holes = detail.holes
  const n = detail.holesCounted
  const players: Pl[] = detail.players
    .filter((p) => p.status === 'playing')
    .map((p) => ({
      id: p.playerId,
      first: first(p.name),
      holes: new Map(p.holeResults.map((h) => [h.holeNumber, h])),
      ownStrokes: p.worksheet?.ownStrokes ?? 0,
      strokes: p.worksheet?.strokesReceivedFinal ?? 0,
    }))
  if (players.length === 0) return null

  const done = (h: number) => players.every((p) => p.holes.get(h)?.completed)
  let complete = 0
  while (complete < n && done(complete + 1)) complete++
  let edge = 0
  for (const p of players) for (const [h, hr] of p.holes) if (hr.completed) edge = Math.max(edge, h)

  const story = buildFieldStory(db)
  const roundStory = story && story.roundNumber === focus.roundNumber ? story : null
  const phase: CallPhase =
    focus.preview || edge === 0
      ? 'preview'
      : complete >= n
        ? 'final'
        : complete >= 15
          ? 'closing'
          : complete >= 10
            ? 'back'
            : complete === 9
              ? 'turn'
              : complete >= 4
                ? 'front'
                : 'early'

  const ctx: Ctx = {
    db,
    detail,
    holes,
    n,
    players,
    complete,
    edge,
    story: roundStory,
    roundNumber: focus.roundNumber,
    course: courseRef(detail.course.name),
    courseFull: detail.course.name,
  }
  const isFinale = phase === 'final' && roundsAfter(ctx).length === 0
  // Same test as tournamentOpener: the first round of the trip, nothing final yet.
  const firstRound = Math.min(...db.rounds.filter((r) => r.status !== 'abandoned').map((r) => r.round_number))
  const isOpener = phase === 'preview' && focus.roundNumber === firstRound && !db.rounds.some((r) => r.status === 'final')
  const label = isFinale
    ? 'Trip finale'
    : isOpener
      ? 'Trip opener, first tee'
      : phase === 'preview'
        ? `Round ${focus.roundNumber} · first-tee preview`
        : phase === 'final'
          ? `Round ${focus.roundNumber} · round wrap`
          : phase === 'turn'
            ? `Round ${focus.roundNumber} · the turn`
            : `Round ${focus.roundNumber} · live, through ${complete}`
  return {
    roundNumber: focus.roundNumber,
    phase,
    label,
    script: (rand = Math.random) => compose(rand).lines,
    compose,
  }

  function compose(rand: () => number = Math.random, avoid: ReadonlySet<string> = new Set()) {
    const used: string[] = []
    // Prefer a line whose template hasn't been heard lately; when a whole pool has, any will do.
    const pick: Pick = (xs) => {
      const fresh = xs.filter((x) => !avoid.has(signature(x)))
      const from = fresh.length > 0 ? fresh : xs
      const chosen = from[Math.min(from.length - 1, Math.floor(rand() * from.length))]
      // An empty choice ("no quip this time") isn't a template to avoid.
      if (xs.length > 1 && chosen) used.push(signature(chosen))
      return chosen
    }
    const lines = phase === 'preview' ? previewCall(ctx, pick) : phase === 'final' ? finalCall(ctx, pick) : liveCall(ctx, phase, pick)
    return { lines: lines.filter((l): l is string => !!l).map(forSpeech), used }
  }
}

/**
 * A line's template, with the facts taken out: names, numbers and number words. Two calls that
 * used "X has taken zeros on N straight holes" share a signature whoever it was about.
 */
export function signature(line: string): string {
  return line
    .replace(/\$?\d+/g, '#')
    .replace(new RegExp(`\\b(${NUMBER_WORDS.join('|')})\\b`, 'gi'), '#')
    .replace(/\b[A-Z][a-z]+(?:'s)?/g, 'N')
    .toLowerCase()
    .slice(0, 120)
}

interface Ctx {
  db: Db
  detail: NonNullable<ReturnType<typeof buildRoundDetail>>
  holes: NonNullable<NonNullable<ReturnType<typeof buildRoundDetail>>['holes']>
  n: number
  players: Pl[]
  complete: number // holes the WHOLE group has finished
  edge: number // furthest hole anyone has finished
  story: StoryVM | null
  roundNumber: number
  course: string // "the Blue"
  courseFull: string // "Streamsong Blue"
}
type Pick = (xs: string[]) => string

// ── Facts ────────────────────────────────────────────────────────────────────

const pts = (p: Pl, from: number, to: number) => {
  let s = 0
  for (let h = from; h <= to; h++) s += p.holes.get(h)?.points ?? 0
  return s
}
const zerosIn = (p: Pl, from: number, to: number) => {
  let z = 0
  for (let h = from; h <= to; h++) {
    const hr = p.holes.get(h)
    if (hr?.completed && (hr.points ?? 0) === 0) z++
  }
  return z
}
const realBirdiesIn = (p: Pl, from: number, to: number) => {
  let k = 0
  for (let h = from; h <= to; h++) {
    const hr = p.holes.get(h)
    if (hr?.completed && hr.grossStrokes !== null && hr.grossStrokes - hr.par <= -1) k++
  }
  return k
}

/** Players ranked by points through `h`, best first, and the gap at the top. */
function board(c: Ctx, h: number) {
  const rows = c.players.map((p) => ({ p, s: pts(p, 1, h) })).sort((a, b) => b.s - a.s)
  const top = rows[0].s
  const leaders = rows.filter((r) => r.s === top).map((r) => r.p)
  const chaser = rows.find((r) => r.s < top)
  return { rows, leaders, top, gap: leaders.length > 1 || !chaser ? 0 : top - chaser.s, chaser: chaser?.p ?? null, spread: top - rows[rows.length - 1].s }
}

/** Later rounds still to play after this one. */
function roundsAfter(c: Ctx) {
  return c.db.rounds
    .filter((r) => r.round_number > c.roundNumber && (r.status === 'upcoming' || r.status === 'in_progress'))
    .sort((a, b) => a.round_number - b.round_number)
}

function teeYardage(c: Ctx, hole: number): number | null {
  const holeRow = c.db.holes.find((h) => h.course_id === c.detail.course.id && h.hole_number === hole)
  if (!holeRow) return null
  const rps = c.db.round_players.filter((rp) => rp.round_id === c.detail.round.id && rp.status === 'playing')
  const tally = new Map<string, number>()
  for (const rp of rps) tally.set(rp.tee_id, (tally.get(rp.tee_id) ?? 0) + 1)
  const tee = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const y = c.db.hole_yardages.find((r) => r.hole_id === holeRow.id && r.tee_id === tee)
  return y?.yardage ?? null
}

// ── Segments ─────────────────────────────────────────────────────────────────

function openLine(c: Ctx, phase: CallPhase, pick: Pick): string {
  const left = c.n - c.complete
  const lastRound = roundsAfter(c).length === 0
  const pools: Record<string, string[]> = {
    early: [
      `We're underway on ${c.course}, and it's already getting interesting.`,
      `Live from ${c.course}, where the round is ${plural(c.complete, 'hole')} old and the excuses are already flowing.`,
      `Good to be with you from ${c.course}. ${cap(words(c.complete))} down, ${words(left)} to play.`,
      `Early days on ${c.course}. Nobody has won anything yet, but a few people have already lost their swing.`,
      `We join the action on ${c.course}, ${plural(c.complete, 'hole')} in. The nerves are real. The tempo is not.`,
      `Live and only slightly caffeinated from ${c.course}. ${cap(words(c.complete))} holes down.`,
      `Your early report from ${c.course}, where optimism is still running high.`,
      `It's early on ${c.course}, which means everybody still thinks this is going to be their day.`,
      `An update from ${c.course}, where the group is through ${c.complete}.`,
      `Here's where things stand on ${c.course}, ${plural(c.complete, 'hole')} in.`,
      `The early read from ${c.course}, through ${c.complete}.`,
      `First report from ${c.course}. ${cap(plural(c.complete, 'hole'))} in, and the handicaps are already being questioned.`,
      `We're live on ${c.course}, through ${c.complete}. The scorecards are still clean. Mostly.`,
      `Greetings from ${c.course}, where the group is through ${c.complete} and the first-tee jitters are wearing off.`,
      `${cap(plural(c.complete, 'hole'))} into the day on ${c.course}, and the trash talk is already ahead of the golf.`,
      `Checking in early from ${c.course}. Through ${c.complete}, and everyone is still pretending to have a plan.`,
      `Live from the dunes of ${c.course}, through ${c.complete}. Nobody has lost a ball yet. Allegedly.`,
      `The early word from ${c.course}: through ${c.complete}, and the coffee is still doing the heavy lifting.`,
      `We're up and walking on ${c.course}, through ${c.complete}.`,
      `Your first look at ${c.course}, ${plural(c.complete, 'hole')} in.`,
      `${cap(plural(c.complete, 'hole'))} down on ${c.course}. Early, but not too early to start counting the excuses.`,
      `Through ${c.complete} on ${c.course}. ${cap(words(left))} to go, and plenty of time to make a mess of it.`,
    ],
    front: [
      `Back with you on ${c.course}, through ${c.complete}.`,
      `Here's your update from the front nine of ${c.course}. The group is through ${c.complete}.`,
      `Checking in from ${c.course}, through the ${ordinalOf(c.complete)}, and folks, there's a golf tournament breaking out.`,
      `Front nine update from ${c.course}. ${cap(words(c.complete))} holes in, and the story is starting to write itself.`,
      `We're through ${c.complete} on ${c.course}, and the scorecards are starting to tell the truth.`,
      `Pull up a chair. We're through ${c.complete} on ${c.course}, and it's getting good.`,
      `Your front nine report from ${c.course}, through ${c.complete}. Some of you will want to skip ahead.`,
      `Through ${c.complete} on ${c.course}. The pretenders are starting to separate from the contenders.`,
      `Here's where it stands on ${c.course}, through ${c.complete}.`,
      `An update from ${c.course}. The group has finished the ${ordinalOf(c.complete)}.`,
      `Front nine report from ${c.course}, through ${c.complete}. Grab a seat, it's getting spicy.`,
      `Through ${c.complete} on ${c.course}, and the early nerves have turned into actual golf.`,
      `${cap(words(c.complete))} holes in on ${c.course}. Time for a proper update.`,
      `Back on the air from ${c.course}, where the group has just walked off the ${ordinalOf(c.complete)} green.`,
      `Through ${c.complete} on ${c.course}. The sand is winning a few battles, the golfers are winning a few more.`,
      `Here's the front nine picture from ${c.course}, through ${c.complete}.`,
      `We pick it up on ${c.course}, through the ${ordinalOf(c.complete)}, and somebody is having a day.`,
      `Through ${c.complete} on ${c.course}. The scorecard never lies, but it does occasionally exaggerate.`,
      `An update from ${c.course}, ${c.complete} holes played, and the group chat is going to have opinions.`,
      `The front nine at ${c.course}, through ${c.complete}. Let's see who showed up.`,
    ],
    turn: [
      `That's the turn on ${c.course}. Grab a hot dog, because here's how the front nine went.`,
      `Nine down, nine to go on ${c.course}. Let's go to the tape on the front side.`,
      `The front nine at ${c.course} is in the books, and some of it should probably stay there.`,
      `Halfway home on ${c.course}. Time to check the scorecards and, for some of us, our life choices.`,
      `That's nine on ${c.course}. Let's review the front side before anybody starts making excuses.`,
      `The turn at ${c.course}. Hot dogs are being purchased. Grudges are being formed. Here's the front nine.`,
      `Nine holes in the books on ${c.course}. Let's see who brought their game and who left it in the car.`,
      `That's the turn on ${c.course}. Here's the front nine.`,
      `Nine played on ${c.course}. A look back at the front side.`,
      `Nine holes down on ${c.course}. Let's run the front side back.`,
      `Halfway on ${c.course}, and it's time to sort the heroes from the hot dog line.`,
      `The front nine at ${c.course} is done. Some of you played it. Some of you survived it.`,
      `That's the turn at ${c.course}. Let's hand out the front nine report cards.`,
      `Front nine complete on ${c.course}. Before anybody reloads, here's what happened.`,
      `We've reached the turn on ${c.course}, where the snacks are good and the scorecards are honest.`,
      `Nine in the books at ${c.course}. Here's the damage.`,
      `The turn on ${c.course}. A quick look back before the back nine.`,
      `Halfway through ${c.course}. Here's how the front nine played out.`,
    ],
    back: [
      `Into the back nine on ${c.course}, through ${c.complete}.`,
      `The back nine is where rounds go to live or die, and we're through ${c.complete} on ${c.course}.`,
      `Here's the latest from ${c.course}. ${cap(words(left))} holes to play, and the tension is real.`,
      `Back nine on ${c.course}, through ${c.complete}. This is where it gets serious.`,
      `We're deep into the back nine on ${c.course}, through ${c.complete}, and nobody is joking around anymore.`,
      `Through ${c.complete} on ${c.course}. The beers are getting warmer and the putts are getting longer.`,
      `Your back nine update from ${c.course}. ${cap(words(left))} to play, and every one of them matters.`,
      `Through ${c.complete} on ${c.course}. If you were saving your good golf for later, later is now.`,
      `An update from the back nine on ${c.course}, through ${c.complete}.`,
      `Through ${c.complete} on ${c.course}, ${words(left)} to play. Here's where it stands.`,
      `Back nine update from ${c.course}, through ${c.complete}. The legs are tired, the stakes are not.`,
      `Through ${c.complete} on ${c.course}. ${cap(words(left))} holes left, and somebody's about to make a move.`,
      `We're on the back side of ${c.course}, through ${c.complete}, and the walking is starting to show.`,
      `Through ${c.complete} on ${c.course}. This is when the good swings go quiet and the bad ones get loud.`,
      `Checking in from the back nine at ${c.course}. ${cap(words(left))} to play.`,
      `Through ${c.complete} on ${c.course}, and the small talk has stopped.`,
      `The back nine on ${c.course}, through ${c.complete}. Every point counts double now. Not literally. Emotionally.`,
      `${cap(words(left))} holes to play on ${c.course}, and the scoreboard is starting to matter.`,
      `Through ${c.complete} on ${c.course}. Here's the latest.`,
      `Back nine on ${c.course}, ${words(left)} to go. Here's how it looks.`,
    ],
    closing: [
      `Down the stretch they come on ${c.course}. ${cap(words(left))} to play.`,
      `This is the part of the round the group chat will remember. ${cap(words(left))} to play on ${c.course}.`,
      `${cap(words(left))} holes left on ${c.course}. Hands are shaking. Grips are tightening.`,
      `We're in the home stretch on ${c.course}. ${cap(words(left))} to play, and you can feel it.`,
      `${cap(words(left))} holes left on ${c.course}. This is where legends are made, or where excuses are born.`,
      `It's crunch time on ${c.course}. ${cap(words(left))} to play. Somebody hold my beer.`,
      `The finish line is in sight on ${c.course}. ${cap(words(left))} holes left, and nobody is safe.`,
      `${cap(words(left))} to play on ${c.course}. Here's where it stands.`,
      `Coming down the stretch on ${c.course}, ${words(left)} holes left.`,
      `${cap(plural(left, 'hole'))} left on ${c.course}. Nobody wants to be the story at dinner.`,
      `The end is near on ${c.course}. ${cap(words(left))} to play.`,
      `${cap(words(left))} to go on ${c.course}, and the nerves have joined the group.`,
      `We're into the final stretch on ${c.course}, ${plural(left, 'hole')} to play. Every putt matters now.`,
      `Closing time on ${c.course}. ${cap(plural(left, 'hole'))} left, and the money is listening.`,
      `${cap(plural(left, 'hole'))} left on ${c.course}. Somebody is about to be a hero, somebody else a cautionary tale.`,
      `The finishing stretch on ${c.course}. ${cap(words(left))} to play, and nobody is talking.`,
      `${cap(plural(left, 'hole'))} to play on ${c.course}. Here's the picture.`,
      `Into the finish on ${c.course}, ${words(left)} to go.`,
    ],
  }
  const open = pick(pools[phase] ?? pools.front)
  return lastRound && (phase === 'back' || phase === 'closing') ? `${open} And remember, this is the last round of the trip.` : open
}

/**
 * The last couple of holes, called rather than read out (Kyle 2026-11-11): what changed at the
 * top, who won the hole and with what, who gave one back. Two quiet holes share one line. A hole
 * only part of the group has finished is still the Field Report's own "X and Y are in" line.
 */
function recentAction(c: Ctx, pick: Pick): string[] {
  const h = c.complete
  const calls = [h - 1, h].filter((x) => x >= 1).map((x) => ({ hole: x, text: holeCall(c, x, pick) }))
  const lines: string[] = []
  const quiet = calls.filter((x) => !x.text)
  if (calls.length > 0 && quiet.length === calls.length) {
    const b = board(c, h)
    const top = b.leaders.length === 1 ? `${b.leaders[0].first} still leads by ${b.gap}` : `${listOf(b.leaders.map((p) => p.first))} still share the lead`
    const where = calls.length === 2 ? `the ${ordinalOf(h - 1)} and ${ordinalOf(h)}` : `the ${ordinalOf(h)}`
    lines.push(
      pick([
        `Quiet on ${where}. Pars and polite applause. ${top}.`,
        `Nothing to see on ${where}. ${top}.`,
        `${cap(where)} came and went without incident. ${top}.`,
        `Not much to report from ${where}. Nobody blinked. ${top}.`,
        `A lull on ${where}. ${top}.`,
        `${cap(where)}: all very civilized. ${top}.`, `No news from ${where}. ${top}.`, `${cap(where)} changed nothing. ${top}.`, `Steady golf on ${where}, and no movement. ${top}.`,
      ]),
    )
  } else for (const x of calls) if (x.text) lines.push(x.text)
  // A hole in one needs no lead-in.
  if (lines.length > 0 && !/hole in one|true (eagle|albatross)/i.test(lines[0])) lines[0] = `${pick(['Last time through.', "Here's what you missed.", 'The recent action.', 'Let\'s go to the tape.', 'Quick recap.', 'Catching you up.', 'In case you were in the porta-potty.', 'The last little while, in brief.', 'Rewind.', 'The latest.', 'Previously, on the Board of Directors.', 'What just happened.', "Here's the action.", "If you blinked, here's what you missed.", 'From the last couple of holes.', 'For those just tuning in.'])} ${lines[0]}`
  const partial = c.story?.entries.find((e) => e.kind === 'partial')
  if (partial) lines.push(storyLine(partial))
  return lines
}

/** One finished hole as a broadcaster would call it, or '' when nothing on it is worth airtime. */
function holeCall(c: Ctx, h: number, pick: Pick): string {
  const boom = blowUps(c, h)[0]
  let text = holeAction(c, h, pick, !!boom)
  const on = ordinalOf(h)
  const par = c.holes.find((x) => x.holeNumber === h)?.par ?? 4
  // Closest to the pin on a par 3 (a hole in one has already made the joke).
  const win = par === 3 ? c.db.ctp_results.find((r) => r.round_id === c.detail.round.id && r.hole_number === h && r.player_id) : undefined
  const wp = win ? c.players.find((p) => p.id === win.player_id) : undefined
  if (wp && !/hole in one/i.test(text))
    text = text
      ? `${text} ${pick([`${wp.first} wins closest to the pin there.`, `Closest to the pin goes to ${wp.first}.`, `${wp.first} sticks it closest. That one gets paid later.`, `And ${wp.first} takes closest to the pin.`, `Closest to the pin: ${wp.first}. Cash, settled later.`, `${wp.first} is closest to the pin on that one.`, `Closest to the pin there belongs to ${wp.first}.`, `And the pin money goes to ${wp.first}.`])}`
      : pick([`${wp.first} wins closest to the pin on the ${on}.`, `Closest to the pin on the ${on} goes to ${wp.first}. Otherwise, nothing to see.`, `${wp.first} sticks it closest on the ${on}. That's the headline from a quiet hole.`, `The ${on} was quiet, except for ${wp.first}, who takes closest to the pin.`, `Not much on the ${on}, but ${wp.first} is closest to the pin.`, `${wp.first} takes closest to the pin on the ${on}. That's the news.`, `The ${on}: closest to the pin, ${wp.first}. Nothing else to report.`])
  // A blow-up: four over par or worse, gross. A zero is a zero, but a 9 is a story.
  if (boom) {
    const g = boom.gross
    const line = pick([
      `${boom.p.first} made ${an(g)} ${g} on the par-${par} ${on}. We counted twice.`,
      `${cap(an(g))} ${g} for ${boom.p.first} on the ${on}. That is not a typo.`,
      `${boom.p.first} wrote down ${an(g)} ${g} on the par-${par} ${on}. The pencil nearly snapped.`,
      `The ${on} took ${g} shots out of ${boom.p.first}. Moving on quickly.`,
      `${boom.p.first}, ${an(g)} ${g} on the ${on}. There were witnesses. There will be stories.`,
      `And spare a thought for ${boom.p.first}: ${an(g)} ${g} on the par-${par} ${on}.`, `${boom.p.first} needed ${g} on the par-${par} ${on}. It felt like more.`, `Disaster for ${boom.p.first} on the ${on}: ${an(g)} ${g}.`, `${boom.p.first} is going to want to forget the ${on}. ${cap(an(g))} ${g}.`, `The scorecard says ${g} for ${boom.p.first} on the ${on}. The scorecard is not lying.`,
    ])
    text = text ? `${text} ${line}` : line
  }
  return text
}

const an = (n: number) => (n === 8 || n === 11 || n === 18 ? 'an' : 'a')

/** Players who went four over par or worse (gross, holed out) on a hole, worst first. */
function blowUps(c: Ctx, h: number): { p: Pl; gross: number; over: number }[] {
  const out: { p: Pl; gross: number; over: number }[] = []
  for (const p of c.players) {
    const hr = p.holes.get(h)
    if (hr?.completed && !hr.pickedUp && hr.grossStrokes !== null && hr.grossStrokes - hr.par >= 4) out.push({ p, gross: hr.grossStrokes, over: hr.grossStrokes - hr.par })
  }
  return out.sort((a, b) => b.over - a.over)
}

function holeAction(c: Ctx, h: number, pick: Pick, skipZeros = false): string {
  const on = ordinalOf(h)
  const now = board(c, h)
  const prev = h > 1 ? board(c, h - 1) : null
  const rows = c.players.map((p) => ({ p, pts: p.holes.get(h)?.points ?? 0, kind: shotOf(p.holes.get(h)) })).sort((a, b) => b.pts - a.pts)
  const best = rows[0]
  const outright = rows.length > 1 && rows[1].pts < best.pts
  const made = (r: (typeof rows)[number]) => (r.kind && r.kind !== 'blank' ? SHOT[r.kind].noun : r.pts === 2 ? 'a net par' : r.pts === 1 ? 'a net bogey' : 'a zero')
  const soleNow = now.leaders.length === 1 ? now.leaders[0] : null
  const soleBefore = prev && prev.leaders.length === 1 ? prev.leaders[0] : null
  const zeros = rows.filter((r) => r.pts === 0).map((r) => r.p)
  const lead = soleNow ? `${soleNow.first} leads by ${now.gap}` : `${listOf(now.leaders.map((p) => p.first))} share the lead`

  // A hole in one outranks everything else that happened on the hole. The announcer loses it.
  const ace = rows.find((r) => r.kind === 'ace')
  if (ace) {
    const par = c.holes.find((x) => x.holeNumber === h)?.par ?? 3
    const a = ace.p.first
    const ctp = par === 3 ? pick([' Safe to say that wins closest to the pin.', ' And yes, that counts as closest to the pin.', ' Closest to the pin? Try in the pin.', '']) : ''
    return `${pick([
      `Stop everything. Stop everything! ${a} has made a hole in one on the ${on}! A hole in one! One swing, one ball, bottom of the cup!`,
      `Oh my goodness. Oh my goodness! ${a} just made a hole in one on the ${on}! It's in the hole! It is in the hole!`,
      `Are you kidding me? ${a}! A hole in one on the par-${par} ${on}! I have seen it all now. An ace! At the Board of Directors!`,
      `Hole in one! Hole in one! ${a} has aced the ${on}! Somebody call the clubhouse, somebody call the newspaper, somebody call ${a}'s mother!`,
      `You are not going to believe this. ${a}. The ${on}. One shot. A hole in one! Pandemonium at Streamsong!`,
      `It's in! It's in the hole! ${a} with a hole in one on the ${on}! Ladies and gentlemen, we have just witnessed history!`,
      `No. No way. No way! ${a} has holed it from the tee on the ${on}! A hole in one! I need to sit down.`,
      `Call it in, call everyone! ${a}, a hole in one on the par-${par} ${on}! Unbelievable! Absolutely unbelievable!`,
    ])}${ctp} ${pick([`The drinks tonight are on ${a}. Those are the rules.`, `${a} is buying tonight. That is not a suggestion.`, `Frame the ball. Frame the card. Frame ${a}.`, `Nobody in this group is ever going to hear the end of it.`])} ${pick(['Oh, and', 'For the record,', 'Almost forgot, there is a tournament on:'])} ${lead}.`
  }
  // A true eagle is the next loudest thing: the shot first, then what it did to the board.
  const big = rows.find((r) => r.kind === 'eagle' || r.kind === 'albatross')
  if (big) {
    const par = c.holes.find((x) => x.holeNumber === h)?.par ?? 5
    const k = big.kind === 'albatross' ? 'albatross' : 'eagle'
    const e = big.p.first
    const alone = rows.length > 2 && rows.every((r) => r.p.id === big.p.id || r.pts === 0) ? ` The other ${words(rows.length - 1)} took zeros.` : ''
    const before = prev ? prev.gap : 0
    const tail =
      soleNow && prev && soleNow.id !== soleBefore?.id
        ? `And with it, the lead: ${soleNow.first} is ${now.gap} in front.`
        : !soleNow
          ? `${lead}.`
          : soleNow.id === big.p.id
            ? now.gap > before
              ? `The lead goes from ${before} to ${now.gap}.`
              : `${lead}.`
            : now.gap < before
              ? `That cuts ${soleNow.first}'s lead to ${now.gap}.`
              : `${soleNow.first} still leads by ${now.gap}.`
    return `${pick([
      `Stop everything. ${e} just made a true ${k} on the par-${par} ${on}! No strokes. No asterisk.`,
      `Hold the phone. A true ${k} for ${e} on the ${on}! Gross. On the card. With witnesses.`,
      `Big news from the ${on}: ${e} with a true ${k}! Somebody get a photo of that scorecard.`,
      `Did that just happen? ${e}, a true ${k} on the par-${par} ${on}! Not net. A true one.`,
      `${e} has made a true ${k} on the ${on}! The drinks are on ${e}. That's the rule now.`,
      `${cap(k)}! A true ${k}! ${e}, on the par-${par} ${on}! The handicap committee has been notified.`,
      `Oh, that is filthy. ${e} makes a true ${k} on the ${on}! Somebody frame that scorecard.`, `You have to be kidding. ${e}, a true ${k} on the par-${par} ${on}! Nobody gave ${e} a stroke for that.`, `Get the camera out. ${e} has just made a true ${k} on the ${on}!`, `A true ${k} on the ${on} for ${e}! That is not supposed to happen in this group.`,
    ])}${alone} ${tail}`
  }
  if (best.pts === 0)
    return pick([
      `The ${on} beat everybody. ${cap(words(rows.length))} players, zero points. ${lead}.`,
      `Carnage on the ${on}. Nobody scored. ${lead}.`,
      `The ${on} won. Zeros for the whole group. ${lead}.`,
      `Nobody wants to talk about the ${on}. Zeros all round. ${lead}.`, `The ${on} took everybody's lunch money. No points for anyone. ${lead}.`, `A clean sweep for the golf course on the ${on}. ${lead}.`,
    ])
  const mine = (p: Pl) => made(rows.find((r) => r.p.id === p.id)!)
  if (h === 1) {
    return soleNow
      ? pick([
          `${soleNow.first} is out of the gate first: ${mine(soleNow)} on the 1st, and an early lead of ${now.gap}.`,
          `First blood to ${soleNow.first}, with ${mine(soleNow)} on the 1st.`,
          `${soleNow.first} wins the 1st with ${mine(soleNow)}. One hole, one leader.`, `${soleNow.first} strikes first with ${mine(soleNow)} on the opening hole.`, `An early statement from ${soleNow.first}: ${mine(soleNow)} on the 1st.`,
        ])
      : pick([
          `${listOf(now.leaders.map((p) => p.first))} share the lead after the 1st.`,
          `After one, ${listOf(now.leaders.map((p) => p.first))} are level at the top.`,
          `The 1st separates nobody at the top: ${listOf(now.leaders.map((p) => p.first))} share it.`, `No separation after the 1st. ${listOf(now.leaders.map((p) => p.first))} are level in front.`,
        ])
  }
  if (soleNow && prev && soleNow.id !== soleBefore?.id) {
    return soleBefore
      ? pick([
          `We have a new leader. ${soleNow.first} goes past ${soleBefore.first} on the ${on} with ${mine(soleNow)}, and leads by ${now.gap}.`,
          `Lead change on the ${on}. ${soleNow.first} makes ${mine(soleNow)}, ${soleBefore.first} makes ${mine(soleBefore)}, and ${soleNow.first} is ${now.gap} in front.`,
          `${soleBefore.first} has been caught and passed. ${soleNow.first} takes over on the ${on}, ${now.gap} ahead.`,
          `Changing of the guard on the ${on}: ${soleNow.first} in front by ${now.gap}, ${soleBefore.first} looking for answers.`, `${soleNow.first} has the lead, ${now.gap} clear. It happened on the ${on}, at ${soleBefore.first}'s expense.`, `There's a new name at the top. ${soleNow.first} takes the lead from ${soleBefore.first} on the ${on}, ${now.gap} in front.`, `The ${on} flips it. ${soleNow.first} leads by ${now.gap}, and ${soleBefore.first} is doing the chasing now.`,
        ])
      : pick([
          `${soleNow.first} breaks the tie on the ${on} with ${mine(soleNow)}, and leads by ${now.gap}.`,
          `The deadlock is over. ${soleNow.first} makes ${mine(soleNow)} on the ${on} to go ${now.gap} in front.`,
          `Somebody finally blinked. ${soleNow.first} takes the lead on the ${on}, ${now.gap} clear.`,
          `${soleNow.first} gets separation on the ${on}: ${mine(soleNow)}, and a lead of ${now.gap}.`, `No more sharing. ${soleNow.first} goes ${now.gap} clear on the ${on} with ${mine(soleNow)}.`, `${soleNow.first} has the lead alone after ${mine(soleNow)} on the ${on}. ${cap(words(now.gap))} in front.`, `The tie is broken on the ${on}, and ${soleNow.first} is the one who broke it, ${now.gap} up.`,
        ])
  }
  if (!soleNow && soleBefore) {
    const catchers = now.leaders.filter((p) => p.id !== soleBefore.id)
    return pick([
      `${listOf(catchers.map((p) => p.first))} ${catchers.length === 1 ? 'has' : 'have'} caught ${soleBefore.first} on the ${on}. All square at the top.`,
      `The lead is gone. ${soleBefore.first} makes ${mine(soleBefore)} on the ${on}, and ${listOf(catchers.map((p) => p.first))} ${catchers.length === 1 ? 'pulls' : 'pull'} level.`,
      `We're tied. ${listOf(catchers.map((p) => p.first))} ${catchers.length === 1 ? 'draws' : 'draw'} level with ${soleBefore.first} on the ${on}.`, `${soleBefore.first}'s lead is history. All level after the ${on}, with ${listOf(catchers.map((p) => p.first))} alongside.`, `It's a tie at the top after the ${on}. ${soleBefore.first} could not hold off ${listOf(catchers.map((p) => p.first))}.`,
    ])
  }
  const was = prev ? prev.gap : 0
  if (soleNow && zeros.some((p) => p.id === soleNow.id) && now.gap < was)
    return pick([
      `A crack in the armor. ${soleNow.first} takes a zero on the ${on}, and the lead is down to ${now.gap}.`,
      `${soleNow.first} gives some back: a zero on the ${on}. The lead shrinks from ${was} to ${now.gap}.`,
      `The door is open. ${soleNow.first} takes a zero on the ${on}, and it's a ${now.gap}-point game.`,
      `${soleNow.first} blinks on the ${on}. Zero points, and the lead is ${now.gap}.`, `Trouble for the leader. ${soleNow.first} comes up empty on the ${on}, and the gap is ${now.gap}.`, `${soleNow.first} leaves the ${on} with nothing, and a lead cut to ${now.gap}.`, `A stumble from ${soleNow.first} on the ${on}: a zero, and the lead drops from ${was} to ${now.gap}.`,
    ])
  if (outright && best.pts >= 3) {
    const tail = !soleNow
      ? `${lead}.`
      : best.p.id === soleNow.id
        ? now.gap > was
          ? `The lead grows to ${now.gap}.`
          : `${lead}.`
        : now.gap < was
          ? `That cuts ${soleNow.first}'s lead to ${now.gap}.`
          : `${soleNow.first} still leads by ${now.gap}.`
    return `${pick([
      `${best.p.first} wins the ${on} outright with ${made(best)}.`,
      `The ${on} belongs to ${best.p.first}: ${made(best)}, best in the group.`,
      `${best.p.first} takes the ${on} with ${made(best)}. Nobody else could match it.`,
      `${cap(made(best))} for ${best.p.first} on the ${on}, and that wins the hole.`,
      `Nice hole from ${best.p.first} on the ${on}: ${made(best)}.`, `${best.p.first} was the only one to solve the ${on}: ${made(best)}.`, `Hole to ${best.p.first}. ${cap(made(best))} on the ${on}.`, `${best.p.first} picks the ${on} clean with ${made(best)}.`, `The best of the ${on} was ${best.p.first}, with ${made(best)}.`,
    ])} ${tail}`
  }
  if (soleNow && Math.abs(now.gap - was) >= 2)
    return now.gap > was
      ? pick([`${soleNow.first} stretches it on the ${on}. The lead goes from ${was} to ${now.gap}.`, `More breathing room for ${soleNow.first} after the ${on}: ${now.gap} clear, up from ${was}.`, `${soleNow.first} pulls away a little on the ${on}. It's ${now.gap} now.`, `The gap widens on the ${on}: ${soleNow.first} by ${now.gap}, up from ${was}.`, `${soleNow.first} adds to the lead on the ${on}. It was ${was}, and it's ${now.gap}.`])
      : pick([`The chase is on. ${soleNow.first}'s lead is cut from ${was} to ${now.gap} on the ${on}.`, `${soleNow.first}'s cushion shrinks on the ${on}, from ${was} to ${now.gap}.`, `Things tighten up on the ${on}. ${soleNow.first} leads by ${now.gap}, down from ${was}.`, `${soleNow.first}'s lead takes a hit on the ${on}: ${was} down to ${now.gap}.`, `A little pressure now. The lead goes from ${was} to ${now.gap} on the ${on}.`])
  if (!skipZeros && zeros.length > 0 && zeros.length < rows.length)
    return pick([
      `${listOf(zeros.map((p) => p.first))} ${zeros.length === 1 ? 'takes a zero' : 'take zeros'} on the ${on}. ${lead}.`,
      `A zero on the ${on} for ${listOf(zeros.map((p) => p.first))}. ${lead}.`,
      `The ${on} bites ${listOf(zeros.map((p) => p.first))}: no points. ${lead}.`, `Nothing on the ${on} for ${listOf(zeros.map((p) => p.first))}. ${lead}.`, `${listOf(zeros.map((p) => p.first))} ${zeros.length === 1 ? 'walks' : 'walk'} off the ${on} empty-handed. ${lead}.`,
    ])
  return ''
}

function storyLine(e: StoryEntry): string {
  const text = e.segs.map((s) => s.text).join('').trim()
  if (e.kind === 'turn') return e.scoreline ? `At the turn, it's ${e.scoreline}.` : ''
  if (e.kind === 'partial') return `On the ${e.label}, ${text.replace(/ in([:.]) ?/, ' are in. ')}`
  const where = e.label.includes('–') ? `From the ${e.label.replace('–', ' to the ')}` : `On the ${e.label}`
  // "The hole that broke it open: …" already has its own colon.
  return text.includes(':') ? `${where}. ${text}` : `${where}: ${text}`
}

/** The front nine (at the turn) or the last nine holes (from the 12th on). */
function stretchReview(c: Ctx, phase: CallPhase, pick: Pick): string[] {
  const from = phase === 'turn' ? 1 : c.complete - 8
  const to = c.complete
  if (phase !== 'turn' && c.complete < 12) return []
  const span = phase === 'turn' ? 'On the front nine' : 'Over the last nine holes'
  const rows = c.players.map((p) => ({ p, s: pts(p, from, to), z: zerosIn(p, from, to), b: realBirdiesIn(p, from, to) })).sort((a, b) => b.s - a.s)
  const hot = rows.filter((r) => r.s === rows[0].s)
  const cold = rows[rows.length - 1]
  const lines: string[] = []
  if (hot.length === 1) {
    lines.push(
      pick([
        `${span}, ${hot[0].p.first} has been the best player on property, with ${hot[0].s} points.`,
        `${span}, nobody has been better than ${hot[0].p.first}: ${hot[0].s} points.`,
        `${span}, ${hot[0].p.first} leads the way with ${hot[0].s} points. Somebody check that scorecard.`,
        `${span}, ${hot[0].p.first} has been the hottest player out here, ${hot[0].s} points.`,
        `${span}, the story is ${hot[0].p.first}: ${hot[0].s} points and a whole lot of swagger.`,
        `${span}, ${hot[0].p.first} has piled up ${hot[0].s} points. Nobody else is close to that pace.`,
        `${span}, ${hot[0].p.first} has been playing a different golf course. ${hot[0].s} points.`,
        `${span}, ${hot[0].p.first} has the most points, ${hot[0].s}.`,
        `${span}, the pace-setter has been ${hot[0].p.first}, with ${hot[0].s} points.`,
        `${span}, ${hot[0].p.first} has been the one to watch, ${hot[0].s} points.`,
        `${span}, ${hot[0].p.first} has done the damage: ${hot[0].s} points.`,
        `${span}, ${hot[0].p.first} has been dialed in, ${hot[0].s} points.`,
        `${span}, ${hot[0].s} points for ${hot[0].p.first}. Best in the group.`,
        `${span}, ${hot[0].p.first} has been the class of the field with ${hot[0].s} points.`,
        `${span}, ${hot[0].p.first} has ${hot[0].s} points and the rest of the group's full attention.`,
        `${span}, the hot hand belongs to ${hot[0].p.first}: ${hot[0].s} points.`,
        `${span}, ${hot[0].p.first} has outscored everybody, ${hot[0].s} points.`,
        `${span}, ${hot[0].p.first} has been making it look easy. ${hot[0].s} points.`,
      ]),
    )
  } else {
    lines.push(
      pick([
        `${span}, ${listOf(hot.map((r) => r.p.first))} have shared the honors with ${hot[0].s} points each.`,
        `${span}, it's a dead heat between ${listOf(hot.map((r) => r.p.first))}, ${hot[0].s} points apiece.`,
        `${span}, ${listOf(hot.map((r) => r.p.first))} can't be separated: ${hot[0].s} points each.`,
        `${span}, ${listOf(hot.map((r) => r.p.first))} on ${hot[0].s} each. Matching outfits next.`,
        `${span}, a share of the honors for ${listOf(hot.map((r) => r.p.first))}, ${hot[0].s} apiece. Nobody blink.`,
        `${span}, ${listOf(hot.map((r) => r.p.first))} have matched each other, ${hot[0].s} points apiece.`,
        `${span}, the honors are split: ${listOf(hot.map((r) => r.p.first))}, ${hot[0].s} each.`,
        `${span}, ${listOf(hot.map((r) => r.p.first))} are stride for stride, ${hot[0].s} points each.`,
        `${span}, nothing between ${listOf(hot.map((r) => r.p.first))}. ${hot[0].s} apiece.`,
        `${span}, ${listOf(hot.map((r) => r.p.first))} top the charts together on ${hot[0].s}.`,
      ]),
    )
  }
  if (cold.s < rows[0].s && !hot.includes(cold)) {
    const z = cold.z >= 3 ? `, including ${words(cold.z)} zeros` : ''
    const quip = cold.z >= 3 ? pick([
            ` Somebody get ${cold.p.first} a drink.`,
            ` ${cold.p.first} would like to speak to a manager.`,
            ' It has not been pretty.',
            ` ${cold.p.first} has been searching for answers, and also golf balls.`,
            ' We will not be showing the highlights.',
            ` The good news for ${cold.p.first}: it can't get much worse. The bad news: it has before.`,
            ` ${cold.p.first} is considering a career in tennis.`,
            ` ${cold.p.first} is now playing for the stories.`,
            ` Somebody check on ${cold.p.first}.`,
            ` ${cold.p.first} has seen more sand than a beach towel.`,
            ' The swing coach has been notified.',
            ` ${cold.p.first} is hoping the next nine has a sense of humor.`,
            ` A moment of silence for ${cold.p.first}'s scorecard.`,
            ` ${cold.p.first} would like the record to show the greens are very fast.`,
            '',
            '',
            '',
            '',
            '',
            '',
          ]) : ''
    lines.push(
      phase === 'turn'
        ? `${cold.p.first} brought up the rear with ${cold.s}${z}.${quip}`
        : `${cold.p.first} has ${cold.s} in that stretch${z}.${quip}`,
    )
  }
  const birdieMan = rows.filter((r) => r.b >= 2).sort((a, b) => b.b - a.b)[0]
  if (birdieMan) {
    lines.push(
      hot.length === 1 && birdieMan.p.id === hot[0].p.id
        ? pick([
            `That includes ${words(birdieMan.b)} true birdies. Actual birdies. On the card.`,
            `${cap(words(birdieMan.b))} of those were true birdies. No strokes needed.`,
            `And ${words(birdieMan.b)} true birdies in there. The handicap committee has been notified.`,
            `${cap(words(birdieMan.b))} true birdies in there, too. Sandbaggers, take note.`,
            `That includes ${words(birdieMan.b)} true birdies, which, for this group, is basically witchcraft.`,
            `That includes ${words(birdieMan.b)} true birdies.`,
            `Including ${words(birdieMan.b)} true birdies. No help from the handicap.`,
            `${cap(words(birdieMan.b))} true birdies in that haul. Gross, not net.`,
            `And ${words(birdieMan.b)} of them true birdies. Somebody frame the card.`,
            `With ${words(birdieMan.b)} true birdies mixed in. Witnesses available on request.`,
            `${cap(words(birdieMan.b))} true birdies in there. That's not sandbagging, that's just golf.`,
            `Including ${words(birdieMan.b)} true birdies.`,
          ])
        : pick([
            `${birdieMan.p.first} has ${words(birdieMan.b)} true birdies in that stretch. Actual birdies. On the card.`,
            `${birdieMan.p.first} has made ${words(birdieMan.b)} true birdies in that stretch. Somebody check the handicap.`,
            `${cap(words(birdieMan.b))} true birdies for ${birdieMan.p.first} in that stretch. Gross birdies. With witnesses.`,
            `${birdieMan.p.first} has ${words(birdieMan.b)} true birdies in that stretch. Somebody revisit that index.`,
            `${birdieMan.p.first} has chipped in ${words(birdieMan.b)} true birdies over that stretch. Gross birdies, too.`,
            `${cap(words(birdieMan.b))} true birdies for ${birdieMan.p.first} in that stretch. No strokes required.`,
            `${birdieMan.p.first} has ${words(birdieMan.b)} true birdies over that stretch. The index is looking nervous.`,
            `${birdieMan.p.first} made ${words(birdieMan.b)} true birdies in that stretch.`,
          ]),
    )
  }
  if (phase === 'turn') {
    const b = board(c, 9)
    const board9 = b.rows.map((r) => `${r.p.first} ${r.s}`).join(', ')
    lines.push(pick([`At the turn, it's ${board9}.`, `The board at the turn: ${board9}.`, `Halfway scores: ${board9}.`, `Your halftime scores: ${board9}. Some of those are better than others.`, `Scores at the turn: ${board9}.`, `Halfway home, it's ${board9}.`, `The front nine totals: ${board9}.`, `Nine down, and the board reads ${board9}.`]))
  }
  return lines
}

/** The turn as a halftime show: the play of the front nine, report cards, and who needs a back nine. */
function halftime(c: Ctx, pick: Pick): string[] {
  const out: string[] = []
  // Play of the front nine.
  const RANK: Record<string, number> = { ace: 300, albatross: 120, eagle: 100, birdieNetEagle: 50, netEagle: 40 }
  let best: { p: Pl; hole: number; kind: string; rank: number } | null = null
  for (const p of c.players)
    for (let h = 1; h <= 9; h++) {
      const kind = shotOf(p.holes.get(h))
      const rank = kind ? (RANK[kind] ?? 0) + (p.holes.get(h)?.points ?? 0) : 0
      if (kind && rank >= 40 && (!best || rank > best.rank)) best = { p, hole: h, kind, rank }
    }
  if (best) {
    const par = c.holes.find((x) => x.holeNumber === best!.hole)?.par ?? 4
    out.push(
      `${pick(['Play of the front nine:', 'Highlight of the half:', 'Best shot of the front side:', 'Your halftime highlight:', 'The one from the front nine worth a replay:', 'Shot of the half:', 'Front nine play of the day:'])} ${best.p.first}, ${SHOT[best.kind].noun} on the par-${par} ${ordinalOf(best.hole)}.${pick([' Roll that one again.', ' That will play at dinner.', ' Still the shot to beat.', ' Nothing else on the front came close.', ' The back nine has something to live up to.', '', ''])}`,
    )
  }
  // Report cards: net par for nine holes is 18 points.
  const grade = (s: number) => (s >= 22 ? 'an A' : s >= 19 ? 'a B' : s >= 16 ? 'a C' : s >= 12 ? 'a D' : 'an F')
  const b = board(c, 9)
  const cards = b.rows.map((r, i) => (i === 0 ? `${r.p.first} gets ${grade(r.s)}` : `${r.p.first}, ${grade(r.s)}`)).join('. ')
  out.push(
    `${pick(['Halftime report cards.', 'Front nine grades.', 'The halftime report card.', 'Grades for the front nine.', 'Time for report cards.', 'Midterm grades are in.', 'The front nine, graded.'])} ${cards}.${pick([' Parents will be notified.', ' See me after class.', ' The curve was generous.', ' No extra credit available.', ' Grades are final. Appeals go to the nineteenth hole.', ' Summer school starts on the 10th.', ' Some of you are grounded.', ' Tutoring is available on the range.', ' The teacher is disappointed, not angry.', ''])}`,
  )
  // The one who needs the back nine most.
  const last = b.rows[b.rows.length - 1]
  if (b.spread >= 8 && c.players.length > 2 && !b.leaders.includes(last.p))
    out.push(
      pick([
        `${last.p.first} is ${b.spread} back and needs the back nine of a lifetime. Or a very good dinner.`,
        `${last.p.first}, ${b.spread} behind, is going to need some help. A lot of help.`,
        `Down ${b.spread} at the half, ${last.p.first} is officially playing for pride, and closest to the pins.`,
        `${cap(words(b.spread))} back at the turn for ${last.p.first}. The comeback starts on the 10th, or it doesn't start.`, `${last.p.first} trails by ${b.spread}. Mathematically alive. Emotionally, less so.`, `For ${last.p.first}, ${b.spread} back, the back nine is about dignity now.`, `${last.p.first} is ${b.spread} behind and running out of golf course.`,
      ]),
    )
  return out
}

/** One or two of the best side stories, never the same player twice. */
function colorNotes(c: Ctx, pick: Pick, max: number): string[] {
  const notes: { who: string; rank: number; text: string }[] = []
  const h = c.complete
  for (const p of c.players) {
    // A run of zeros, live right now.
    let zr = 0
    while (zr < h && (p.holes.get(h - zr)?.points ?? 1) === 0) zr++
    if (zr >= 2) {
      notes.push({
        who: p.id,
        rank: 6 + zr,
        text: pick([
          `${p.first} has taken zeros on ${words(zr)} straight holes. Thoughts and prayers.`,
          `That's ${words(zr)} zeros in a row for ${p.first}. The walk to the next tee has gone very quiet.`,
          `${p.first} has blanked ${words(zr)} straight. Someone hide the sharp objects.`,
          `${cap(words(zr))} straight zeros for ${p.first}. At this point the scorecard is just a suggestion.`,
          `${p.first} has gone ${words(zr)} holes without a point. Search parties have been organized.`,
          `${p.first}: ${words(zr)} holes, zero points. The golf ball has filed a missing persons report.`,
          `That's ${words(zr)} in a row with nothing for ${p.first}. Even the birds have stopped chirping.`,
          `${p.first} has gone ${words(zr)} straight holes without a point.`,
          `${cap(words(zr))} zeros in a row now for ${p.first}.`,
          `${p.first} is looking for a point after ${words(zr)} straight zeros.`,
          `${p.first} has come up empty on ${words(zr)} straight. The golf gods are not answering.`,
          `${cap(words(zr))} straight zeros for ${p.first}. Somebody find the lost swing.`,
          `${p.first} is in a ${words(zr)}-hole drought. Rain dance recommended.`,
          `Nothing for ${p.first} on the last ${words(zr)} holes. The card has gone quiet.`,
          `${p.first} has posted zero on ${words(zr)} in a row. A rough patch, said kindly.`,
          `${cap(words(zr))} holes, no points for ${p.first}. The bounce-back is due. Overdue, really.`,
          `${p.first} hasn't scored in ${words(zr)} holes. The group is pretending not to notice.`,
          `${p.first} has gone ${words(zr)} straight without a point.`,
          `No points for ${p.first} over the last ${words(zr)} holes.`,
          `${p.first} has ${words(zr)} zeros in a row and needs a point.`,
        ]),
      })
    }
    // No zero at all, deep into the round.
    const zeros = zerosIn(p, 1, h)
    if (zeros === 0 && h >= 8) {
      notes.push({
        who: p.id,
        rank: 7,
        text: pick([
          `${p.first} has not taken a single zero all day. Not one. Through ${h}.`,
          `Through ${h}, ${p.first} has put a point on the board on every single hole. Every one.`,
          `Zero zeros for ${p.first} through ${h}. That's the stat of the day.`,
          `${p.first} hasn't blanked a hole all day. Steady as a metronome.`,
          `Through ${h}, not one zero for ${p.first}. Somebody check ${p.first}'s pockets for a rangefinder and a lucky charm.`,
          `${p.first} has a point on every hole through ${h}. Boring golf. Beautiful golf.`,
          `${p.first} has scored on every hole so far, through ${h}.`,
          `${p.first} has a point on every hole through ${h}. Not a single blank.`,
          `Through ${h}, ${p.first} hasn't wasted a hole. Points on all of them.`,
          `Still no zeros for ${p.first}, through ${h}. Consistency, thy name is ${p.first}.`,
          `${p.first} has been bulletproof: no zeros through ${h}.`,
          `Through ${h}, ${p.first} has scored on every single hole. The rest of the group would like to know the secret.`,
          `${p.first} is perfect on the zeros front, none through ${h}.`,
          `No zeros yet for ${p.first}, through ${h}.`,
        ]),
      })
    } else {
      let run = 0
      while (run < h && (p.holes.get(h - run)?.points ?? 0) > 0) run++
      if (run >= 6 && run < h)
        notes.push({
          who: p.id,
          rank: 5,
          text: pick([
            `${p.first} hasn't taken a zero since the ${ordinalOf(h - run)}. ${cap(words(run))} straight holes on the board.`,
            `${cap(words(run))} straight holes with a point for ${p.first}, all the way back to the ${ordinalOf(h - run + 1)}.`,
            `${p.first} has found something. ${cap(words(run))} holes in a row on the board.`,
            `${cap(words(run))} straight holes with a point for ${p.first}. Whatever was in that sandwich, keep eating it.`,
            `${p.first} has scored on ${words(run)} straight holes. Something has clicked.`,
            `${cap(words(run))} holes in a row with points for ${p.first}. The zeros are a distant memory.`,
            `Since the ${ordinalOf(h - run)}, ${p.first} has been on the board every hole. ${cap(words(run))} straight.`,
            `${p.first} has a point on ${words(run)} straight holes.`,
          ]),
        })
    }
    // Hot hand.
    if (h >= 3) {
      const last3 = pts(p, h - 2, h)
      if (last3 >= 9) notes.push({ who: p.id, rank: 8, text: pick([
            `${p.first} is on fire: ${last3} points over the last three holes.`,
            `${p.first} has ${last3} points in the last three holes. Somebody check for a heartbeat.`,
            `${last3} points in three holes for ${p.first}. Heating up doesn't cover it.`,
            `${p.first} is in the zone. ${last3} points over the last three.`,
            `Get the fire extinguisher. ${p.first} has ${last3} points in the last three holes.`,
            `${last3} points in three holes for ${p.first}. Nobody say anything. Nobody touch anything.`,
            `${p.first} has ${last3} points over the last three holes.`,
            `A strong run from ${p.first}: ${last3} points in the last three.`,
            `${p.first} has rattled off ${last3} points in three holes. Hide the scorecard from the handicap committee.`,
            `${last3} points in the last three for ${p.first}. That's a heater.`,
            `${p.first} is rolling: ${last3} points over the last three.`,
            `Three holes, ${last3} points for ${p.first}. Somebody bottle that.`,
            `${p.first} has caught fire, ${last3} points in three holes.`,
            `${last3} points over three holes for ${p.first}. Don't talk to ${p.first}. Don't even make eye contact.`,
            `${p.first} has ${last3} points across the last three holes.`,
            `A hot stretch for ${p.first}, ${last3} points in three.`,
          ]) })
    }
    // Net par machine.
    if (h >= 4 && [0, 1, 2, 3].every((k) => (p.holes.get(h - k)?.points ?? -1) === 2)) {
      notes.push({
        who: p.id,
        rank: 3,
        text: pick([
          `${p.first} has made net par on four straight holes. Boring. Brutally effective.`,
          `Four straight net pars for ${p.first}. Like watching paint dry, and the paint is winning.`,
          `${p.first} is grinding: net par, net par, net par, net par.`,
          `Four net pars in a row for ${p.first}. Not flashy, but the accountant in all of us approves.`,
          `${p.first} has gone net par four straight times. The fans are asleep. The scorecard is thrilled.`,
          `${p.first} has strung together four straight net pars. Steady as a fence post.`,
          `Net par, four times running, for ${p.first}. Nobody is writing songs about it, but it adds up.`,
          `${p.first} has gone four for four on net pars. Fairway, green, two putts, repeat.`,
          `Four in a row at net par for ${p.first}. The definition of not beating yourself.`,
          `${p.first} has made four straight net pars.`,
        ]),
      })
    }
    // True eagles today.
    for (let q = 1; q <= h; q++) {
      const kind = shotOf(p.holes.get(q))
      if (kind === 'ace') {
        // A hole in one never becomes a footnote: it stays in the call for the rest of the round.
        const fresh = q >= h - 2
        notes.push({
          who: p.id,
          rank: fresh ? 20 : 8,
          text: fresh
            ? pick([
                `We are still not over it. ${p.first} made a hole in one on the ${ordinalOf(q)}. A hole in one!`,
                `In case anyone forgot, and nobody has: ${p.first}, hole in one, the ${ordinalOf(q)}.`,
                `The buzz has not died down. ${p.first} aced the ${ordinalOf(q)}, and the drinks tonight are on ${p.first}. That's the rule.`,
                `Nobody has stopped talking about it. ${p.first}. The ${ordinalOf(q)}. One swing. In the hole.`,
              ])
            : pick([
                `A reminder that ${p.first} made a hole in one on the ${ordinalOf(q)} today. ${p.first} will be reminding everyone for the rest of time.`,
                `And yes, ${p.first} still has a hole in one on the card, from the ${ordinalOf(q)}.`,
                `Lest we forget: ${p.first}, a hole in one, the ${ordinalOf(q)}. Drinks are on ${p.first} tonight.`,
                `${p.first}'s hole in one on the ${ordinalOf(q)} is still the only thing anybody wants to talk about.`,
                `Somewhere back on the ${ordinalOf(q)}, there is a ball mark one foot from the hole and no ball. ${p.first} made a hole in one.`,
              ]),
        })
        break
      }
      if (kind === 'eagle' || kind === 'albatross') {
        // Fresh, it's the headline; hours later, a footnote.
        const fresh = q >= h - 2
        notes.push({
          who: p.id,
          rank: fresh ? 9 : 2,
          text: fresh
            ? pick([
                `Let's talk about that true ${kind} from ${p.first} on the ${ordinalOf(q)}. Frame that scorecard.`,
                `We have to go back to the ${ordinalOf(q)}: a true ${kind} from ${p.first}. Not net. A true one.`,
                `A true ${kind} for ${p.first} on the ${ordinalOf(q)}. Somebody get a photo of that card.`,
                `Stop everything. ${p.first} made a true ${kind} on the ${ordinalOf(q)}.`,
                `A true ${kind} for ${p.first} on the ${ordinalOf(q)}. The drinks are on ${p.first}. That's the rule now.`,
                `The shot of the day so far: a true ${kind} from ${p.first} on the ${ordinalOf(q)}.`,
                `Hold the phone. A true ${kind} for ${p.first} on the ${ordinalOf(q)}.`,
                `${p.first} just made a true ${kind} on the ${ordinalOf(q)}. No strokes. No asterisk.`,
                `The ${ordinalOf(q)} belongs to ${p.first}: a true ${kind}. Somebody alert the local paper.`,
                `A true ${kind}, ${p.first}, the ${ordinalOf(q)}. Say it again. A true ${kind}.`,
                `Big news from the ${ordinalOf(q)}: ${p.first} with a true ${kind}. That's going in the trip history.`,
                `${p.first} made a true ${kind} on the ${ordinalOf(q)}.`,
              ])
            : pick([
                `Never forget: ${p.first} made a true ${kind} on the ${ordinalOf(q)}.`,
                `And for the record, ${p.first} still has that true ${kind} from the ${ordinalOf(q)}.`,
                `A reminder, in case ${p.first} hasn't mentioned it in the last five minutes: a true ${kind} on the ${ordinalOf(q)}.`,
                `Still talking about ${p.first}'s true ${kind} on the ${ordinalOf(q)}. We'll be talking about it all week.`,
                `Lest anyone forget, ${p.first} made a true ${kind} on the ${ordinalOf(q)}.`,
                `${p.first}'s true ${kind} on the ${ordinalOf(q)} is still the shot everyone is talking about.`,
              ]),
        })
        break
      }
    }
    // Pick-ups.
    let ups = 0
    for (let q = 1; q <= h; q++) if (p.holes.get(q)?.pickedUp) ups++
    if (ups >= 2)
      notes.push({
        who: p.id,
        rank: 4,
        text: pick([
          `${p.first} has picked up ${words(ups)} times today. Efficient, if nothing else.`,
          `${cap(words(ups))} pick-ups for ${p.first}. The ball keeps ending up in ${p.first}'s pocket.`,
          `${p.first} has picked up ${words(ups)} times. Pace of play has never been better.`,
          `${cap(words(ups))} pick-ups for ${p.first}. The marshals would like to thank ${p.first} personally.`,
          `${p.first} has picked up ${words(ups)} times today. Discretion is the better part of valor.`,
          `${p.first} has picked up on ${plural(ups, 'hole')} today.`,
          `${p.first} has scooped up the ball ${words(ups)} times today. Keeping things moving.`,
          `${cap(words(ups))} pick-ups for ${p.first}. Knowing when to fold them is a skill.`,
          `${p.first} has pocketed the ball ${words(ups)} times. Pace of play thanks ${p.first}.`,
          `${p.first}, ${words(ups)} pick-ups and counting. The group behind is grateful.`,
          `${cap(words(ups))} times today, ${p.first} has picked up and moved on. Healthy, honestly.`,
          `${p.first} has ${words(ups)} pick-ups today.`,
        ]),
      })
  }
  // Closest to the pin.
  const ctp = new Map<string, number>()
  for (const r of c.db.ctp_results) if (r.round_id === c.detail.round.id && r.player_id && r.hole_number <= h) ctp.set(r.player_id, (ctp.get(r.player_id) ?? 0) + 1)
  for (const [id, k] of ctp) {
    const p = c.players.find((x) => x.id === id)
    // CTP is paid outside the app (Kyle 2026-10-11), so it's money, just not on the books.
    if (p && k >= 2) {
      notes.push({
        who: id,
        rank: 4,
        text: pick([
          `${p.first} has ${words(k)} closest to the pins today. That's real money, settled in the parking lot.`,
          `${p.first} has won ${words(k)} closest to the pins. ${p.first} may not be winning the round, but ${p.first} is getting paid.`,
          `${cap(words(k))} closest to the pins for ${p.first}. The par 3s belong to ${p.first}.`,
          `${p.first} owns the par 3s today: ${words(k)} closest to the pins. Cash, please.`,
          `${cap(words(k))} closest to the pins for ${p.first}. Forget the round, ${p.first} is running a side business.`,
          `${p.first} has won ${words(k)} closest to the pins today.`,
          `${p.first} has ${words(k)} closest to the pins today. Somebody's buying the first round, and it's ${p.first}.`,
          `${cap(words(k))} closest to the pins for ${p.first}. A certified dart thrower.`,
          `${p.first} is collecting closest to the pins like souvenirs: ${words(k)} today.`,
          `${p.first} has stuck it close ${words(k)} times on the par 3s. Cash, settled later.`,
          `${cap(words(k))} closest to the pins for ${p.first}, paid off the books.`,
          `${p.first} has ${words(k)} closest to the pins so far today.`,
        ]),
      })
    }
  }
  const out: string[] = []
  const used = new Set<string>()
  for (const note of notes.sort((a, b) => b.rank - a.rank)) {
    if (used.has(note.who)) continue
    used.add(note.who)
    out.push(note.text)
    if (out.length >= max) break
  }
  return out
}

/** Who's winning today, by how much, how much is left, and what it pays. */
function roundStakes(c: Ctx, pick: Pick): string[] {
  const b = board(c, c.complete)
  const left = c.n - c.complete
  const lines: string[] = []
  if (b.leaders.length > 1) {
    lines.push(
      b.leaders.length === c.players.length
        ? pick([
            `And get this: all ${words(c.players.length)} are dead level on ${b.top}. You cannot script this.`,
            `It's all square. Everybody on ${b.top}. Total chaos.`,
            `All ${words(c.players.length)} tied on ${b.top}. Nobody wants it, or everybody does.`,
            `Dead heat. All ${words(c.players.length)} on ${b.top}. Good thing there's a tiebreaker this year.`,
            `All ${words(c.players.length)} level on ${b.top}. This is either great golf or equally bad golf. We'll let you decide.`,
            `All ${words(c.players.length)} are level on ${b.top}.`,
            `Everybody is on ${b.top}. You could not draw it up any tighter.`,
            `All ${words(c.players.length)} level on ${b.top}. Nobody has blinked yet.`,
            `It's a ${words(c.players.length)}-way tie at ${b.top}. Chaos reigns.`,
            `The whole field is on ${b.top}. Every hole from here is a playoff.`,
            `All square, everybody on ${b.top}. The tension is excellent. The golf, debatable.`,
            `Everybody has ${b.top}.`,
          ])
        : pick([
            `At the top, it's dead level: ${listOf(b.leaders.map((p) => p.first))} on ${b.top}, ${words(left)} to play.`,
            `${listOf(b.leaders.map((p) => p.first))} are tied at ${b.top}. Nobody blinks.`,
            `${listOf(b.leaders.map((p) => p.first))}, level on ${b.top}. Relax, there's a tiebreaker this year. Kyle made sure of it.`,
            `It's a tie at the top, ${listOf(b.leaders.map((p) => p.first))} on ${b.top}, with ${words(left)} to play.`,
            `${listOf(b.leaders.map((p) => p.first))} share the lead on ${b.top}, ${words(left)} to play.`,
            `Co-leaders: ${listOf(b.leaders.map((p) => p.first))}, each on ${b.top}.`,
            `${listOf(b.leaders.map((p) => p.first))} are locked together at ${b.top}. Somebody has to blink.`,
            `Nothing between ${listOf(b.leaders.map((p) => p.first))} at the top, ${b.top} each, ${words(left)} left.`,
          ]),
    )
  } else {
    const L = b.leaders[0].first
    const S = b.chaser!.first
    if (b.gap <= 2) {
      lines.push(
        pick(
          left <= 4
            ? [
                `${L} leads ${S} by ${b.gap} with ${words(left)} to play. This one's going to the wire.`,
                `${L} by ${b.gap} over ${S}, ${words(left)} left. Nobody is breathing.`,
                `${b.gap} points. ${cap(words(left))} holes. ${L} and ${S}. Get the popcorn.`,
                `${L} clings to a ${b.gap} point lead over ${S}, ${words(left)} to go. Squeaky time.`,
                `${L} by ${b.gap}, ${S} in pursuit, ${words(left)} to go. Somebody's going to need a drink after this, either way.`,
                `${b.gap} between ${L} and ${S}, ${words(left)} to play. Hold your breath.`,
                `${L} by ${b.gap}, but ${S} is right on the shoulder with ${words(left)} left.`,
                `${L} has a ${b.gap} point edge on ${S}, ${words(left)} holes to hold it.`,
                `It's ${L} by ${b.gap} over ${S}, and ${words(left)} holes to settle it.`,
                `${L} leads ${S} by ${b.gap}, ${words(left)} to go. Nobody look at the scorecard.`,
              ]
            : [
                `${L} leads ${S} by ${b.gap}, with ${words(left)} to play. Anything can happen.`,
                `It's ${L} by a nose: ${b.gap} clear of ${S}, ${words(left)} to go.`,
                `${L} is in front, but ${S} is right there, ${b.gap} back with ${words(left)} to play.`,
                `Tight one. ${L} by ${b.gap} over ${S}, ${words(left)} holes left.`,
                `${L} leads ${S} by ${b.gap}. That's one bad bounce, ${words(left)} holes to find it.`,
                `${L} leads by ${b.gap} over ${S}, ${words(left)} to play.`,
                `${L} is ${b.gap} up on ${S} with ${words(left)} to play. Plenty of golf left.`,
                `${L} edges ${S} by ${b.gap}. ${cap(words(left))} holes is a long time.`,
                `Just ${b.gap} between ${L} and ${S}, ${words(left)} to play.`,
                `${L} has the slimmest of leads, ${b.gap} over ${S}.`,
                `${L} leads, ${S} trails by ${b.gap}, and there are ${words(left)} holes for that to change.`,
                `${L} is ahead of ${S} by ${b.gap}.`,
              ],
        ),
      )
    } else if (b.gap <= 6) {
      lines.push(
        pick([
          `${L} leads by ${b.gap} over ${S}, ${words(left)} to play. Not safe. Not even close to safe.`,
          `${L} is ${b.gap} clear of ${S} with ${words(left)} left. Comfortable, but this group has blown bigger leads before breakfast.`,
          `${L} has a ${b.gap} point cushion over ${S}, ${words(left)} to play. Cushions deflate.`,
          `${L} by ${b.gap}. ${S} needs a run, and ${words(left)} holes to find one.`,
          `${L} leads by ${b.gap}. ${S} is doing the math, and so is ${L}.`,
          `${L} leads by ${b.gap}, with ${S} next, ${words(left)} to play.`,
          `${L} has a ${b.gap} point lead on ${S}. A good start, not a finish.`,
          `${L} by ${b.gap} over ${S}, ${words(left)} to play. ${S} needs a couple of good holes.`,
          `${L} is ${b.gap} up, and ${S} is the one giving chase.`,
          `${L} holds a ${b.gap} point lead over ${S}, ${words(left)} holes to protect it.`,
          `${b.gap} points separate ${L} and ${S}. Close enough to feel it, far enough to worry.`,
          `${L} leads ${S} by ${b.gap}, ${words(left)} to go.`,
        ]),
      )
    } else if (b.gap > 2 * left) {
      lines.push(
        pick([
          `${L} leads by ${b.gap} with ${words(left)} to play. Somebody start engraving.`,
          `${L} is ${b.gap} clear with ${words(left)} left. The rest are playing for pride, and there isn't much of that left either.`,
          `${L} by ${b.gap} with ${words(left)} to go. This one is over, unless it isn't.`,
          `${b.gap} points with ${words(left)} left. ${L} could walk in from here.`,
          `${L} by ${b.gap}, ${words(left)} to play. The only thing that can stop ${L} now is a lightning delay.`,
          `${L} leads by ${b.gap} with ${words(left)} to play. It would take something special to catch ${L}.`,
          `${L} is ${b.gap} clear with ${words(left)} left. Start the engraving. Lightly, in pencil.`,
          `${b.gap} points up, ${words(left)} to play. ${L} can see the finish line from here.`,
          `${L} has this one in hand, ${b.gap} clear with ${words(left)} to go.`,
          `${L} leads by ${b.gap}. The math says it's over. The group says nothing is over.`,
          `${L} by ${b.gap}, ${words(left)} to play. Only a disaster can stop this now.`,
          `${L} leads by ${b.gap} with ${words(left)} to go.`,
        ]),
      )
    } else {
      lines.push(
        pick([
          `${L} is running away with it, ${b.gap} clear of ${S}.`,
          `${L} leads by ${b.gap}. ${S} is the closest thing to a challenger.`,
          `${L} is ${b.gap} clear. Everybody else is fighting for second.`,
          `${L} has opened up a ${b.gap} point lead. ${S}, the floor is yours.`,
          `${L} is ${b.gap} clear and playing like it's a different tournament. Somebody call the rules official.`,
          `${L} leads by ${b.gap} over ${S}.`,
          `${L} has pulled clear, ${b.gap} ahead of ${S}.`,
          `${L} leads by ${b.gap}. ${S} is going to need some help.`,
          `${L} is ${b.gap} up and pulling away. ${S} has some work to do.`,
          `A ${b.gap} point lead for ${L}. ${S} is still in it, technically.`,
          `${L} by ${b.gap}. The rest of the group is now playing for second, and for pride.`,
          `${L} is ${b.gap} ahead of ${S}.`,
        ]),
      )
    }
    if (b.leaders.length === 1 && b.spread <= 4 && c.players.length > 2)
      lines.push(pick([`All ${words(c.players.length)} are within ${b.spread}. Anybody's round.`, `Only ${b.spread} points from first to last. Nobody is out of this.`, `First to last, ${b.spread} points. Wide open.`, `Just ${b.spread} points separate the whole field. One good hole and everything changes.`, `The whole field is within ${b.spread}. Nobody is out of it.`, `Top to bottom, the gap is just ${b.spread}. Anybody's day.`, `Last place is only ${b.spread} back. Nobody is safe, nobody is done.`, `Everyone is within ${b.spread} of the lead.`]))
  }
  const purse = purseSettingsOf(c.db)
  if (purse.roundWinnerCents > 0 && left <= 9) {
    lines.push(
      b.leaders.length === 1
        ? pick([
            `There's ${dollars(purse.roundWinnerCents)} on this round, and ${b.leaders[0].first} has a hand on it.`,
            `${dollars(purse.roundWinnerCents)} to the winner today. ${b.leaders[0].first} can smell it.`,
            `${b.leaders[0].first} is ${words(left)} holes from ${dollars(purse.roundWinnerCents)}.`,
            `The ${dollars(purse.roundWinnerCents)} round prize is ${b.leaders[0].first}'s to lose.`,
            `${b.leaders[0].first} is already spending that ${dollars(purse.roundWinnerCents)}.`,
            `${b.leaders[0].first} is in line for the ${dollars(purse.roundWinnerCents)} round prize.`,
            `${dollars(purse.roundWinnerCents)} on the round, and ${b.leaders[0].first} is closest to it.`,
            `${b.leaders[0].first} has the inside track on today's ${dollars(purse.roundWinnerCents)}.`,
            `The round pays ${dollars(purse.roundWinnerCents)}, and ${b.leaders[0].first} is reaching for it.`,
            `${b.leaders[0].first} can almost feel that ${dollars(purse.roundWinnerCents)} in the wallet.`,
            `Today's ${dollars(purse.roundWinnerCents)} is ${b.leaders[0].first}'s, if ${b.leaders[0].first} can hang on.`,
            `${b.leaders[0].first} is in front for the ${dollars(purse.roundWinnerCents)} round prize.`,
          ])
        : pick([
            `There's ${dollars(purse.roundWinnerCents)} on this round, and nobody owns it yet.`,
            `${dollars(purse.roundWinnerCents)} on the round, and it's up for grabs.`,
            `${dollars(purse.roundWinnerCents)} on the round, and it's sitting on the next tee box. Go get it.`,
            `${dollars(purse.roundWinnerCents)} on the round, and it could go any direction.`,
            `Nobody has a grip on today's ${dollars(purse.roundWinnerCents)} yet.`,
            `Today's ${dollars(purse.roundWinnerCents)} is still anyone's.`,
          ]),
    )
  }
  return lines
}

/** The week as it stands, live round included, and what it would pay right now. */
function weekStakes(c: Ctx, pick: Pick, finished: boolean): string[] {
  const st = buildStandings(c.db)
  if (!st.hasCountingRound || st.rows.length < 2) return []
  const [a, b] = st.rows
  const after = roundsAfter(c).length
  const lines: string[] = []
  const lead = a.position === b.position ? null : a
  const roundLeader = board(c, c.complete).leaders

  // Who led the week before today started.
  const before = st.rows
    .map((r) => ({ r, t: r.byRound.filter((e) => e.counts && e.roundNumber < c.roundNumber).reduce((s, e) => s + e.points, 0) }))
    .sort((x, y) => y.t - x.t)
  const hadRounds = c.roundNumber > 1 && before[0].t > 0
  const oldLeader = hadRounds && before[0].t > before[1].t ? before[0].r : null

  if (!lead || a.total === b.total) {
    // Level on points: say who the tiebreaker favours.
    const how = lead ? st.tiebreakNote?.match(/leads on (.*)\.$/)?.[1] : null
    lines.push(
      how
        ? `On the week, ${first(a.name)} and ${first(b.name)} are level on ${a.total}, and ${first(a.name)} is ahead on ${how}.`
        : `On the week, ${first(a.name)} and ${first(b.name)} are level on ${a.total}.`,
    )
    lines.push(
      pick([
        'This is why we have a tiebreaker now.',
        'Somebody tell Kyle to check the math. Actually, the app has it.',
        "Don't worry, there's a tiebreaker. Kyle learned that one the hard way.",
        'Dead even. Somewhere, a spreadsheet is sweating.',
        'Level on the week. The tiebreaker is warming up in the bullpen.',
        'Even on points. Every hole from here could decide it.',
        'A tie on the week. The group chat will be thrilled.',
        'All square on the week. Nobody gets to brag. Yet.',
        '',
        '',
        '',
        '',
      ]),
    )
  } else {
    const gap = a.total - b.total
    const left = after === 0 ? (finished ? '' : ' in the last round of the trip') : `, ${plural(after, 'round')} still to come`
    if (oldLeader && oldLeader.playerId !== a.playerId && !finished) {
      lines.push(`Big news on the week: ${first(a.name)} has taken the lead from ${first(oldLeader.name)} today, and now leads by ${gap}${left}.`)
    } else if (roundLeader.length === 1 && roundLeader[0].id !== a.playerId && !finished) {
      lines.push(`${roundLeader[0].first} is winning the day, but ${first(a.name)} still leads the week, ${gap} clear of ${first(b.name)}${left}.`)
    } else {
      lines.push(
        finished && after === 0
          ? `And that's the week: ${first(a.name)} wins it by ${gap}.`
          : pick([
              `On the week, ${first(a.name)} leads ${first(b.name)} by ${gap}${left}.`,
              `For the whole trip, it's ${first(a.name)} on top, ${gap} ahead of ${first(b.name)}${left}.`,
              `In the championship, ${first(a.name)} leads by ${gap} over ${first(b.name)}${left}.`,
              `The week belongs to ${first(a.name)} for now, ${gap} up on ${first(b.name)}${left}.`,
              `Overall, ${first(a.name)} is ${gap} clear of ${first(b.name)}${left}.`,
              `On the week, ${first(a.name)} is ${gap} up on ${first(b.name)}${left}. Don't order the trophy engraving yet.`,
              `${first(a.name)} leads the week by ${gap} over ${first(b.name)}${left}.`,
              `${first(a.name)} is ${gap} ahead of ${first(b.name)} on the week${left}.`,
              `The trip lead belongs to ${first(a.name)}, ${gap} up on ${first(b.name)}${left}.`,
              `In the big race, ${first(a.name)} leads ${first(b.name)} by ${gap}${left}.`,
              `${first(a.name)} sits on top of the week, ${gap} clear of ${first(b.name)}${left}.`,
              `Across the whole trip, ${first(a.name)} is ${gap} better than ${first(b.name)}${left}.`,
              `${first(a.name)} has the week by ${gap} over ${first(b.name)}${left}. ${first(b.name)} has heard about it.`,
              `For the championship, it's ${first(a.name)} by ${gap} over ${first(b.name)}${left}.`,
            ]),
      )
    }
  }
  const purse = purseSettingsOf(c.db)
  const third = st.rows[2]
  if (lead && purse.champFirstCents > 0 && (after === 0 || finished) && (!third || third.position !== b.position)) {
    lines.push(
      finished && after === 0
        ? `That's ${dollars(purse.champFirstCents)} for ${first(a.name)} and ${dollars(purse.champSecondCents)} for ${first(b.name)}.`
        : `If it ended right now, ${first(a.name)} takes home ${dollars(purse.champFirstCents)} and ${first(b.name)} ${dollars(purse.champSecondCents)}.`,
    )
  }
  return lines
}

/**
 * The week after a round that wasn't the first: what today did to it. Who led coming in, who
 * leads going out, how the cushion moved, and the day's biggest mover. Null on the first round
 * or a points tie at the top, where `weekStakes` already says what there is to say.
 */
function weekWrap(c: Ctx, pick: Pick): string[] | null {
  const st = buildStandings(c.db)
  if (!st.hasCountingRound || st.rows.length < 2) return null
  const [a, b] = st.rows
  if (a.position === b.position || a.total === b.total) return null
  const beforeOf = (r: (typeof st.rows)[number]) => r.byRound.filter((e) => e.counts && e.roundNumber < c.roundNumber).reduce((sum, e) => sum + e.points, 0)
  const before = st.rows.map((r) => ({ r, t: beforeOf(r) })).sort((x, y) => y.t - x.t)
  if (before[0].t === 0) return null
  const A = first(a.name)
  const B = first(b.name)
  const gap = a.total - b.total
  const after = roundsAfter(c).length
  const left = `${cap(plural(after, 'round'))} to play.`
  const oldSole = before[0].t > before[1].t ? before[0].r : null
  const g0 = before[0].t - before[1].t
  const { ids } = resolveRoundWinnerIds(c.detail)
  const dayWinner = ids.length === 1 && ids[0] !== a.playerId ? first(c.db.players.find((p) => p.id === ids[0])?.name ?? '') : null
  const lines: string[] = []
  if (oldSole && oldSole.playerId !== a.playerId) {
    const was = before[0].t - beforeOf(a)
    const Old = first(oldSole.name)
    lines.push(
      pick([
        `And the week has a new leader. ${A} started the day ${was} behind ${Old} and ends it ${gap} in front${B === Old ? '' : ` of ${B}`}.`,
        `Big movement on the week. ${Old} came in leading. ${A} leaves leading, ${gap} clear${B === Old ? '' : ` of ${B}`}.`,
        `Moving day. ${A} was ${was} back this morning and is ${gap} up tonight. ${Old} has been passed.`, `${Old} had the lead this morning and does not have it now. ${A} is in front on the week by ${gap}.`, `The week has flipped. ${A}, ${was} behind at breakfast, now leads by ${gap}.`,
        `Change at the top of the week: ${A} wipes out a ${was}-point deficit to ${Old} and leads${B === Old ? '' : ` ${B}`} by ${gap}.`,
      ]),
    )
  } else if (!oldSole) {
    lines.push(pick([`The week was level coming in. It isn't now: ${A} leads ${B} by ${gap}.`, `${A} breaks the tie on the week and leads ${B} by ${gap}.`, `Somebody had to blink. ${A} is ${gap} clear of ${B} on the week.`, `All square on the week this morning. Now it is ${A} by ${gap} over ${B}.`, `The deadlock on the week is over, and ${A} is ${gap} to the good.`]))
  } else if (dayWinner) {
    lines.push(
      gap < g0
        ? pick([`${dayWinner} won the day, but ${A} still owns the week: ${gap} clear of ${B}, down from ${g0}.`, `The day went to ${dayWinner}. The week is still ${A}'s, but the lead is down from ${g0} to ${gap}.`, `${dayWinner} takes the round, and ${A} keeps the week, ${gap} up on ${B}. It was ${g0} this morning.`, `Today was ${dayWinner}'s. The week remains ${A}'s, though the lead slipped from ${g0} to ${gap}.`])
        : pick([`${dayWinner} won the day, but ${A} still owns the week, ${gap} clear of ${B}.`, `The day went to ${dayWinner}. The week is still ${A}'s, by ${gap} over ${B}.`, `${dayWinner} takes the round, and ${A} keeps the week, ${gap} up on ${B}.`, `Today was ${dayWinner}'s. The week is still ${A}'s, ${gap} clear of ${B}.`, `A good day for ${dayWinner}, and no damage done to ${A}, who leads the week by ${gap}.`]),
    )
  } else if (gap > g0) {
    lines.push(
      pick([
        `On the week, ${A} came in leading by ${g0} and leaves leading by ${gap}. ${B} has work to do.`,
        `${A} is pulling away on the week: the lead was ${g0} this morning and it's ${gap} now, over ${B}.`,
        `The week is getting away from everybody but ${A}. From ${g0} up to ${gap} up, with ${B} the nearest.`,
        `${A} padded the lead on the week, ${g0} to ${gap}. ${B} is the closest, and not very close.`, `The rich get richer. ${A}'s lead on the week grows from ${g0} to ${gap}.`, `${A} came for the day and took more of the week too: ${gap} up now, from ${g0}.`, `If anyone is going to catch ${A}, it needs to start soon. The lead is ${gap}, up from ${g0}.`,
      ]),
    )
  } else if (gap < g0) {
    lines.push(
      pick([
        `${A} still leads the week, but the cushion went from ${g0} to ${gap}. ${B} is coming.`,
        `On the week, ${A}'s lead shrank today, from ${g0} to ${gap}. ${B} can see it from here.`,
        `The week just got interesting. ${A} led by ${g0} this morning and leads ${B} by ${gap} tonight.`,
        `${A} is still on top of the week, but only by ${gap} now. It was ${g0}.`, `The lead got smaller today. ${A} is up ${gap} on the week, down from ${g0}.`, `We have a race. ${A} by ${gap} over ${B}, and it was ${g0} when the day began.`, `${A} leads the week by ${gap}. This morning it was ${g0}, and ${B} knows it.`,
      ]),
    )
  } else {
    lines.push(pick([`Nothing changed on the week: ${A} still leads by ${gap}, over ${B}.`, `On the week, ${A} leads ${B} by ${gap}, same as this morning.`, `${A} keeps the week at arm's length: ${gap} clear of ${B}, exactly where it started.`, `A lot of golf, and no change on the week: ${A} by ${gap}.`]))
  }
  // The day's biggest mover toward the top, when it isn't the story already told.
  const nowLead = a.total
  const movers = st.rows
    .filter((r) => r.playerId !== a.playerId && r.playerId !== b.playerId && r.playerId !== oldSole?.playerId)
    .map((r) => ({ r, was: before[0].t - beforeOf(r), now: nowLead - r.total }))
    .filter((m) => m.was - m.now >= 4)
    .sort((x, y) => y.was - y.now - (x.was - x.now))
  if (movers[0]) {
    const m = movers[0]
    lines.push(pick([`Mover of the day: ${first(m.r.name)}, from ${m.was} back to ${m.now} back.`, `Quietly, ${first(m.r.name)} made up ground: ${m.was} behind this morning, ${m.now} behind tonight.`, `Don't sleep on ${first(m.r.name)}, who cut the deficit from ${m.was} to ${m.now} today.`, `${first(m.r.name)} is creeping up: ${m.was} back this morning, ${m.now} back now.`, `Keep an eye on ${first(m.r.name)}. The gap to the top went from ${m.was} to ${m.now} today.`, `Biggest climber: ${first(m.r.name)}, who made up ${m.was - m.now} on the lead.`]))
  }
  lines.push(left)
  const purse = purseSettingsOf(c.db)
  const third = st.rows[2]
  if (purse.champFirstCents > 0 && (!third || third.position !== b.position))
    lines.push(`If it ended right now, ${A} takes home ${dollars(purse.champFirstCents)} and ${B} ${dollars(purse.champSecondCents)}.`)
  return lines
}

/** The next hole: length, par, how hard, who gets a shot, and what's up for grabs. */
function upNext(c: Ctx, hole: number, pick: Pick, intro = true): string[] {
  const info = c.holes.find((h) => h.holeNumber === hole)
  if (!info || hole > c.n) return []
  const y = teeYardage(c, hole)
  const what = `${y ? `${y}-yard ` : ''}par ${info.par}`
  const lastHole = hole === c.n
  const lastOfTrip = lastHole && roundsAfter(c).length === 0
  let flavor = ''
  if (lastOfTrip) flavor = ', the last hole of the trip'
  else if (lastHole) flavor = ', the last hole of the round'
  else if (info.strokeIndex === 1) flavor = ', the hardest hole on the course'
  else if (info.strokeIndex <= 3) flavor = ', one of the hardest holes on the course'
  else if (info.strokeIndex >= 17) flavor = ', one of the easiest on the card'
  const lines = [`${intro ? `${pick(['Up next', 'Next up', 'Coming up', 'On deck', 'Next on the card', 'Waiting for them', 'Next', 'Up ahead', 'Next stop', 'The next test', 'Coming up next', 'Straight ahead'])},` : 'The group is on'} the ${ordinalOf(hole)}: a ${what}${flavor}.`]

  const getting = c.players.filter((p) => (p.holes.get(hole)?.strokesReceived ?? 0) >= 1)
  const two = getting.filter((p) => (p.holes.get(hole)?.strokesReceived ?? 0) >= 2)
  if (getting.length === 0) lines.push(pick(['Nobody gets a shot there. Straight up.', 'No strokes on this one. Everybody plays it straight.', 'Nobody gets any help here.', 'No shots given. Earn it.', 'No strokes. No charity. No excuses.', 'Nobody gets a stroke on this one.', 'Nobody gets a stroke there. Pure golf.', 'No shots on this one. Every point gets earned.', 'Strokes are off the table here.', 'No strokes. The handicap stays in the bag.', 'Nobody gets help on this one. Play it as it lies.', 'No strokes on this hole.']))
  else if (getting.length === c.players.length) lines.push(pick(['Everybody gets a shot there.', 'Strokes for everyone on this one.', 'A shot apiece here. No excuses.', 'Everybody gets a shot. Participation trophies all around.', 'Shots for the whole group here.', 'Everybody gets a stroke. Generosity abounds.', 'A stroke for everyone. Nobody can complain.', 'Everybody gets one there.']))
  else lines.push(`${listOf(getting.map((p) => p.first))} ${getting.length === 1 ? 'gets' : 'get'} a shot there${two.length ? `, and ${listOf(two.map((p) => p.first))} ${two.length === 1 ? 'gets' : 'get'} two` : ''}.`)

  if (info.par === 3) lines.push(pick([
        "It's a par 3, so there's a closest to the pin up for grabs.",
        'Par 3. Closest to the pin is on the line, and so is everyone\'s dignity.',
        'Par 3. Somebody is about to get paid for being close.',
        'A par 3, and a closest to the pin, settled in cash.',
        'Par 3. Hit the green, collect your money.',
        'Par 3. Aim for the flag, settle for the green, blame the wind.',
        'Par 3, and a closest to the pin up for grabs.',
        'A par 3. Get it close, get paid later.',
        'Par 3. One swing to be a hero.',
        'Par 3. The flag is the target, the bunker is the backup plan.',
        'A par 3, and closest to the pin money on the side.',
        'Par 3. Somebody is going to stick one.',
      ]))
  else if (info.par === 5 && !lastHole) lines.push(pick([
        'A par 5. Birdie chance, or disaster chance.',
        'A par 5, where rounds get made and rounds get ruined.',
        'Par 5. Big hitters, this is your moment.',
        'A par 5, and three good swings away from a birdie. Or six bad ones.',
        'Par 5. Long enough for everyone to hit at least one great shot, and at least one they will deny.',
        'Par 5. Long, and full of opportunity, or trouble.',
        'A par 5. Reachable for some, a three-act play for others.',
        'Par 5. Grip it and rip it.',
        'A par 5, where patience pays.',
        'Par 5. Three shots if you are good, five if you are honest.',
      ]))
  return lines
}

/** Two or three holes left: name the finish. */
function theFinish(c: Ctx, from: number): string | null {
  const rest = c.holes.filter((h) => h.holeNumber > from && h.holeNumber <= c.n)
  if (rest.length === 0 || rest.length > 3) return null
  return `Then ${listOf(rest.map((h) => `the ${ordinalOf(h.holeNumber)}, a par ${h.par}`))}, to finish.`
}

function closeLine(phase: CallPhase, pick: Pick, lastRound: boolean): string {
  const pools: Record<string, string[]> = {
    early: ['Plenty of golf left. Back to you.', 'Long day ahead. Sunscreen, gentlemen. Back to you.', 'Long way to go. Hydrate, gentlemen.', "It's early. Nobody panic. Yet.", 'Lots of golf to play. Back to you in the booth.', 'Settle in. This is going to be a long one.', 'Deep breaths, everybody. Back to you.', 'Back to you.', 'More soon.', 'Lots of holes left. Back to you.', 'Long way to go. Pace yourselves.', 'Keep the sunscreen handy. Back to you.', 'Early days. Nobody start the victory speech.', 'Plenty of time to recover. Or not. Back to you.', 'Stay loose, gentlemen.', 'Back to you in the studio.', 'More to come.', 'Check back soon.'],
    front: ['Keep it in the short grass, boys. Back to you.', 'Keep your heads down and your scorecards honest. Back to you.', "We'll check back in a few holes.", 'Fairways and greens. Back to you.', "Stay tuned. We'll be right here.", 'More to come. Try not to embarrass yourselves.', "That's the update. Swing easy.", 'Back to you.', 'More in a few holes.', 'Hit it straight, find it fast. Back to you.', 'Stay tuned, more in a bit.', "We'll catch up again at the turn.", 'Keep the ball in play. Back to you.', 'Swing smooth. More soon.', "That's the latest. Back to you.", 'Fairways, gentlemen. Fairways.', 'Stay with us.', 'Back with more soon.'],
    turn: ['Hot dogs, then the back nine. Back to you in the clubhouse.', 'Reload at the turn. The back nine waits for no one.', 'Grab a drink, grab a dog, grab your dignity if you can find it.', 'Nine to go. Make them count.', 'Refuel, regroup, and try to remember how to putt.', 'Back nine next. Somebody is about to get hot.', 'On to the back nine. Back to you.', 'Back nine coming up. Back to you.', 'Nine more. Stretch the legs and go.', 'Hot dog break. Then the real golf starts.', 'Halfway done. The good part is next.', 'Refill the water, then the back nine.', 'Back nine next. Somebody make it interesting.', 'Onward. Back to you.'],
    back: ["We'll be right here when it gets ugly. Back to you.", 'Stay tuned. This thing is far from over.', 'Hold on to something. Back to you.', "We'll check in again before it gets out of hand.", 'Plenty of drama left. Back to you in the booth.', 'Stay with us. This one has a twist or two left.', 'Back to you.', 'More as it happens.', 'Still plenty to play. Back to you.', "Don't go anywhere. Back to you.", "Things could change fast. We'll be here.", 'More drama to come. Back to you.', 'The back nine has a way of surprising people. Stay tuned.', "We'll check back soon.", 'Back to you in the studio.', 'Stay with us.'],
    closing: lastRound
      ? ['Everything on the line. Strap in.', 'Somebody is about to be very rich, relatively speaking. Strap in.', 'This is it. The whole trip, right here. Back to you.', 'Breathe, gentlemen. This is what we came for.', 'The trophy is in the building. Back to you.', 'The whole trip comes down to this. Strap in.', 'Last holes of the trip. Make them count.', 'Everything is on the line now. Back to you.', 'This is what the whole week was for. Back to you.', 'The final holes of the trip. Breathe.']
      : ['Strap in. Back to you.', 'Grip it, rip it, and try not to three-putt. Back to you.', "Bring it home, boys. We'll see you at the 18th.", 'Finish strong. Back to you.', "Nobody choke. We'll see you on the last green.", 'Home stretch. Make it count.', 'Back to you.', "Squeeze the grip, not the moment. Back to you.", 'Bring it home. Back to you.', 'A few more swings. Make them good.', "Close it out, gentlemen. We'll see you at the last hole.", 'Finish the job. Back to you.', 'Last few holes. No regrets.', 'Stay calm, swing easy, bring it home.', 'Back to you for the finish.', "We'll see you at the end."],
  }
  return pick(pools[phase] ?? pools.front)
}

// ── The three calls ──────────────────────────────────────────────────────────

function liveCall(c: Ctx, phase: CallPhase, pick: Pick): string[] {
  const lastRound = roundsAfter(c).length === 0
  const out: string[] = [openLine(c, phase, pick)]
  if (phase === 'turn') {
    out.push(...stretchReview(c, phase, pick))
    out.push(...halftime(c, pick))
  } else {
    out.push(...recentAction(c, pick))
    out.push(...stretchReview(c, phase, pick))
  }
  // An eagle the hole call just covered doesn't need its own note as well.
  const eagleCalled = out.some((l) => /true (eagle|albatross)|hole in one/i.test(l))
  out.push(...colorNotes(c, pick, phase === 'early' ? 1 : 2).filter((l) => !(eagleCalled && /true (eagle|albatross)|hole in one/i.test(l))))
  out.push(...roundStakes(c, pick))
  if (phase !== 'early') out.push(...weekStakes(c, pick, false))
  // The group's next hole. If part of the group has already finished it, they're "on" it.
  const next = c.complete + 1
  out.push(...upNext(c, next, pick, c.edge <= c.complete))
  if (phase === 'closing') out.push(theFinish(c, next) ?? '')
  out.push(closeLine(phase, pick, lastRound))
  return out
}

/**
 * The very first tee of the trip (Kyle 2026-10-11): the welcome, the field by full name, the
 * four days, and the whole purse. Only before the first round has a point on the board.
 */
function tournamentOpener(c: Ctx, pick: Pick, daypart: string): string[] | null {
  const rounds = c.db.rounds.filter((r) => r.status !== 'abandoned').sort((a, b) => a.round_number - b.round_number)
  if (rounds[0]?.round_number !== c.roundNumber || rounds.some((r) => r.status === 'final')) return null
  const out: string[] = [
    pick([
      `Good ${daypart}, everybody, and welcome to the Board of Directors. Streamsong, twenty twenty-seven.`,
      `Good ${daypart}, and welcome to Streamsong for the Board of Directors, twenty twenty-seven.`,
      `Good ${daypart}, and welcome to the Board of Directors, twenty twenty-seven, coming to you live, on foot, from somewhere in the dunes of central Florida.`,
      `Good ${daypart} from Streamsong, where the dunes are big, the greens are fast and the handicaps are, let's say, under review. Welcome to the Board of Directors, twenty twenty-seven.`,
      `The Board of Directors, twenty twenty-seven, is now in session. Good ${daypart}, and welcome to Streamsong.`,
      `Good ${daypart}, and welcome to the Board of Directors, twenty twenty-seven, live from Streamsong.`,
      `Welcome to Streamsong, everybody, and good ${daypart}. The Board of Directors, twenty twenty-seven, starts now.`,
      `Good ${daypart}, golf fans. The Board of Directors is back, and this year it's at Streamsong.`,
      `From the sand dunes of central Florida, good ${daypart}, and welcome to the Board of Directors, twenty twenty-seven.`,
      `Good ${daypart}. The clubs are cleaned, the excuses are polished, and the Board of Directors, twenty twenty-seven, is underway at Streamsong.`,
    ]),
    pick([
      `${cap(words(rounds.length))} rounds. ${cap(words(rounds.length))} courses. ${cap(words(rounds.length))} days. And ${words(c.players.length)} men who have been talking about this trip for months.`,
      `${cap(words(rounds.length))} rounds in ${words(rounds.length)} days, ${words(c.players.length)} men, and one group chat that has not shut up since last year.`,
      `${cap(words(rounds.length))} rounds. ${cap(words(rounds.length))} days. Zero mulligans. Officially.`,
      `${cap(words(rounds.length))} courses, ${words(rounds.length)} days, and roughly a thousand excuses, most of them already rehearsed.`,
      `${cap(words(rounds.length))} rounds, ${words(rounds.length)} days, ${words(c.players.length)} friends, and one trophy.`,
      `${cap(words(rounds.length))} days of golf, ${words(c.players.length)} men, and a whole lot of walking.`,
      `${cap(words(rounds.length))} rounds on foot, ${words(rounds.length)} days in the dunes, and ${words(c.players.length)} men who think this is their year.`,
      `${cap(words(rounds.length))} rounds. ${cap(words(c.players.length))} players. One champion. No mulligans.`,
    ]),
  ]
  const field = c.players
    .map((p) => c.db.players.find((x) => x.id === p.id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => p.name)
  // Returning co-champions first, then everyone else, then the inaugural champion (Kyle 2026-10-24).
  const returning = field.filter((n) => LORE.returning.includes(surname(n)))
  const inaugural = field.filter((n) => surname(n) === LORE.inaugural)
  const rest = field.filter((n) => !returning.includes(n) && !inaugural.includes(n))
  const intro = [
    ...(returning.length > 1
      ? [
          pick([
            `Returning co-champions, ${listOf(returning)}.`,
            `The returning co-champions, ${listOf(returning)}. One title, two mantels.`,
            `Back to defend half a title each, the returning co-champions, ${listOf(returning)}.`,
            `Returning co-champions, ${listOf(returning)}, who shared the title last time thanks to some creative scorekeeping. The app has a tiebreaker now.`,
            `Sharing the crown from last time, the returning co-champions, ${listOf(returning)}.`,
            `The defending co-champions, ${listOf(returning)}. One trophy, two claims.`,
            `Returning co-champions ${listOf(returning)}, who have been splitting the bragging rights ever since.`,
            `The returning co-champions, ${listOf(returning)}. This year, the app breaks ties.`,
          ]),
        ]
      : returning.map((n) => `Returning champion, ${n}.`)),
    ...rest.map((n) =>
      surname(n) !== LORE.builder ? `${n}.` : pick([
        `${n}.`,
        `${n}, still chasing a first title.`,
        `${n}, who built the app that's keeping score. The commissioners have reviewed the code. Allegedly.`,
        `${n}, the man with the spreadsheet.`,
        `${n}, commissioner of the scorecard.`,
        `${n}, who swears the app is impartial.`,
        `${n}, who has never finished better than third, and has a plan to fix that.`,
        `${n}, builder of the app, and therefore not to be trusted.`,
      ]),
    ),
    ...inaugural.map((n) =>
      pick([
        `${n}, inaugural champion.`,
        `And the inaugural champion, ${n}. The original. Accept no substitutes.`,
        `${n}, inaugural champion, and owner of the only title nobody had to share.`,
        `And the first man ever to win this thing, ${n}, inaugural champion.`,
        `${n}, the inaugural champion, and the original name on the trophy.`,
        `And ${n}, inaugural champion, who never lets anybody forget it.`,
        `${n}, who won the very first one, outright.`,
        `And the man who started it all, ${n}, inaugural champion.`,
      ]),
    ),
  ]
  if (field.length > 0) out.push(`Let's meet the field. ${intro.join(' ')}`)

  const weekday = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
  const stops = rounds.map((r, i) => {
    const course = c.db.courses.find((x) => x.id === r.course_id)
    const name = course ? courseRef(course.name) : `round ${r.round_number}`
    return i === 0 ? `${name} today` : `${name} on ${weekday(r.date)}`
  })
  if (stops.length > 1)
    out.push(
      pick([
        `Here's the road ahead: ${listOf(stops)}.`,
        `On the docket: ${listOf(stops)}. Pace yourselves.`,
        `The itinerary, for those who didn't read it: ${listOf(stops)}.`,
        `The schedule: ${listOf(stops)}. Ibuprofen sold separately.`,
        `The road map: ${listOf(stops)}.`,
        `What's ahead: ${listOf(stops)}. Hydrate accordingly.`,
        `The plan: ${listOf(stops)}. Stretch first.`,
        `On the schedule: ${listOf(stops)}.`,
      ]),
    )

  const purse = purseSettingsOf(c.db)
  const pot = purse.buyInPerPlayerCents * c.players.length
  if (purse.champFirstCents > 0) {
    out.push(
      `${pot > 0 ? `${dollars(pot)} on the line. ` : ''}${dollars(purse.champFirstCents)} for the champion, ${dollars(purse.champSecondCents)} for second${
        purse.roundWinnerCents > 0 ? `, and ${dollars(purse.roundWinnerCents)} to whoever wins each round` : ''
      }. ${pick([
        'Plus closest to the pin and shits, settled at the nineteenth hole, like gentlemen.',
        'Closest to the pin and shits are settled in cash at the nineteenth hole, as tradition demands.',
        'Closest to the pin and shits are handled off the books, at the bar, with witnesses.',
        'Closest to the pin and shits are settled separately, at the nineteenth hole.',
        'Closest to the pin and shits get paid in cash, after the golf, over a drink.',
        'Closest to the pin and shits are off the books, and settled like gentlemen at the bar.',
      ])}`,
    )
  }
  return out
}

function previewCall(c: Ctx, pick: Pick): string[] {
  const after = roundsAfter(c).length
  const tee = c.detail.round.tee_time
  const hour = tee ? Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(new Date(tee))) : 12
  const daypart = hour < 12 ? 'morning' : 'afternoon'
  const opener = tournamentOpener(c, pick, daypart)
  const out: string[] = opener ?? [
    pick([
      `Good ${daypart}, and welcome to Streamsong for round ${c.roundNumber}, ${c.courseFull}.`,
      `Good ${daypart} from ${c.courseFull}, where round ${c.roundNumber} is about to get underway.`,
      `It's round ${c.roundNumber} at Streamsong, and today it's ${c.courseFull}. Good ${daypart}.`,
      `Good ${daypart}, everybody. Round ${c.roundNumber}, ${c.courseFull}. Let's get into it.`,
      `Welcome back to Streamsong. Round ${c.roundNumber}. ${c.courseFull}. Good ${daypart}.`,
      `Good ${daypart}, and welcome back. Round ${c.roundNumber} is on ${c.courseFull}.`,
      `Round ${c.roundNumber}, ${c.courseFull}. Good ${daypart}, everybody.`,
      `Good ${daypart} from Streamsong. It's round ${c.roundNumber}, and the course is ${c.courseFull}.`,
      `Welcome to round ${c.roundNumber}. Today's stage: ${c.courseFull}. Good ${daypart}.`,
      `Good ${daypart}. Another day, another course. Round ${c.roundNumber}, ${c.courseFull}.`,
    ]),
  ]
  if (tee && c.detail.round.status === 'upcoming') out.push(`Tee time is ${formatTeeTime(tee)!.replace(/ ET$/, '')}.`)
  if (after === 0 && c.roundNumber > 1) out.push("It's the last round of the trip. Everything is on the line.")

  // Who gets shots today, most first; the low man plays off scratch.
  const byStrokes = c.players.slice().sort((a, b) => b.strokes - a.strokes)
  const scratch = byStrokes.filter((p) => p.strokes === 0)
  const getting = byStrokes.filter((p) => p.strokes > 0)
  if (getting.length > 0) {
    const parts = getting.map((p, i) => `${p.first} ${i === 0 ? `gets ${plural(p.strokes, 'shot')}` : words(p.strokes)}`)
    out.push(`${listOf(parts)}${scratch.length ? `, and ${listOf(scratch.map((p) => p.first))} ${scratch.length === 1 ? 'plays' : 'play'} off scratch` : ''}.`)
  }

  const week = buildStandings(c.db).rows.some((r) => r.total > 0) ? weekStakes(c, pick, false) : []
  if (week.length > 0) out.push(...week)
  else
    out.push(
      pick([
        'Nobody has a point yet. Everybody is still a contender, for about one more hour.',
        'Clean slate. Everybody is undefeated. Enjoy it while it lasts.',
        'Zero points across the board. This is the most even it will ever be.',
        'Everybody is tied for first. Savor it.',
        "Nobody has a point, nobody has a zero, and nobody has an excuse. Yet.",
        'No points on the board yet. Everybody still believes.',
        'Everybody starts at zero. It only goes up from here, hopefully.',
        'Scores are blank. Hopes are high.',
        'All square before a single swing. Enjoy the peace.',
        'Not a point on the board. This is the calm before the storm.',
      ]),
    )
  out.push(...upNext(c, 1, pick).map((l, i) => (i === 0 ? l.replace(/^[^,]+, the 1st/, 'First up, the 1st') : l)))
  out.push(
    pick([
      'Fairways and greens, gentlemen.',
      "Hit 'em straight. Back to you.",
      'May the putts drop and the excuses be creative.',
      "Reminder: an app is keeping score this year, not Kyle. Play away.",
      'Tee it high and let it fly. Back to you.',
      'Swing easy, putt confidently, lie modestly.',
      "Let's play some golf.",
      'Good luck, gentlemen.',
      'Keep it in the fairway. Back to you.',
      'Play well, putt better.',
      'Fire away. Back to you.',
      'May the bounces go your way.',
      'Let the games begin.',
      'Have fun out there.',
    ]),
  )
  return out
}

/**
 * The round wrap as a highlights show (Kyle 2026-11-11: "like a sports cast. Highlights, jokes",
 * not a readout of the Field Report): the result and the money, how it was won, the play of the
 * day, a word on everyone else, and one for the blooper reel. Everything is derived from the
 * holes; the winner is whoever `resolveRoundWinnerIds` names, as on the recap and Money.
 */
function wrapShow(c: Ctx, pick: Pick): string[] {
  const n = c.n
  const fin = board(c, n)
  const { ids, onCountback } = resolveRoundWinnerIds(c.detail)
  const winners = fin.rows.filter((r) => ids.includes(r.p.id)).map((r) => r.p)
  const w = winners.length === 1 ? winners[0] : null
  const rest = fin.rows.filter((r) => !ids.includes(r.p.id))
  const purse = purseSettingsOf(c.db)
  const R = `round ${c.roundNumber}`
  const out: string[] = []
  const hp = (p: Pl, h: number) => p.holes.get(h)?.points ?? 0
  const parOf = (h: number) => c.holes.find((x) => x.holeNumber === h)?.par ?? 4

  // ── The result ──
  const top = fin.top
  if (winners.length > 1) {
    const names = listOf(winners.map((p) => p.first))
    out.push(
      pick([
        `We could not separate them. ${names} share ${R} on ${top} points each.`,
        `A tie at the top. ${names} finish level on ${top}, and not even the countback could split them.`,
        `${names} share the day on ${top} apiece. Nobody blinked.`, `Nothing between them. ${names} split ${R} on ${top}.`, `${names}, ${top} points each, and no way to split them. Shared honors.`, `Call it a draw. ${names} both post ${top} and share ${R}.`,
      ]),
    )
  } else if (w) {
    const x = rest[0]
    const m = x ? top - x.s : 0
    if (onCountback || m === 0) {
      const other = fin.rows.find((r) => r.p.id !== w.id && r.s === top)?.p.first ?? x?.p.first ?? ''
      out.push(
        pick([
          `${w.first} and ${other} finished level on ${top}, and ${w.first} takes ${R} on countback. Brutal for ${other}.`,
          `Dead level on ${top}, and the countback goes to ${w.first}. ${other} will be doing that math all night.`,
          `It took a countback. ${w.first} and ${other}, ${top} each, and ${w.first} gets the nod.`, `${top} apiece for ${w.first} and ${other}, and the tiebreak goes ${w.first}'s way. Cruel game.`, `Level on ${top}, and ${w.first} wins ${R} on the countback. ${other} lost a round without being beaten.`, `Nothing in it on points. ${w.first} and ${other} both made ${top}, and the countback picked ${w.first}.`,
        ]),
      )
    } else if (m >= 6) {
      out.push(
        pick([
          `${w.first} wins ${R}, and it wasn't close. ${top} points, ${m} clear of ${x.p.first}.`,
          `Your winner, by a country mile: ${w.first}. ${top} points, ${m} ahead of ${x.p.first}.`,
          `${w.first} takes ${R} by ${m}. ${x.p.first} was second. ${x.p.first} was also never really in it.`,
          `This one was a rout. ${w.first}, ${top} points, ${m} better than ${x.p.first}.`,
          `${w.first} ran away with ${R}. ${top} points, and ${x.p.first} the best of the rest, ${m} back.`,
          `Call it what it was: a beating. ${w.first} wins ${R} with ${top}, ${m} clear of ${x.p.first}.`, `${w.first} lapped the field. ${top} points, ${m} ahead of ${x.p.first} in second.`, `No drama today. ${w.first} wins ${R} by ${m}, with ${top} points.`, `${w.first}, ${top} points, and nobody within ${m - 1}. That is a comfortable afternoon.`, `It was ${w.first} first and everybody else nowhere. ${top} points, ${m} better than ${x.p.first}.`, `${w.first} made this look easy. ${top} points, and a ${m}-point gap back to ${x.p.first}.`,
        ]),
      )
    } else if (m <= 2) {
      out.push(
        pick([
          `${w.first} wins ${R} by ${m === 1 ? 'a single point' : 'two points'}. ${top} to ${x.s} over ${x.p.first}.`,
          `A nail-biter on ${c.course}. ${w.first} edges ${x.p.first}, ${top} to ${x.s}.`,
          `${w.first} hangs on. ${top} points, ${plural(m, 'point')} better than ${x.p.first}.`,
          `${w.first} takes ${R}, barely. ${top} to ${x.s}, and ${x.p.first} will be replaying one putt all night.`,
          `It could not have been tighter. ${w.first} ${top}, ${x.p.first} ${x.s}.`, `${w.first} by a whisker. ${top} to ${x.s} over ${x.p.first}.`, `${w.first} survives. ${top} points, and ${x.p.first} just ${plural(m, 'point')} short.`, `Too close for comfort, but ${w.first} wins ${R}, ${top} to ${x.s} over ${x.p.first}.`, `${x.p.first} pushed it all the way. ${w.first} wins ${R} by ${plural(m, 'point')}, ${top} to ${x.s}.`,
        ]),
      )
    } else {
      out.push(
        pick([
          `${w.first} wins ${R} with ${top} points, ${m} clear of ${x.p.first}.`,
          `Your ${R} winner: ${w.first}. ${top} points, ${m} ahead of ${x.p.first}.`,
          `${w.first} takes ${c.course}. ${top} points, ${m} better than ${x.p.first}.`,
          `Top of the board: ${w.first}, ${top} points. ${x.p.first} is ${m} back.`,
          `${w.first} gets the win. ${top} points, with ${x.p.first} ${m} behind.`, `${w.first} is your winner on ${c.course}: ${top} points, ${m} up on ${x.p.first}.`, `The day belongs to ${w.first}. ${top} points, ${m} clear of ${x.p.first}.`, `${cap(R)} goes to ${w.first}, with ${top} points. ${x.p.first} finishes ${m} back.`, `A solid day's work from ${w.first}: ${top} points and a ${m}-point win over ${x.p.first}.`, `${w.first} wins it, ${top} to ${x.s} over ${x.p.first}.`,
        ]),
      )
    }
  }
  const scoreline = fin.rows.map((r) => `${r.p.first} ${r.s}`).join(', ')
  out.push(pick([`Final scores: ${scoreline}.`, `The final board: ${scoreline}.`, `Here's how they finished: ${scoreline}.`, `Final tally: ${scoreline}.`, `On the card: ${scoreline}.`, `The numbers: ${scoreline}.`, `In full: ${scoreline}.`, `Your final leaderboard: ${scoreline}.`]))
  if (purse.roundWinnerCents > 0 && w) {
    const $ = dollars(purse.roundWinnerCents)
    out.push(
      pick([
        `That's ${$} to ${w.first}.`,
        `${$} to ${w.first}. Don't spend it all at the bar.`,
        `${w.first} picks up the ${$} round prize, and will be insufferable about it.`,
        `${w.first} is ${$} richer. First round tonight is on ${w.first}.`,
        `The ${$} for the day goes to ${w.first}.`,
        `${$} for ${w.first}. Easy money, apparently.`, `${w.first} pockets ${$} for the day.`, `That is worth ${$} to ${w.first}, and at least an hour of gloating.`, `${$} changes hands. All of it toward ${w.first}.`, `The round prize, ${$}, belongs to ${w.first}.`, `${w.first} collects ${$}. The rest collect excuses.`,
      ]),
    )
  }

  // ── How it was won: the winner's margin over the best of the rest, hole by hole ──
  const wm: number[] = [0]
  if (w) {
    const others = c.players.filter((p) => p.id !== w.id)
    for (let h = 1; h <= n; h++) wm[h] = pts(w, 1, h) - Math.max(...others.map((p) => pts(p, 1, h)))
  }
  if (w && wm[n] > 0 && c.players.length > 1) {
    let ledFrom = n
    while (ledFrom > 1 && wm[ledFrom - 1] > 0) ledFrom--
    let maxLead = 0
    let maxLeadHole = 0
    let deficit = 0
    let deficitHole = 0
    for (let h = 1; h <= n; h++) {
      if (wm[h] > maxLead) [maxLead, maxLeadHole] = [wm[h], h]
      if (-wm[h] >= deficit && wm[h] < 0) [deficit, deficitHole] = [-wm[h], h]
    }
    const from = ordinalOf(ledFrom)
    if (deficit >= 3) {
      out.push(
        pick([
          `And ${w.first} had to come from behind to do it. ${cap(words(deficit))} down after the ${ordinalOf(deficitHole)}, in front for good on the ${from}.`,
          `${w.first} was ${deficit} back after the ${ordinalOf(deficitHole)} and looked finished. ${w.first} was not finished. The lead changed for the last time on the ${from}.`,
          `Don't let the final score fool you. ${w.first} trailed by ${deficit} after the ${ordinalOf(deficitHole)} and didn't lead for good until the ${from}.`,
          `A comeback. ${w.first} gave the field a ${deficit}-point head start through ${deficitHole}, then took it all back by the ${from}.`, `Nobody saw this coming after the ${ordinalOf(deficitHole)}, when ${w.first} was ${deficit} down. In front for good on the ${from}.`, `${w.first} spotted the field ${deficit} points and won anyway. The turnaround was complete by the ${from}.`, `Remember when ${w.first} was ${deficit} back after the ${ordinalOf(deficitHole)}? ${w.first} would like everyone to remember.`,
        ]),
      )
    } else if (ledFrom <= 3) {
      const big = maxLead >= wm[n] + 3 ? ` It got as big as ${maxLead} after the ${ordinalOf(maxLeadHole)}.` : ''
      out.push(
        pick([
          `${w.first} took the lead on the ${from} and never gave it back.${big}`,
          `Wire to wire, near enough. ${w.first} was in front from the ${from} on.${big}`,
          `${w.first} went to the front on the ${from}, and that was the last anyone saw of the lead.${big}`,
          `The suspense lasted until the ${from}. After that it was ${w.first} and daylight.${big}`,
          `${w.first} led from the ${from}. Everyone else spent the afternoon looking at ${w.first}'s back.${big}`, `Once ${w.first} got in front on the ${from}, that was that.${big}`, `${w.first} grabbed the lead on the ${from} and kept it in a safe place all day.${big}`, `Nobody else led after the ${from}. It was ${w.first}'s round almost from the start.${big}`, `The lead changed hands for the last time on the ${from}. Early.${big}`,
        ]),
      )
    } else if (ledFrom >= n - 2) {
      out.push(
        pick([
          `${w.first} didn't get in front for good until the ${from}. Left it late. Very late.`,
          `It was anybody's round until the ${from}, when ${w.first} finally got clear.`,
          `This one went down to the wire. ${w.first} only took the lead for good on the ${from}.`,
          `For ${ledFrom - 1} holes nobody could shake anybody. Then came the ${from}, and ${w.first}.`, `${w.first} waited until the ${from} to win it. Dramatic, and unnecessary.`, `It was undecided until the ${from}. ${w.first} picked a good time to get in front.`, `${w.first} won this one at the death, in front for good only on the ${from}.`,
        ]),
      )
    } else {
      out.push(
        pick([
          `${w.first} took the lead for good on the ${from}.`,
          `From the ${from} on, it was ${w.first}'s round.`,
          `The ${from} is where ${w.first} got in front and stayed there.`,
          `It was a contest until the ${from}. Then ${w.first} pulled clear.`, `${w.first} got in front on the ${from} and was never caught.`, `The decisive move came on the ${from}. ${w.first} led the rest of the way.`, `Everything before the ${from} was a fight. Everything after it was ${w.first}.`, `Mark the ${from} on the card. That is where ${w.first} took over.`,
        ]),
      )
    }
  }

  // ── Play of the day, and an honorable mention ──
  interface Play { rank: number; p: Pl; hole: number; kind: string; othersZero: boolean }
  const plays: Play[] = []
  for (const p of c.players)
    for (let h = 1; h <= n; h++) {
      const kind = shotOf(p.holes.get(h))
      const base = kind === 'ace' ? 300 : kind === 'albatross' ? 120 : kind === 'eagle' ? 100 : kind === 'birdieNetEagle' ? 50 : kind === 'netEagle' ? 40 : 0
      if (!base || !kind) continue
      const othersZero = c.players.length > 2 && c.players.every((q) => q.id === p.id || hp(q, h) === 0)
      plays.push({ rank: base + (othersZero ? 10 : 0) + (w && p.id === w.id ? 5 : 0) + hp(p, h), p, hole: h, kind, othersZero })
    }
  plays.sort((a, b) => b.rank - a.rank || a.hole - b.hole)
  const play = plays[0]
  const noun = (k: string) => (k === 'ace' ? 'a hole in one' : k === 'albatross' ? 'a true albatross' : k === 'eagle' ? 'a true eagle' : k === 'birdieNetEagle' ? 'a birdie with a shot in hand' : 'a net eagle')
  if (play) {
    const where = `the par-${parOf(play.hole)} ${ordinalOf(play.hole)}`
    const real = play.kind === 'eagle' || play.kind === 'albatross'
    const isAce = play.kind === 'ace'
    const victims = play.othersZero ? `, while the other ${words(c.players.length - 1)} walk off with nothing` : ''
    const tag = isAce
      ? pick([
          ' A hole in one! One swing. Bottom of the cup.',
          ' An ace! With witnesses! At the Board of Directors!',
          ' A hole in one! We may never see another. Frame the card, frame the ball, frame the glove.',
          ` A hole in one! The drinks tonight are on ${play.p.first}. Those are the rules, and nobody is letting it slide.`,
          ' A hole in one! I still do not believe it, and I watched it go in.',
        ])
      : real
      ? pick([' No strokes. No asterisk.', ' Gross. On the card. With witnesses.', ' Not net. A true one.', ' Somebody frame that scorecard.', ' The handicap committee has questions.', ' Drinks are on whoever makes the eagle. That is the rule.', ' That is going in the trip history.', ' You do not see many of those in this group.', ' The scorecard is being laminated.', ' Witnesses have signed statements.'])
      : pick([` ${cap(words(hp(play.p, play.hole)))} points on one hole.`, ` That's ${hp(play.p, play.hole)} points in one swing of the scoreboard.`, ` ${cap(words(hp(play.p, play.hole)))} points. Thank you, handicap.`, ` A stroke well spent: ${hp(play.p, play.hole)} points.`, ` ${cap(words(hp(play.p, play.hole)))} points, and no apology for the stroke.`])
    let line = `${isAce ? pick(['Play of the day, play of the trip, play of a lifetime.', 'There is only one play of the day, and it might be the play of the decade.', 'Stop the show. This is the only highlight that matters.', 'Play of the day. It was never going to be anything else.']) : pick(['Play of the day.', 'The shot of the day.', 'Roll the highlight.', 'Your play of the day.', 'To the highlight reel.', 'The one they will be talking about.', 'Shot of the round.', 'If you only see one highlight, see this one.', 'The moment of the day.', 'Cue the replay.'])} ${cap(where)}. ${play.p.first} makes ${noun(play.kind)}${victims}.${tag}`
    if (w && play.p.id === w.id && play.hole > 1) {
      const a = wm[play.hole - 1]
      const b = wm[play.hole]
      if (b - a >= 3 && a > 0)
        line += ` ${pick([`${w.first}'s lead went from ${a} to ${b} on one hole.`, `One hole, and the lead went from ${a} to ${b}.`, `That took the lead from ${a} to ${b}.`, `Just like that, ${a} became ${b}.`, `The lead was ${a} walking onto the tee and ${b} walking off the green.`])}${b - a >= 4 && b >= wm[n] - 2 ? pick([' That was the round.', ' Ballgame.', ' Good night, everybody.', ' Turn out the lights.', ' Thanks for coming.', '']) : ''}`
      else if (b - a >= 3) line += ` That was a ${b - a}-point swing ${w.first}'s way.`
    }
    out.push(line)
    const second = plays.find((x) => x.p.id !== play.p.id && x.rank >= 50)
    if (second) {
      const late = second.hole === n
      const at = late ? 'the last' : `the ${ordinalOf(second.hole)}`
      const quip =
        late && (!w || second.p.id !== w.id)
          ? pick([' Too late to matter, but it will come up at dinner. Repeatedly.', ' Where was that four hours ago?', ' A little late, but it counts.', ' Saving the best for when it no longer mattered.', ' Timing is everything, and that was not it.', ' The round was gone. The highlight was not.', ' Something to build on tomorrow.'])
          : pick([' That one gets mentioned at dinner.', ' Put it on the fridge.', ' Not bad at all.', ' In any other round, that leads the show.', ' A fine consolation prize.', ' Keep that one for the scrapbook.', ' Worth a mention, and it got one.'])
      out.push(`${pick(['Honorable mention:', 'Runner-up for play of the day:', 'Also on the reel:', 'And a nod to', 'Second on the reel:', 'Do not forget'])} ${second.p.first}, with ${noun(second.kind)} on ${at}.${quip}`)
    }
  }

  // ── Around the field: one line on everybody who didn't win ──
  const ctp = new Map<string, number>()
  for (const r of c.db.ctp_results) if (r.round_id === c.detail.round.id && r.player_id) ctp.set(r.player_id, (ctp.get(r.player_id) ?? 0) + 1)
  const backs = c.players.map((p) => ({ id: p.id, b: pts(p, 10, n) }))
  const usedHooks = new Set<string>()
  let ctpSaid = false
  rest.forEach((r, i) => {
    const p = r.p
    const place = ['first', 'second', 'third', 'fourth', 'fifth'][fin.rows.indexOf(r)] ?? 'next'
    const last = rest.length > 1 && i === rest.length - 1 && r.s < rest[i - 1].s
    const level = i > 0 && rest[i - 1].s === r.s ? rest[i - 1].p.first : null
    const lead = level
      ? pick([`${p.first} finishes level with ${level} on ${r.s}.`, `Also on ${r.s}: ${p.first}.`, `${p.first} matches ${level} with ${r.s}.`, `${p.first} and ${level} could not be separated, ${r.s} each.`, `Right alongside on ${r.s}: ${p.first}.`])
      : last
      ? pick([`${p.first} brings up the rear on ${r.s}.`, `And in last, ${p.first}, on ${r.s}.`, `${p.first} props up the board with ${r.s}.`, `Last place today: ${p.first}, ${r.s} points.`, `Bringing up the rear: ${p.first}, on ${r.s}.`, `${p.first} finishes at the bottom with ${r.s}.`, `At the back of the pack, ${p.first}, with ${r.s}.`, `${p.first} is last on ${r.s}. Somebody has to be.`])
      : i === 0 && winners.length === 1
        ? pick([`${p.first} finishes second on ${r.s}.`, `Second place: ${p.first}, ${r.s} points.`, `${p.first} is the runner-up on ${r.s}.`, `Best of the rest: ${p.first}, on ${r.s}.`, `${p.first} takes second with ${r.s}.`, `First loser, as the saying goes: ${p.first}, ${r.s} points.`, `${p.first} chased all day and finishes second on ${r.s}.`, `Closest to the winner: ${p.first}, with ${r.s}.`])
        : pick([`${p.first} is ${place} on ${r.s}.`, `${cap(place)} place: ${p.first}, ${r.s} points.`, `${p.first} comes in ${place} with ${r.s}.`, `${p.first} finishes ${place}, ${r.s} points.`, `In ${place}, ${p.first}, on ${r.s}.`, `${p.first}: ${place}, with ${r.s}.`])
    const f = pts(p, 1, 9)
    const b = pts(p, 10, n)
    const z = zerosIn(p, 1, n)
    const k = ctp.get(p.id) ?? 0
    const rb = realBirdiesIn(p, 1, n)
    const turnGap = w ? pts(w, 1, 9) - f : 0
    const hooks: [string, boolean, () => string][] = [
      ['back', n === 18 && backs.every((x) => x.id === p.id || x.b < b) && turnGap >= 3, () =>
        pick([
          `${p.first} actually won the back nine with ${b}, but gave ${w!.first} a ${turnGap}-point head start at the turn. You can't do that.`,
          `Best back nine of the day, ${b} points. The problem was the ${turnGap}-point hole ${p.first} dug on the front.`,
          `${p.first} outscored everyone coming home, ${b} points. Shame about the front nine.`,
          `${b} points on the back, more than anybody. If the round had started on the 10th, ${p.first} is your winner.`, `${p.first} played the back nine in ${b}, the best of the day. The front nine cost ${turnGap} points to ${w!.first}, and the round.`, `Nobody beat ${p.first} on the back nine, ${b} points. Unfortunately all eighteen count.`, `${p.first} won the second half, ${b} points. The first half was the issue.`,
        ])],
      ['ctp', k >= 2, () =>
        last
          ? pick([
              `But ${p.first} won ${words(k)} closest to the pins. Last on the card, first to the cash.`,
              `On the bright side, ${words(k)} closest to the pins. ${p.first} lost the round and still gets paid.`,
              `${cap(words(k))} closest to the pins, though. ${p.first} can't score, but ${p.first} can hit a green.`,
              `Don't feel too bad: ${words(k)} closest to the pins. ${p.first} is running a side business on the par 3s.`, `Consolation: ${words(k)} closest to the pins. The irons work. Everything else is under review.`, `${cap(words(k))} closest to the pins, mind you. ${p.first} is a par 3 specialist trapped in an eighteen-hole game.`, `${p.first} did win ${words(k)} closest to the pins, so the wallet is fine even if the scorecard isn't.`,
            ])
          : pick([`${p.first} also owned the par 3s, ${words(k)} closest to the pins.`, `Plus ${words(k)} closest to the pins. The par 3s were ${p.first}'s.`, `And ${words(k)} closest to the pins, which pays in its own way.`, `${cap(words(k))} closest to the pins on top of that.`, `With ${words(k)} closest to the pins for good measure.`, `${p.first} also cleaned up on the par 3s: ${words(k)} closest to the pins.`])],
      ['slow', n === 18 && b - f >= 7, () =>
        pick([
          `${f} going out, ${b} coming home. Somebody tell ${p.first} the round starts on the 1st.`,
          `${f} on the front, ${b} on the back. ${p.first} is a second-half team.`,
          `A tale of two nines: ${f} out, ${b} back. ${p.first} needed nine holes to find the golf course.`,
          `${f} on the front nine. ${b} on the back. The warm-up took a while.`, `${f} out and ${b} back. The first nine was a practice round, apparently.`, `${p.first} woke up at the turn: ${f} going out, ${b} coming in.`, `${f}, then ${b}. If only somebody had mentioned the front nine counts.`, `A slow start, ${f} on the front, and a strong finish, ${b} on the back. Too little, too late.`,
        ])],
      ['fade', n === 18 && f - b >= 7, () =>
        pick([
          `${f} out, ${b} back. The legs went somewhere around the turn.`,
          `${f} on the front, ${b} on the back. ${p.first} peaked early.`,
          `Started hot, ${f} going out. Finished cold, ${b} coming in.`,
          `${f} on the front and ${b} on the back. Blame the hot dog at the turn.`, `${f} going out, ${b} coming home. The wheels came off at the turn.`, `${p.first} had it going, ${f} on the front. Then came the back nine, and ${b}.`, `${f} then ${b}. A round of two halves, and only one of them was good.`, `The front nine said ${f}. The back nine said ${b}. The back nine was louder.`,
        ])],
      ['zeros', z >= 3, () =>
        pick([
          `${cap(words(z))} zeros on the card. That's the difference right there.`,
          `${p.first} took ${words(z)} zeros. You can't win with ${words(z)} zeros.`,
          `${cap(words(z))} holes with nothing on them. That scorecard has gaps.`,
          `${cap(words(z))} zeros. The other holes were fine. There just weren't enough of them.`, `${cap(words(z))} zeros did the damage.`, `Take away the ${words(z)} zeros and it is a different day. Nobody takes them away.`, `${cap(words(z))} blank holes. That is a lot of walking for nothing.`, `${p.first} left points out there on ${words(z)} holes. All of the points, in fact.`,
        ])],
      ['birdies', rb >= 2, () =>
        pick([`${cap(words(rb))} true birdies, though. The golf was in there somewhere.`, `There were ${words(rb)} true birdies in that. Just not enough around them.`, `${cap(words(rb))} true birdies on the card, for what it's worth.`, `${cap(words(rb))} true birdies in there, which makes the total harder to explain.`, `${p.first} did make ${words(rb)} true birdies. The rest of the card let the side down.`, `Credit where due: ${words(rb)} true birdies.`])],
    ]
    const live = hooks.filter(([, ok]) => ok)
    const hook = live.find(([name]) => !usedHooks.has(name)) ?? live[0]
    if (hook) {
      usedHooks.add(hook[0])
      if (hook[0] === 'ctp') ctpSaid = true
    }
    const tail = hook ? hook[2]() : pick(['Nothing flashy.', `Not the day ${p.first} wanted.`, 'Solid, and not much more to say.', 'A quiet day at the office.', 'No fireworks.', 'One to forget.', `${p.first} will want that one back.`, 'Tomorrow is another day.', 'Nothing to see here.', ''])
    out.push(`${lead} ${tail}`.trim())
  })
  if (!ctpSaid && ctp.size > 0) {
    const list = [...ctp.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, k]) => `${c.players.find((p) => p.id === id)?.first ?? ''}, ${words(k)}`)
      .join('. ')
    out.push(pick([`Closest to the pins today: ${list}. Settled at the nineteenth hole.`, `On the par 3s: ${list}. That gets settled later.`, `Your closest to the pin winners: ${list}.`, `Closest to the pin money goes to: ${list}.`, `And on the short holes: ${list}.`]))
  }

  // ── One for the blooper reel ──
  const bloopers: { rank: number; text: () => string }[] = []
  if (w && zerosIn(w, 1, n) === 1 && hp(w, n) === 0 && n > 1) {
    const safe = wm[n - 1] >= 5
    bloopers.push({
      rank: 9,
      text: () =>
        pick([
          safe
            ? `${w.first} went ${n - 1} holes without a zero, then took one on the last with the round already won. We're calling it a victory lap.`
            : `${w.first} went ${n - 1} holes without a zero, then took one on the last and made everybody sweat.`,
          `${w.first}'s only zero of the day came on the last hole. Already thinking about dinner.`,
          `${cap(words(n - 1))} holes of points for ${w.first}, and then a zero on the ${ordinalOf(n)}. Showboating.`,
          `${w.first} was perfect for ${n - 1} holes and then took a zero on the last. Nobody is perfect. ${w.first} came close and then didn't.`, `${w.first} put points on ${n - 1} straight holes and then took a zero on the ${ordinalOf(n)}. The only blemish on the card.`, `The winner's lowlight: a zero on the last hole, the only one ${w.first} took all day.`,
        ]),
    })
  }
  for (const p of c.players) {
    let run = 0
    let best = 0
    let bestEnd = 0
    for (let h = 1; h <= n; h++) {
      run = hp(p, h) === 0 && p.holes.get(h)?.completed ? run + 1 : 0
      if (run > best) [best, bestEnd] = [run, h]
    }
    if (best >= 3)
      bloopers.push({
        rank: 5 + best,
        text: () =>
          pick([
            `${p.first} took zeros on ${words(best)} straight, from the ${ordinalOf(bestEnd - best + 1)} to the ${ordinalOf(bestEnd)}. We will not be showing the replay.`,
            `${cap(words(best))} straight zeros for ${p.first}, starting on the ${ordinalOf(bestEnd - best + 1)}. The less said, the better.`,
            `${p.first}, the ${ordinalOf(bestEnd - best + 1)} through the ${ordinalOf(bestEnd)}: nothing, nothing, and more nothing. Moving on.`,
            `Somewhere between the ${ordinalOf(bestEnd - best + 1)} and the ${ordinalOf(bestEnd)}, ${p.first} stopped playing golf. ${cap(words(best))} zeros in a row.`, `${p.first} went ${words(best)} holes without a point, the ${ordinalOf(bestEnd - best + 1)} through the ${ordinalOf(bestEnd)}. A stretch best left unmentioned, so here it is.`, `${cap(words(best))} in a row with nothing for ${p.first}, ending on the ${ordinalOf(bestEnd)}. Mercifully.`, `From the ${ordinalOf(bestEnd - best + 1)} to the ${ordinalOf(bestEnd)}, ${p.first} contributed ${words(best)} zeros and some colorful language.`,
          ]),
      })
    let ups = 0
    for (let h = 1; h <= n; h++) if (p.holes.get(h)?.pickedUp) ups++
    if (ups >= 2)
      bloopers.push({
        rank: 4 + ups,
        text: () => pick([`${p.first} picked up ${words(ups)} times. The ball spent more time in the pocket than on the green.`, `${cap(words(ups))} pick-ups for ${p.first}. Pace of play has never been better.`, `${p.first} picked up on ${plural(ups, 'hole')}. Knowing when to quit is a skill.`, `${cap(words(ups))} times ${p.first} decided the hole had won. Fair enough.`, `${p.first} and the ball agreed to stop on ${plural(ups, 'hole')}.`]),
      })
  }
  for (let h = 1; h <= n; h++) {
    if (play && play.hole === h) continue
    const victims = c.players.filter((p) => p.holes.get(h)?.completed && hp(p, h) === 0)
    if (victims.length >= 3 && c.players.length >= 3) {
      const names = victims.length === c.players.length ? 'the whole group' : listOf(victims.map((p) => p.first))
      bloopers.push({
        rank: 6 + victims.length,
        text: () => pick([`The ${ordinalOf(h)} claimed ${words(victims.length)} victims: zeros for ${names}.`, `Nobody wants to talk about the ${ordinalOf(h)}. Zeros for ${names}.`, `The par-${parOf(h)} ${ordinalOf(h)} owes this group an apology. Zeros for ${names}.`, `Somebody should check on the ${ordinalOf(h)}. It took points from ${names}.`, `The ${ordinalOf(h)} was a crime scene. Zeros for ${names}.`]),
      })
      break
    }
  }
  for (let h = 1; h <= n; h++)
    for (const x of blowUps(c, h))
      bloopers.push({
        rank: 8 + x.over,
        text: () =>
          pick([
            `${x.p.first} made ${an(x.gross)} ${x.gross} on the par-${parOf(h)} ${ordinalOf(h)}. ${cap(an(x.gross))} ${x.gross}. We have the scorecard.`,
            `The par-${parOf(h)} ${ordinalOf(h)}, where ${x.p.first} needed ${x.gross} shots. That hole is still going in ${x.p.first}'s head.`,
            `${x.p.first}, the ${ordinalOf(h)}, ${an(x.gross)} ${x.gross}. No further questions.`,
            `${cap(an(x.gross))} ${x.gross} for ${x.p.first} on the ${ordinalOf(h)}. That's ${words(x.over)} over par on one hole, for those counting. ${x.p.first} was counting.`, `We need to talk about the ${ordinalOf(h)}, where ${x.p.first} made ${an(x.gross)} ${x.gross}. Actually, we don't. ${x.p.first} would prefer we didn't.`, `${x.p.first} took ${x.gross} on the ${ordinalOf(h)}. The hole is a par ${parOf(h)}. Just for reference.`, `The ${ordinalOf(h)} beat ${x.p.first} up and took ${x.gross} shots doing it.`,
          ]),
      })
  const blooper = bloopers.sort((a, b) => b.rank - a.rank)[0]
  if (blooper) out.push(`${pick(['From the blooper reel.', 'Not on the highlight reel.', 'And now the lowlight.', 'One for the blooper reel.', 'And the moment nobody asked to relive.', 'Now for something less flattering.', 'The lowlight of the day.', 'Not everything was pretty.'])} ${blooper.text()}`)
  return out
}

function finalCall(c: Ctx, pick: Pick): string[] {
  if (roundsAfter(c).length === 0) return tripFinale(c, pick)
  const out: string[] = [pick([
      `Live from ${c.course}, where round ${c.roundNumber} is in the books. Let's go to the highlights.`,
      `Round ${c.roundNumber} on ${c.course} is final, and we have highlights, lowlights, and a winner.`,
      `Welcome to the round ${c.roundNumber} post-game show, live from ${c.course}.`,
      `The final putt has dropped on ${c.course}. This is your round ${c.roundNumber} wrap.`,
      `From ${c.course}, this is the round ${c.roundNumber} post-game show. Somebody played well. Not everybody.`,
      `Scorecards are signed on ${c.course}. Here's your round ${c.roundNumber} highlight show.`,
      `Round ${c.roundNumber} is over on ${c.course}, and the excuses are just getting started. To the highlights.`,
      `That's a final on ${c.course}. Round ${c.roundNumber}, the good, the bad, and the scorecard.`,
      `Here's how round ${c.roundNumber} went on ${c.course}.`,
      `The final word from ${c.course}, round ${c.roundNumber}.`,
      `Round ${c.roundNumber} on ${c.course} is in the books. Here's how it went.`,
      `That's a wrap on ${c.course}. Let's run it back.`,
      `Your round ${c.roundNumber} recap, from ${c.course}.`,
      `Round ${c.roundNumber} on ${c.course} is done. Here's the tape, unedited, no matter who asks.`,
      `Round ${c.roundNumber} on ${c.course}, in the books. Here's the story.`,
      `That's round ${c.roundNumber} done on ${c.course}. Let's go back through it.`,
      `The round ${c.roundNumber} wrap from ${c.course}.`,
      `Round ${c.roundNumber} is over on ${c.course}. Here's how it unfolded.`,
      `From ${c.course}, the full story of round ${c.roundNumber}.`,
      `Round ${c.roundNumber} at ${c.course}: here's the replay.`,
    ])]
  out.push(...wrapShow(c, pick))
  out.push(...(weekWrap(c, pick) ?? weekStakes(c, pick, true)))
  const next = roundsAfter(c)[0]
  if (next) {
    const course = c.db.courses.find((x) => x.id === next.course_id)
    const tee = formatTeeTime(next.tee_time)
    out.push(`Next up: ${course ? courseRef(course.name) : `round ${next.round_number}`}${tee ? `, at ${tee.replace(/ ET$/, '')}` : ''}.`)
  }
  out.push(pick([
      "That's the round.",
      "That's the round. Somebody's buying.",
      "That's the round. Hydrate. Stretch. Lie about it later.",
      "That's the round. See you at the nineteenth hole.",
      "That's the round. Ice the back, settle the shits.",
      "That's the round. The stories will get better by dinner.",
      "That's the round. Back to you in the bar.",
      "That's the round. What happens on the course gets exaggerated at dinner.",
      "That's the round. Showers, then stories.",
      "That's the round. Time to settle up.",
      "That's the round. Feet up, drinks in hand.",
      "That's the round. Tomorrow is a new day.",
      "That's the round. Go stretch something.",
      "That's the round. The excuses start now.",
      "That's the round. Back to you at dinner.",
      "That's the round. Well played, mostly.",
    ]))
  return out
}

/**
 * After the final putt of the trip (Kyle 2026-10-11): the champion, how the last round ended, the
 * final standings, all the money, the closest-to-the-pin king, the shits, and the goodbye. Plays
 * in place of the normal wrap when the last round of the trip is complete.
 */
function tripFinale(c: Ctx, pick: Pick): string[] {
  const st = buildStandings(c.db)
  const rows = st.rows
  if (rows.length < 2) return []
  const fullName = (id: string) => c.db.players.find((p) => p.id === id)?.name ?? 'Unknown'
  const short = (id: string) => first(fullName(id))
  const rounds = c.db.rounds.filter((r) => r.status !== 'abandoned').sort((a, b) => a.round_number - b.round_number)
  const totalHoles = rounds.reduce((sum, r) => sum + (r.holes_counted ?? 18), 0)
  const champs = rows.filter((r) => r.position === 1)
  const runnerUp = rows.find((r) => r.position > 1) ?? null
  const margin = runnerUp ? champs[0].total - runnerUp.total : 0
  const out: string[] = []

  out.push(
    pick([
      `That's it. ${totalHoles} holes. The Board of Directors, twenty twenty-seven, is in the books.`,
      `And that, ladies and gentlemen, is the Board of Directors, twenty twenty-seven. ${totalHoles} holes, and it's over.`,
      `It's over. ${totalHoles} holes, and the Board of Directors, twenty twenty-seven, has a winner.`,
      `${totalHoles} holes, a lot of sunscreen, and more excuses than we can count. The Board of Directors, twenty twenty-seven, is done.`,
      `${totalHoles} holes later, the Board of Directors, twenty twenty-seven, is complete.`,
      `The last putt has dropped. ${totalHoles} holes, and the Board of Directors, twenty twenty-seven, is over.`,
      `That's the final hole of the trip. ${totalHoles} holes, done.`,
      `And just like that, it's over. ${totalHoles} holes of the Board of Directors, twenty twenty-seven.`,
    ]),
  )

  // A finish within three points was decided on the last hole whether or not anything "happened"
  // there, so it always gets a call: where the two stood for the WEEK on the last tee, and what
  // each made. It plays after the champion is named. Otherwise the last hole is called only if
  // it had something in it.
  let closing = ''
  const cp = champs.length === 1 ? c.players.find((p) => p.id === champs[0].playerId) : undefined
  const rp = runnerUp ? c.players.find((p) => p.id === runnerUp.playerId) : undefined
  if (cp && rp && margin >= 1 && margin <= 3) {
    const made = (p: Pl) => {
      const hr = p.holes.get(c.n)
      const kind = shotOf(hr)
      return kind && kind !== 'blank' ? SHOT[kind].noun : (hr?.points ?? 0) === 2 ? 'a net par' : (hr?.points ?? 0) === 1 ? 'a net bogey' : 'a zero'
    }
    const a = cp.holes.get(c.n)?.points ?? 0
    const b = rp.holes.get(c.n)?.points ?? 0
    const before = margin - (a - b) // the champion's lead for the week standing on the last tee
    const on = ordinalOf(c.n)
    const [C, R] = [cp.first, rp.first]
    closing =
      before < 0
        ? pick([
            `And it turned over on the very last hole. ${R} stood on the ${on} tee ${plural(-before, 'point')} ahead for the week. ${C} made ${made(cp)}, ${R} made ${made(rp)}, and the trip changed hands.`,
            `${R} had it. ${cap(plural(-before, 'point'))} up for the week with one hole to play. Then ${C} made ${made(cp)} on the ${on}, ${R} made ${made(rp)}, and it was gone.`,
            `Stolen on the last. ${R} led the week by ${-before} on the ${on} tee. ${cap(made(cp))} for ${C}, ${made(rp)} for ${R}, and a new champion.`,
          ])
        : before === 0
          ? pick([
              `They came to the ${on} tee dead level for the week. ${C} made ${made(cp)}. ${R} made ${made(rp)}. That was the whole trip.`,
              `${totalHoles - 1} holes could not separate ${C} and ${R}. The last one did: ${made(cp)} for ${C}, ${made(rp)} for ${R}.`,
              `All square for the week on the last tee. ${C} made ${made(cp)} on the ${on}, ${R} made ${made(rp)}, and that settled everything.`,
            ])
          : a >= b
            ? pick([
                `It went to the last hole. ${C} came to the ${on} tee ${plural(before, 'point')} ahead for the week and made ${made(cp)}. ${R} made ${made(rp)}, and it was not enough.`,
                `${R} needed something on the ${on}, ${plural(before, 'point')} back for the week. ${R} made ${made(rp)}. ${C} made ${made(cp)}, and held on.`,
                `${cap(plural(before, 'point'))} in it on the last tee. ${C} made ${made(cp)} on the ${on}, ${R} made ${made(rp)}, and the lead survived.`,
              ])
            : pick([
                `${R} made it interesting. ${cap(made(rp))} on the ${on} to ${made(cp)} for ${C}, and a ${before}-point lead for the week came down to ${margin}. One hole too few.`,
                `It nearly got away. ${C} led the week by ${before} on the last tee, made ${made(cp)}, and watched ${R} make ${made(rp)}. ${C} survives by ${margin}.`,
                `${R} took ${words(b - a)} back on the ${on}, ${made(rp)} to ${made(cp)}, but ran out of holes. ${cap(plural(margin, 'point'))} short.`,
              ])
  }
  const lastHole = closing ? '' : holeCall(c, c.n, pick)
  if (lastHole) out.push(`${pick(['The last hole of the trip.', 'One last hole to report.', 'And the final hole.', 'The last word from the course.', 'One more hole to call.', 'Before the trophy, the final hole.'])} ${lastHole}`)

  // The week round by round: cumulative totals, and who led alone on points after each round.
  const played = rounds.filter((r) => r.status === 'final' || r.round_number === c.roundNumber)
  const whereOf = (i: number) => {
    const course = c.db.courses.find((x) => x.id === played[i].course_id)
    return course ? courseRef(course.name) : `round ${played[i].round_number}`
  }
  const cum = new Map<string, number[]>()
  for (const r of rows) {
    let t = 0
    cum.set(r.playerId, played.map((pr) => (t += r.byRound.find((e) => e.roundNumber === pr.round_number && e.counts)?.points ?? 0)))
  }
  const leadAfter = played.map((_, i) => {
    const xs = rows.map((r) => ({ id: r.playerId, t: cum.get(r.playerId)![i] })).sort((a, b) => b.t - a.t)
    return xs.length > 1 && xs[0].t > xs[1].t ? xs[0].id : null
  })

  // The champion.
  if (champs.length > 1) {
    out.push(`We have co-champions! ${listOf(champs.map((r) => fullName(r.playerId)))} share the title, level after every tiebreaker.`)
  } else {
    const champ = champs[0]
    out.push(pick([`${fullName(champ.playerId)} is your champion!`, `Your champion of the Board of Directors… ${fullName(champ.playerId)}!`, `Ladies and gentlemen, your champion: ${fullName(champ.playerId)}!`, `Pop the champagne, or at least the light beer. ${fullName(champ.playerId)} is your champion!`, `And the champion of the Board of Directors, twenty twenty-seven: ${fullName(champ.playerId)}!`, `${fullName(champ.playerId)}, champion!`, `Raise a glass. ${fullName(champ.playerId)} is your champion!`, `The new champion of the Board of Directors: ${fullName(champ.playerId)}!`]))
    const how = st.tiebreakNote?.match(/leads on (.*)\.$/)?.[1]
    if (margin === 0 && how) out.push(`Level on points with ${short(runnerUp!.playerId)}, and ${short(champ.playerId)} wins it on ${how}. You cannot make this up.`)
    else if (margin === 1) out.push(`One point. ${totalHoles} holes, and it comes down to one point.`)
    else if (margin <= 3) out.push(`${cap(words(margin))} points. A photo finish over ${totalHoles} holes.`)
    else if (margin >= 10) out.push(`${margin} points clear. That wasn't a tournament, that was a statement.`)
    else out.push(pick([`${short(champ.playerId)} wins it by ${margin}, and it was never really in doubt.`, `${short(champ.playerId)} wins it by ${margin}. Earned, every point of it.`, `${short(champ.playerId)} wins by ${margin}. Bragging rights secured for a full calendar year.`, `${short(champ.playerId)} wins by ${margin}. Clean, clear, and well earned.`, `${short(champ.playerId)} by ${margin}. A deserving champion.`, `${short(champ.playerId)} takes it by ${margin}. Somebody get the trophy polished.`]))
    if (closing) out.push(closing)
    // How the week was won: wire to wire, taken for good on a given day, or only on the last one.
    const L = played.length - 1
    if (L >= 1 && leadAfter[L] === champ.playerId) {
      const C = short(champ.playerId)
      const mine = cum.get(champ.playerId)!
      const behind = played.map((_, i) => Math.max(...rows.filter((r) => r.playerId !== champ.playerId).map((r) => cum.get(r.playerId)![i])) - mine[i])
      let good = L
      while (good > 0 && leadAfter[good - 1] === champ.playerId) good--
      const firstLed = leadAfter.indexOf(champ.playerId)
      let maxDef = 0
      let maxDefAt = 0
      behind.forEach((d, i) => {
        if (i < L && d > maxDef) [maxDef, maxDefAt] = [d, i]
      })
      if (good === 0) {
        out.push(
          pick([
            `${C} led after every one of the ${words(played.length)} rounds. Wire to wire.`,
            `${C} was in front after day one and stayed there all week.`,
            `Nobody else led this thing after a single round. It was ${C}'s week from ${whereOf(0)} on.`,
          ]),
        )
      } else if (good === L) {
        const d = behind[L - 1]
        out.push(
          firstLed < L
            ? pick([
                `${C} had the lead, lost it, and came into the last day ${d > 0 ? `${d} back` : 'level'}. ${C} leaves as champion.`,
                `A week of swings for ${C}: in front after ${whereOf(firstLed)}, ${d > 0 ? `${d} behind` : 'level'} going into ${whereOf(L)}, and champion at the end of it.`,
                `${C} led this week, gave it away, and took it back on the final day.`,
              ])
            : pick([
                `${C} did not lead the week until the last day. ${d > 0 ? `${cap(words(d))} back` : 'Level'} going into ${whereOf(L)}, and champion coming out of it.`,
                `${C} trailed all week and won it on the final day${d > 0 ? `, from ${d} back` : ''}.`,
                `For ${L === 1 ? 'a day' : `${words(L)} days`} somebody else led. On the last one, ${C} took it${d > 0 ? `, making up ${d}` : ''}.`,
              ]),
        )
      } else {
        const tail = maxDef > 0 && maxDefAt < good ? ` after being ${maxDef} back following ${whereOf(maxDefAt)}` : ''
        out.push(
          pick([
            `${C} took the lead for good on ${whereOf(good)}${tail}, and never gave it up.`,
            `The week turned on ${whereOf(good)}. ${C} went in front there${tail} and stayed in front.`,
            `${C} has led since ${whereOf(good)}${tail}. Nobody got back past.`,
          ]),
        )
      }
    }
  }

  out.push(`Final standings. ${rows.map((r) => `${short(r.playerId)}, ${r.total}`).join('. ')}.`)
  // The money: 1st and 2nd (only when the places are clean), then who took each round.
  const purse = purseSettingsOf(c.db)
  if (champs.length === 1 && runnerUp && purse.champFirstCents > 0 && rows.filter((r) => r.position === runnerUp.position).length === 1) {
    out.push(`${dollars(purse.champFirstCents)} to the champion. ${dollars(purse.champSecondCents)} to ${short(runnerUp.playerId)}${margin <= 2 ? `, who will be thinking about ${margin === 1 ? 'that one point' : 'those points'} until next February` : ''}.`)
  }
  const roundWins = new Map<string, string[]>()
  for (const r of rounds) {
    if (r.status !== 'final' && r.round_number !== c.roundNumber) continue
    const detail = buildRoundDetail(r.round_number, c.db)
    if (!detail) continue
    const { ids } = resolveRoundWinnerIds(detail)
    if (ids.length !== 1) continue
    const course = c.db.courses.find((x) => x.id === r.course_id)
    roundWins.set(ids[0], [...(roundWins.get(ids[0]) ?? []), course ? courseRef(course.name) : `round ${r.round_number}`])
  }
  if (roundWins.size > 0 && rounds.length > 1) {
    const parts = [...roundWins.entries()].map(([id, cs]) => `${short(id)} took ${listOf(cs)}`)
    out.push(`Round by round: ${listOf(parts)}${purse.roundWinnerCents > 0 ? `, at ${dollars(purse.roundWinnerCents)} a round` : ''}.`)
  }

  // ── The trip's highlight reel: every round's holes, read once ──
  const RANK: Record<string, number> = { albatross: 120, eagle: 100, birdieNetEagle: 50, netEagle: 40 }
  let playOfTrip: { who: string; kind: string; hole: number; par: number; where: string; rank: number } | null = null
  let worst: { who: string; gross: number; over: number; hole: number; par: number; where: string } | null = null
  let aces = 0
  const zeros = new Map<string, number>()
  const days = new Map<string, { pts: number; where: string }[]>()
  for (const r of rounds) {
    if (r.status !== 'final' && r.round_number !== c.roundNumber) continue
    const detail = buildRoundDetail(r.round_number, c.db)
    const course = c.db.courses.find((x) => x.id === r.course_id)
    const where = course ? courseRef(course.name) : `round ${r.round_number}`
    const playing = (detail?.players ?? []).filter((q) => q.status === 'playing')
    const wonRound = detail ? resolveRoundWinnerIds(detail).ids : []
    for (const p of detail?.players ?? []) {
      if (p.status !== 'playing') continue
      days.set(p.playerId, [...(days.get(p.playerId) ?? []), { pts: p.totalPoints, where }])
      for (const hr of p.holeResults) {
        if (!hr.completed) continue
        if ((hr.points ?? 0) === 0) zeros.set(p.playerId, (zeros.get(p.playerId) ?? 0) + 1)
        const kind = shotOf(hr)
        if (kind === 'ace') {
          aces++
          out.push(`${aces === 1 ? 'Play of the trip, and it was never going to be anything else:' : 'And another one:'} ${first(p.name)} made a hole in one on the ${ordinalOf(hr.holeNumber)} at ${where}. A hole in one!`)
        } else if (kind && RANK[kind]) {
          // Between like shots, the one that mattered: it left the rest of the group with nothing,
          // or it was made by the player who went on to win that round (the wrap's own rule).
          const alone = playing.length > 2 && playing.every((q) => q.playerId === p.playerId || (q.holeResults.find((x) => x.holeNumber === hr.holeNumber)?.points ?? 0) === 0)
          const rank = RANK[kind] + (hr.points ?? 0) + (alone ? 10 : 0) + (wonRound.includes(p.playerId) ? 5 : 0)
          if (!playOfTrip || rank > playOfTrip.rank) playOfTrip = { who: first(p.name), kind, hole: hr.holeNumber, par: hr.par, where, rank }
        }
        if (!hr.pickedUp && hr.grossStrokes !== null && hr.grossStrokes - hr.par >= 4 && (!worst || hr.grossStrokes - hr.par > worst.over))
          worst = { who: first(p.name), gross: hr.grossStrokes, over: hr.grossStrokes - hr.par, hole: hr.holeNumber, par: hr.par, where }
      }
    }
  }
  if (aces === 0 && playOfTrip) {
    const pt = playOfTrip
    out.push(`${pick(['Play of the trip:', 'The shot of the week:', 'Your play of the trip:', 'The highlight of the whole week:', 'The one shot we are taking home:', 'Shot of the trip:'])} ${pt.who}, ${SHOT[pt.kind].noun} on the par-${pt.par} ${ordinalOf(pt.hole)} at ${pt.where}.${pick([' Still talking about it.', ' That one comes home with us.', ' Put it in the trip history.', ' Nobody topped it.', ' The best thing anyone hit all week.', ''])}`)
  }
  // Everyone else's week in a line, each from a different angle so three in a row don't read as
  // the same sentence: led the week and lost it, a trend, a strong or weak last day, a slow first
  // day, steady all week, and only then the plain best day / worst day. A player with no angle
  // left is skipped; the standings already named everyone.
  if (played.length > 1) {
    const usedAngles = new Set<string>()
    const PLACE = ['first', 'second', 'third', 'fourth', 'fifth']
    rows.forEach((r, idx) => {
      if (champs.includes(r)) return
      const ds = days.get(r.playerId) ?? []
      if (ds.length < 2) return
      const who = short(r.playerId)
      const hi = ds.reduce((x, y) => (y.pts > x.pts ? y : x))
      const lo = ds.reduce((x, y) => (y.pts < x.pts ? y : x))
      const lastDay = ds[ds.length - 1]
      const scores = ds.map((d) => d.pts).join(', ')
      const ledOn = played.map((_, i) => i).filter((i) => i < played.length - 1 && leadAfter[i] === r.playerId)
      const up = ds.length >= 3 && ds.every((d, i) => i === 0 || d.pts > ds[i - 1].pts)
      const down = ds.length >= 3 && ds.every((d, i) => i === 0 || d.pts < ds[i - 1].pts)
      const angles: [string, number, () => string][] = []
      if (ledOn.length)
        angles.push(['led', 30, () => {
          const courses = listOf(ledOn.map(whereOf))
          const place = PLACE[idx] ?? 'down the board'
          return pick([`${who} led the week after ${courses} and finished ${place}. That one will sting.`, `${who} had this trip in hand after ${courses}. ${who} finishes ${place}.`, `After ${courses}, ${who} was the leader. It did not last.`])
        }])
      if (up) angles.push(['trend', 24, () => pick([`${who} got better every single day: ${scores}. One more round and who knows.`, `${who} improved every day of the trip, from ${ds[0].pts} to ${lastDay.pts}.`, `${who} went the right way all week: ${scores}. Just started too far back.`])])
      if (down) angles.push(['trend', 24, () => pick([`${who} went the wrong way all week: ${scores}.`, `${who} peaked on day one with ${ds[0].pts}, and it was downhill from there to ${lastDay.pts}.`, `Every day a little worse for ${who}: ${scores}.`])])
      if (hi === lastDay && ds.every((d) => d === hi || hi.pts - d.pts >= 3))
        angles.push(['finish', 16, () => pick([`${who} saved the best for last: ${hi.pts} on ${hi.where}.`, `${who} found it on the final day, ${hi.pts} on ${hi.where}. A week too late.`, `${who}'s best round was the last one, ${hi.pts}. Typical.`])])
      if (lo === lastDay && ds.every((d) => d === lo || d.pts - lo.pts >= 3))
        angles.push(['finish', 16, () => pick([`${who} ran out of steam: ${lo.pts} on the last day, the worst of the week.`, `${who} limped home with ${lo.pts} on ${lo.where}, the low point of the trip.`, `The last day was not kind to ${who}: ${lo.pts}, the worst round of the week.`])])
      if (lo === ds[0] && ds.slice(1).every((d) => d.pts - lo.pts >= 3))
        angles.push(['start', 14, () => pick([`${who} needed a day to get going: ${lo.pts} on ${lo.where}, and never that bad again.`, `${who} spotted the field a round. ${lo.pts} on ${lo.where} to open, and much better after.`, `Take away ${lo.where}, where ${who} made ${lo.pts}, and it is a different week.`])])
      if (hi.pts - lo.pts <= 3)
        angles.push(['steady', 12, () =>
          hi.pts === lo.pts
            ? `${who}'s week: ${hi.pts} every single day. A metronome.`
            : pick([`${who} was the same golfer every day: between ${lo.pts} and ${hi.pts} all week.`, `No highs, no lows for ${who}. ${lo.pts} to ${hi.pts}, every round.`, `${who}, a model of consistency: never worse than ${lo.pts}, never better than ${hi.pts}.`])])
      if (hi.pts > lo.pts)
        angles.push(['range', 8, () =>
          pick([
            `${who}'s week: a high of ${hi.pts} on ${hi.where}, a low of ${lo.pts} on ${lo.where}.`,
            `${who} peaked on ${hi.where} with ${hi.pts} and bottomed out on ${lo.where} with ${lo.pts}.`,
            `For ${who}, the best day was ${hi.where}, ${hi.pts} points. The one to forget was ${lo.where}, ${lo.pts}.`,
            `${who}: ${hi.pts} on ${hi.where}, the good day. ${lo.pts} on ${lo.where}, the other kind.`,
            `${who} would like to be remembered for ${hi.where}, ${hi.pts} points, and not for ${lo.where}, ${lo.pts}.`,
            `${who} had ${hi.where}, ${hi.pts} points. ${who} also had ${lo.where}, ${lo.pts}.`,
            `The range for ${who}: ${hi.pts} at the top, on ${hi.where}, and ${lo.pts} at the bottom, on ${lo.where}.`,
          ])])
      const angle = angles.sort((x, y) => y[1] - x[1]).find(([kind]) => !usedAngles.has(kind))
      if (!angle) return
      usedAngles.add(angle[0])
      out.push(angle[2]())
    })
  }
  // Blooper of the week: the worst single hole, else whoever took the most zeros.
  if (worst) {
    const x = worst
    out.push(pick([`Blooper of the week: ${x.who}, ${an(x.gross)} ${x.gross} on the par-${x.par} ${ordinalOf(x.hole)} at ${x.where}. It will not be forgotten. It will not be allowed to be.`, `And the hole nobody will let ${x.who} forget: ${an(x.gross)} ${x.gross} on the ${ordinalOf(x.hole)} at ${x.where}.`, `Lowlight of the trip: the par-${x.par} ${ordinalOf(x.hole)} at ${x.where}, where ${x.who} made ${an(x.gross)} ${x.gross}.`, `The hole of the week, for the wrong reasons: ${x.who}'s ${x.gross} on the ${ordinalOf(x.hole)} at ${x.where}.`, `One number will follow ${x.who} home: ${x.gross}, on the par-${x.par} ${ordinalOf(x.hole)} at ${x.where}.`]))
  } else {
    const zs = [...zeros.entries()].sort((x, y) => y[1] - x[1])
    if (zs.length > 0 && zs[0][1] >= 5 && (zs.length === 1 || zs[0][1] > zs[1][1]))
      out.push(pick([`Blooper of the week goes to ${short(zs[0][0])}: ${zs[0][1]} zeros over ${totalHoles} holes. Most in the field.`, `The zero king of the trip: ${short(zs[0][0])}, with ${zs[0][1]}. Somebody had to be.`, `${short(zs[0][0])} led the field in one category: zeros. ${zs[0][1]} of them.`, `Most zeros of the trip: ${short(zs[0][0])}, ${zs[0][1]}. A title nobody wanted.`, `${zs[0][1]} zeros for ${short(zs[0][0])} this week. The scorecard had some quiet moments.`]))
  }
  // The closest-to-the-pin king of the week, paid at the nineteenth hole.
  const ctp = new Map<string, number>()
  for (const r of c.db.ctp_results) if (r.player_id) ctp.set(r.player_id, (ctp.get(r.player_id) ?? 0) + 1)
  const ctpTop = [...ctp.entries()].sort((a, b) => b[1] - a[1])
  if (ctpTop.length > 0 && (ctpTop.length === 1 || ctpTop[0][1] > ctpTop[1][1])) {
    const [id, k] = ctpTop[0]
    const isLast = rows[rows.length - 1].playerId === id
    out.push(
      isLast
        ? `And ${fullName(id)}! Last on the card, but with ${plural(k, 'closest to the pin', 'closest to the pins')}, the closest to the pin king of Streamsong.`
        : `${fullName(id)} is the closest to the pin king of Streamsong, with ${plural(k, 'closest to the pin', 'closest to the pins')}.`,
    )
  }
  out.push("Somebody's settling up at the nineteenth hole tonight. And then there's the shits. We'll let the nineteenth hole sort that out.")

  out.push(`${cap(plural(rounds.length, 'day'))}. ${cap(plural(rounds.length, 'course'))}. ${totalHoles} holes. Thank you, Streamsong. Thank you, gentlemen.`)
  out.push(pick([
      "Same time next year? That's the week. Somebody's buying.",
      "Same time next year? That's the week, and that's the trip.",
      "Same time next year? Start practicing. That's the trip.",
      "Same time next year? Start working on the excuses now. That's the trip.",
      "Same time next year? That's the trip. Thanks for listening.",
      "Same time next year? Go home, rest up. That's the trip.",
      "Same time next year? Bring a better swing. That's the trip.",
      "Same time next year? That's the Board of Directors. Good night.",
    ]))
  return out
}

/** How the group's names are actually said, respelled for a voice (Kyle 2026-10-11). */
const SAY_AS: [RegExp, string][] = [[/\bDenove\b/g, 'Den-oh-vee']]

/** What a voice would trip on: names, the closest-to-the-pin shorthand, the en dash, double spaces. */
function forSpeech(s: string): string {
  for (const [re, said] of SAY_AS) s = s.replace(re, said)
  return s
    .replace(/\bthe CTP\b/g, 'closest to the pin')
    .replace(/\bCTPs?\b/g, 'closest to the pin')
    .replace(/–/g, ' to ')
    .replace(/\.\./g, '.')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "the Red", "the Black", "the Blue", but just "Bone Valley". */
function courseRef(name: string): string {
  const short = courseShortName(name)
  return /^(Red|Black|Blue)$/.test(short) ? `the ${short}` : short
}

function cap(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
