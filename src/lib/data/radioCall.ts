import { buildRoundDetail, buildStandings, resolveRoundWinnerIds } from './compute'
import type { Db, PlayerRoundVM } from './compute'
import { buildFieldStory, shotOf } from './fieldStory'
import type { StoryEntry, StoryVM } from './fieldStory'
import { purseSettingsOf } from './money'
import { courseShortName, etDateString, formatTeeTime, ordinalOf } from '@/lib/format'

/**
 * The radio call: a broadcaster's update read out loud by the phone's built-in voice (speak.ts).
 * Kyle 2026-10-11: "cover the last few holes, what happened the past nine, what's upcoming … a
 * plethora of scenarios based on what hole we're on … let it have some fun."
 *
 * Analysis first, then prose, like the Field Report it builds on (and reuses: the story's own
 * hole lines are the "recent action"). Which segments play depends on the PHASE of the round:
 *
 *   preview  (no hole saved yet) → welcome, tee time, who gets shots, the week, the 1st hole
 *   early 1–3 · front 4–8 · back 10–14 · closing 15–17
 *            → open, the last couple of holes, a stretch review once there's one to review,
 *              color notes, what's at stake today and for the week, the next hole, close
 *   turn (9) → open, the front nine reviewed, notes, stakes, the 10th, close
 *   final    → the whole story (as the Field Report tells it), the week, what's next
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
      `It's crunch time on ${c.course}. ${cap(words(left))} to play. Somebody hold my beer. [laughs]`,
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

/** The last couple of holes, as the Field Report told them, oldest first. */
function recentAction(c: Ctx, pick: Pick): string[] {
  if (!c.story) return []
  const picked: StoryEntry[] = []
  let holesSeen = 0
  for (const e of c.story.entries) {
    if (e.kind === 'turn') continue
    picked.push(e)
    if (e.kind !== 'partial') holesSeen++
    if (holesSeen >= 2) break
  }
  const lines = picked.reverse().map((e) => storyLine(e))
  if (lines.length > 0) lines[0] = `${pick(['Last time through.', "Here's what you missed.", 'The recent action.', 'Let\'s go to the tape.', 'Quick recap.', 'Catching you up.', 'In case you were in the porta-potty.', 'The last little while, in brief.', 'Rewind.', 'The latest.', 'Previously, on the Board of Directors.', 'What just happened.', "Here's the action.", "If you blinked, here's what you missed.", 'From the last couple of holes.', 'For those just tuning in.'])} ${lines[0]}`
  return lines
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
            ' [sighs] It has not been pretty.',
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
            `That includes ${words(birdieMan.b)} real birdies. Actual birdies. On the card.`,
            `${cap(words(birdieMan.b))} of those were real birdies. No strokes needed.`,
            `And ${words(birdieMan.b)} real birdies in there. The handicap committee has been notified.`,
            `${cap(words(birdieMan.b))} real birdies in there, too. Sandbaggers, take note.`,
            `That includes ${words(birdieMan.b)} real birdies, which, for this group, is basically witchcraft.`,
            `That includes ${words(birdieMan.b)} real birdies.`,
            `Including ${words(birdieMan.b)} real birdies. No help from the handicap.`,
            `${cap(words(birdieMan.b))} real birdies in that haul. Gross, not net.`,
            `And ${words(birdieMan.b)} of them real birdies. Somebody frame the card.`,
            `With ${words(birdieMan.b)} real birdies mixed in. Witnesses available on request.`,
            `${cap(words(birdieMan.b))} real birdies in there. That's not sandbagging, that's just golf.`,
            `Including ${words(birdieMan.b)} real birdies.`,
          ])
        : pick([
            `${birdieMan.p.first} has ${words(birdieMan.b)} real birdies in that stretch. Actual birdies. On the card.`,
            `${birdieMan.p.first} has made ${words(birdieMan.b)} real birdies in that stretch. Somebody check the handicap.`,
            `${cap(words(birdieMan.b))} real birdies for ${birdieMan.p.first} in that stretch. Gross birdies. With witnesses.`,
            `${birdieMan.p.first} has ${words(birdieMan.b)} real birdies in that stretch. Somebody revisit that index.`,
            `${birdieMan.p.first} has chipped in ${words(birdieMan.b)} real birdies over that stretch. Gross birdies, too.`,
            `${cap(words(birdieMan.b))} real birdies for ${birdieMan.p.first} in that stretch. No strokes required.`,
            `${birdieMan.p.first} has ${words(birdieMan.b)} real birdies over that stretch. The index is looking nervous.`,
            `${birdieMan.p.first} made ${words(birdieMan.b)} real birdies in that stretch.`,
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
          `${p.first} has blanked ${words(zr)} straight. [sighs] Someone hide the sharp objects.`,
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
            `${last3} points in three holes for ${p.first}. [whispers] Nobody say anything. Nobody touch anything.`,
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
          `Four straight net pars for ${p.first}. Like watching paint dry, [laughs] and the paint is winning.`,
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
    // Real eagles today.
    for (let q = 1; q <= h; q++) {
      const kind = shotOf(p.holes.get(q))
      if (kind === 'eagle' || kind === 'albatross') {
        // Fresh, it's the headline; hours later, a footnote.
        const fresh = q >= h - 2
        notes.push({
          who: p.id,
          rank: fresh ? 9 : 2,
          text: fresh
            ? pick([
                `Let's talk about that real ${kind} from ${p.first} on the ${ordinalOf(q)}. Frame that scorecard.`,
                `We have to go back to the ${ordinalOf(q)}: a real ${kind} from ${p.first}. Not net. Real.`,
                `A real ${kind} for ${p.first} on the ${ordinalOf(q)}. Somebody get a photo of that card.`,
                `Stop everything. [excited] ${p.first} made a real ${kind} on the ${ordinalOf(q)}.`,
                `A real ${kind} for ${p.first} on the ${ordinalOf(q)}. The drinks are on ${p.first}. That's the rule now.`,
                `The shot of the day so far: a real ${kind} from ${p.first} on the ${ordinalOf(q)}.`,
                `Hold the phone. [excited] A real ${kind} for ${p.first} on the ${ordinalOf(q)}.`,
                `${p.first} just made a real ${kind} on the ${ordinalOf(q)}. No strokes. No asterisk.`,
                `The ${ordinalOf(q)} belongs to ${p.first}: a real ${kind}. Somebody alert the local paper.`,
                `A real ${kind}, ${p.first}, the ${ordinalOf(q)}. Say it again. A real ${kind}.`,
                `Big news from the ${ordinalOf(q)}: ${p.first} with a real ${kind}. That's going in the trip history.`,
                `${p.first} made a real ${kind} on the ${ordinalOf(q)}.`,
              ])
            : pick([
                `Never forget: ${p.first} made a real ${kind} on the ${ordinalOf(q)}.`,
                `And for the record, ${p.first} still has that real ${kind} from the ${ordinalOf(q)}.`,
                `A reminder, in case ${p.first} hasn't mentioned it in the last five minutes: a real ${kind} on the ${ordinalOf(q)}.`,
                `Still talking about ${p.first}'s real ${kind} on the ${ordinalOf(q)}. We'll be talking about it all week.`,
                `Lest anyone forget, ${p.first} made a real ${kind} on the ${ordinalOf(q)}.`,
                `${p.first}'s real ${kind} on the ${ordinalOf(q)} is still the shot everyone is talking about.`,
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
          `${L} by ${b.gap} with ${words(left)} to go. This one is over, [laughs] unless it isn't.`,
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
  if (phase === 'turn') out.push(...stretchReview(c, phase, pick))
  else {
    out.push(...recentAction(c, pick))
    out.push(...stretchReview(c, phase, pick))
  }
  out.push(...colorNotes(c, pick, phase === 'early' ? 1 : 2))
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
 * The very first tee of the trip: ONE fixed script (Kyle 2026-11-08, picked off two drafts: the
 * big-event telecast), with the field, shots, tee time, the 1st hole, the courses and the money
 * filled in from the data. It is the whole Round 1 preview, before anything is final.
 *
 * Lore, matched by surname (Kyle): Jon Aronson and Chris Denove are the returning co-champions,
 * Adam Hersh the inaugural champion, Kyle Siegel built the app and has never finished better than
 * third. WOLF_ORDER is Round 1's side game tee order, oldest to youngest (Kyle).
 */
const WOLF_ORDER = ['Aronson', 'Denove', 'Hersh', 'Siegel']

function tournamentOpener(c: Ctx): string[] | null {
  const rounds = c.db.rounds.filter((r) => r.status !== 'abandoned').sort((a, b) => a.round_number - b.round_number)
  if (rounds[0]?.round_number !== c.roundNumber || rounds.some((r) => r.status === 'final')) return null
  const roster = c.players.map((p) => ({ p, name: c.db.players.find((x) => x.id === p.id)?.name ?? p.first }))
  const bySurname = (s: string) => roster.find((r) => surname(r.name) === s)
  const totalHoles = rounds.reduce((n, r) => n + (r.holes_counted ?? 18), 0)

  const out: string[] = [
    '[excited] From the dunes of central Florida, this is Streamsong, and this, ladies and gentlemen, is the Board of Directors, twenty twenty-seven!',
    `[calmly] ${cap(words(rounds.length))} days. ${cap(words(rounds.length))} courses. ${totalHoles} holes, walked every step of the way. One champion.${
      roster.length > 1 ? ` And ${words(roster.length - 1)} very long flights home.` : ''
    }`,
  ]

  // The field, in the order the jokes build: the co-champions, the inaugural champion, Kyle last.
  type R = (typeof roster)[number]
  const intros: Record<string, (r: R) => string> = {
    Aronson: (r) => `${r.name}. Returning co-champion, elder statesman, and the man who will remind you of both before the first tee.`,
    Denove: (r) =>
      `${r.name}. The other half of that co-championship. ${
        r.p.strokes > 0 ? `${cap(plural(r.p.strokes, 'shot'))} today, and a fresh set of excuses already loaded.` : 'A fresh set of excuses already loaded.'
      } [laughs]`,
    Hersh: (r) => `${r.name}. Inaugural champion. Won the very first one outright and has never once let anyone forget it.`,
    Siegel: (r) =>
      `${r.name}. Built the app, wrote the rules, keeps the scores, and has never finished better than third. [sarcastic] No conflict of interest whatsoever.`,
  }
  const known = WOLF_ORDER.map(bySurname).filter((r): r is R => !!r)
  const field = [...known, ...roster.filter((r) => !known.includes(r))]
  if (field.length > 0) {
    out.push("Let's run down the field.")
    field.forEach((r, i) => {
      const line = intros[surname(r.name)]?.(r) ?? `${r.name}.`
      out.push(i === field.length - 1 && field.length > 1 ? `And ${line}` : line)
    })
  }

  out.push(
    'The format is net Stableford. Points on every hole, two for a net par, more for better, and a blow-up costs you a zero, not the trip. Points add up across all four rounds.',
  )

  const weekday = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
  const DAY = 86_400_000
  const stops = rounds.map((r, i) => {
    const course = c.db.courses.find((x) => x.id === r.course_id)
    const name = course ? courseRef(course.name) : `round ${r.round_number}`
    if (i === 0) return `${cap(name)} today.`
    if (i === rounds.length - 1)
      return course && courseShortName(course.name) === 'Bone Valley'
        ? `And ${weekday(r.date)}, the brand-new Bone Valley, where the course is fresh and so are the scorecards.`
        : `And ${weekday(r.date)}, ${name}.`
    if (i === 1 && Date.parse(r.date) - Date.parse(rounds[0].date) === DAY) return `${cap(name)} tomorrow.`
    return `${cap(name)} on ${weekday(r.date)}.`
  })
  if (stops.length > 1) out.push(stops.join(' '))

  const purse = purseSettingsOf(c.db)
  const pot = purse.buyInPerPlayerCents * c.players.length
  if (purse.champFirstCents > 0) {
    out.push(
      `${pot > 0 ? `${dollars(pot)} in the pot. ` : ''}${dollars(purse.champFirstCents)} to the champion, ${dollars(purse.champSecondCents)} to the runner-up${
        purse.roundWinnerCents > 0 ? `, and ${dollars(purse.roundWinnerCents)} to the winner of every round` : ''
      }. Closest to the pin and shits are settled the old-fashioned way: [whispers] cash, at the bar, nobody asks.`,
    )
  }

  // Wolf, by age: only when the whole field is in the known order.
  if (known.length === roster.length && known.length >= 2) {
    const [lead, ...after] = known.map((r) => r.p.first)
    const youngest = after.pop()!
    out.push(
      `Today's side game is Wolf, by age. ${lead} tees off first, ${after.map((n) => `then ${n}, `).join('')}and ${youngest}, the youngest, goes last and gets to watch everyone else make the mistakes first.`,
    )
  }

  const tee = c.detail.round.tee_time
  if (tee && c.detail.round.status === 'upcoming') out.push(`Tee time, ${formatTeeTime(tee)!.replace(/ ET$/, '')}.`)

  const byStrokes = c.players.slice().sort((a, b) => b.strokes - a.strokes)
  const getting = byStrokes.filter((p) => p.strokes > 0)
  const scratch = byStrokes.filter((p) => p.strokes === 0)
  if (getting.length > 0) {
    const parts = getting.map((p, i) => `${p.first} ${i === 0 ? `gets ${plural(p.strokes, 'shot')}` : words(p.strokes)}`)
    if (scratch.length > 0) parts.push(`${listOf(scratch.map((p) => p.first))} ${scratch.length === 1 ? 'plays' : 'play'} it straight`)
    out.push(`${parts.join(', ')}.`)
  }

  out.push('Nobody has a point. Nobody has a zero. Nobody has an excuse. [pause] Yet.')

  const first = c.holes.find((h) => h.holeNumber === 1)
  if (first) {
    const y = teeYardage(c, 1)
    const shot = c.players.filter((p) => (p.holes.get(1)?.strokesReceived ?? 0) >= 1)
    const who =
      shot.length === 0 ? 'no shots given' : shot.length === c.players.length ? 'a shot for everybody' : `a shot for ${listOf(shot.map((p) => p.first))}`
    out.push(`The 1st hole: a ${y ? `${y}-yard ` : ''}par ${first.par}, and ${who}.`)
  }

  out.push("[excited] The Board is in session. Gentlemen, let's play!")
  return out
}

function previewCall(c: Ctx, pick: Pick): string[] {
  const after = roundsAfter(c).length
  const tee = c.detail.round.tee_time
  const hour = tee ? Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(new Date(tee))) : 12
  const daypart = hour < 12 ? 'morning' : 'afternoon'
  // The trip's first tee is its own fixed script, the whole preview.
  const opener = tournamentOpener(c)
  if (opener) return opener
  const out: string[] = [
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

function finalCall(c: Ctx, pick: Pick): string[] {
  if (roundsAfter(c).length === 0) return tripFinale(c, pick)
  const out: string[] = [pick([
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
  const entries = c.story ? c.story.entries.slice().reverse() : []
  entries.forEach((e, i) => {
    // The whole round, minus the filler: a hole where nothing moved isn't worth the airtime.
    const text = e.segs.map((x) => x.text).join('')
    if (i < entries.length - 1 && /^(Pars all round|No change at the top)/.test(text) && !/closest|CTP/.test(text)) return
    const line = storyLine(e)
    if (!line) return
    out.push(i === entries.length - 1 && e.scoreline ? `${line} Final tally: ${e.scoreline}.` : line)
  })
  out.push(...weekStakes(c, pick, true))
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

  // How the last round finished: its final hole, as the Field Report told it.
  const last = c.story?.entries.find((e) => e.kind === 'hole')
  if (last) out.push(storyLine(last))

  // The champion.
  if (champs.length > 1) {
    out.push(`We have co-champions! ${listOf(champs.map((r) => fullName(r.playerId)))} share the title, level after every tiebreaker.`)
  } else {
    const champ = champs[0]
    out.push(pick([`${fullName(champ.playerId)} is your champion!`, `Your champion of the Board of Directors… ${fullName(champ.playerId)}!`, `Ladies and gentlemen, your champion: [excited] ${fullName(champ.playerId)}!`, `Pop the champagne, or at least the light beer. ${fullName(champ.playerId)} is your champion!`, `And the champion of the Board of Directors, twenty twenty-seven: ${fullName(champ.playerId)}!`, `${fullName(champ.playerId)}, champion!`, `Raise a glass. ${fullName(champ.playerId)} is your champion!`, `The new champion of the Board of Directors: ${fullName(champ.playerId)}!`]))
    const how = st.tiebreakNote?.match(/leads on (.*)\.$/)?.[1]
    if (margin === 0 && how) out.push(`Level on points with ${short(runnerUp!.playerId)}, and ${short(champ.playerId)} wins it on ${how}. You cannot make this up.`)
    else if (margin === 1) out.push(`One point. ${totalHoles} holes, and it comes down to one point.`)
    else if (margin <= 3) out.push(`${cap(words(margin))} points. A photo finish over ${totalHoles} holes.`)
    else if (margin >= 10) out.push(`${margin} points clear. That wasn't a tournament, that was a statement.`)
    else out.push(pick([`${short(champ.playerId)} wins it by ${margin}, and it was never really in doubt.`, `${short(champ.playerId)} wins it by ${margin}. Earned, every point of it.`, `${short(champ.playerId)} wins by ${margin}. Bragging rights secured for a full calendar year.`, `${short(champ.playerId)} wins by ${margin}. Clean, clear, and well earned.`, `${short(champ.playerId)} by ${margin}. A deserving champion.`, `${short(champ.playerId)} takes it by ${margin}. Somebody get the trophy polished.`]))
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
