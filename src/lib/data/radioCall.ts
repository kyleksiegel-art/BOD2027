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
  /** The lines to read, one utterance each. Call again for a different take. */
  script: (rand?: () => number) => string[]
}

type Hr = PlayerRoundVM['holeResults'][number]

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
  return {
    roundNumber: focus.roundNumber,
    phase,
    script: (rand = Math.random) => {
      const pick = <T,>(xs: T[]): T => xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))]
      const lines = phase === 'preview' ? previewCall(ctx, pick) : phase === 'final' ? finalCall(ctx, pick) : liveCall(ctx, phase, pick)
      return lines.filter((l): l is string => !!l).map(forSpeech)
    },
  }
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
type Pick = <T>(xs: T[]) => T

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
    ],
    front: [
      `Back with you on ${c.course}, through ${c.complete}.`,
      `Here's your update from the front nine of ${c.course}. The group is through ${c.complete}.`,
      `Checking in from ${c.course}, through the ${ordinalOf(c.complete)}, and folks, there's a golf tournament breaking out.`,
    ],
    turn: [
      `That's the turn on ${c.course}. Grab a hot dog, because here's how the front nine went.`,
      `Nine down, nine to go on ${c.course}. Let's go to the tape on the front side.`,
      `The front nine at ${c.course} is in the books, and some of it should probably stay there.`,
    ],
    back: [
      `Into the back nine on ${c.course}, through ${c.complete}.`,
      `The back nine is where rounds go to live or die, and we're through ${c.complete} on ${c.course}.`,
      `Here's the latest from ${c.course}. ${cap(words(left))} holes to play, and the tension is real.`,
    ],
    closing: [
      `Down the stretch they come on ${c.course}. ${cap(words(left))} to play.`,
      `This is the part of the round the group chat will remember. ${cap(words(left))} to play on ${c.course}.`,
      `${cap(words(left))} holes left on ${c.course}. Hands are shaking. Grips are tightening.`,
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
  if (lines.length > 0) lines[0] = `${pick(['Last time through.', "Here's what you missed.", 'The recent action.'])} ${lines[0]}`
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
      ]),
    )
  } else {
    lines.push(`${span}, ${listOf(hot.map((r) => r.p.first))} have shared the honors with ${hot[0].s} points each.`)
  }
  if (cold.s < rows[0].s && !hot.includes(cold)) {
    const z = cold.z >= 3 ? `, including ${words(cold.z)} zeros` : ''
    const quip = cold.z >= 3 ? pick([` Somebody get ${cold.p.first} a drink.`, ` ${cold.p.first} would like to speak to a manager.`, ' It has not been pretty.']) : ''
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
        ? `That includes ${words(birdieMan.b)} real birdies. Actual birdies. On the card.`
        : `${birdieMan.p.first} has ${words(birdieMan.b)} real birdies in that stretch. Actual birdies. On the card.`,
    )
  }
  if (phase === 'turn') {
    const b = board(c, 9)
    lines.push(`At the turn, it's ${b.rows.map((r) => `${r.p.first} ${r.s}`).join(', ')}.`)
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
          `That's ${words(zr)} zeros in a row for ${p.first}. The cart has gone very quiet.`,
          `${p.first} has blanked ${words(zr)} straight. Someone hide the sharp objects.`,
        ]),
      })
    }
    // No zero at all, deep into the round.
    const zeros = zerosIn(p, 1, h)
    if (zeros === 0 && h >= 8) {
      notes.push({ who: p.id, rank: 7, text: `${p.first} has not taken a single zero all day. Not one. Through ${h}.` })
    } else {
      let run = 0
      while (run < h && (p.holes.get(h - run)?.points ?? 0) > 0) run++
      if (run >= 6 && run < h) notes.push({ who: p.id, rank: 5, text: `${p.first} hasn't taken a zero since the ${ordinalOf(h - run)}. ${cap(words(run))} straight holes on the board.` })
    }
    // Hot hand.
    if (h >= 3) {
      const last3 = pts(p, h - 2, h)
      if (last3 >= 9) notes.push({ who: p.id, rank: 8, text: pick([`${p.first} is on fire: ${last3} points over the last three holes.`, `${p.first} has ${last3} points in the last three holes. Somebody check for a heartbeat.`]) })
    }
    // Net par machine.
    if (h >= 4 && [0, 1, 2, 3].every((k) => (p.holes.get(h - k)?.points ?? -1) === 2)) {
      notes.push({ who: p.id, rank: 3, text: `${p.first} has made net par on four straight holes. Boring. Brutally effective.` })
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
            ? `Let's talk about that real ${kind} from ${p.first} on the ${ordinalOf(q)}. Frame that scorecard.`
            : `Never forget: ${p.first} made a real ${kind} on the ${ordinalOf(q)}.`,
        })
        break
      }
    }
    // Pick-ups.
    let ups = 0
    for (let q = 1; q <= h; q++) if (p.holes.get(q)?.pickedUp) ups++
    if (ups >= 2) notes.push({ who: p.id, rank: 4, text: `${p.first} has picked up ${words(ups)} times today. Efficient, if nothing else.` })
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
        ? pick([`And get this: all ${words(c.players.length)} are dead level on ${b.top}. You cannot script this.`, `It's all square. Everybody on ${b.top}. Total chaos.`])
        : pick([`At the top, it's dead level: ${listOf(b.leaders.map((p) => p.first))} on ${b.top}, ${words(left)} to play.`, `${listOf(b.leaders.map((p) => p.first))} are tied at ${b.top}. Nobody blinks.`]),
    )
  } else {
    const L = b.leaders[0].first
    const S = b.chaser!.first
    if (b.gap <= 2) {
      lines.push(
        pick(
          left <= 4
            ? [`${L} leads ${S} by ${b.gap} with ${words(left)} to play. This one's going to the wire.`, `${L} by ${b.gap} over ${S}, ${words(left)} left. Nobody is breathing.`]
            : [`${L} leads ${S} by ${b.gap}, with ${words(left)} to play. Anything can happen.`, `It's ${L} by a nose: ${b.gap} clear of ${S}, ${words(left)} to go.`],
        ),
      )
    } else if (b.gap <= 6) {
      lines.push(pick([`${L} leads by ${b.gap} over ${S}, ${words(left)} to play. Not safe. Not even close to safe.`, `${L} is ${b.gap} clear of ${S} with ${words(left)} left. Comfortable, but this group has blown bigger leads before breakfast.`]))
    } else if (b.gap > 2 * left) {
      lines.push(pick([`${L} leads by ${b.gap} with ${words(left)} to play. Somebody start engraving.`, `${L} is ${b.gap} clear with ${words(left)} left. The rest are playing for pride, and there isn't much of that left either.`]))
    } else {
      lines.push(pick([`${L} is running away with it, ${b.gap} clear of ${S}.`, `${L} leads by ${b.gap}. ${S} is the closest thing to a challenger.`]))
    }
    if (b.leaders.length === 1 && b.spread <= 4 && c.players.length > 2) lines.push(`All ${words(c.players.length)} are within ${b.spread}. Anybody's round.`)
  }
  const purse = purseSettingsOf(c.db)
  if (purse.roundWinnerCents > 0 && left <= 9) {
    lines.push(
      b.leaders.length === 1
        ? pick([`There's ${dollars(purse.roundWinnerCents)} on this round, and ${b.leaders[0].first} has a hand on it.`, `${dollars(purse.roundWinnerCents)} to the winner today. ${b.leaders[0].first} can smell it.`])
        : `There's ${dollars(purse.roundWinnerCents)} on this round, and nobody owns it yet.`,
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

  if (!lead) {
    lines.push(`On the week, ${first(a.name)} and ${first(b.name)} are level on ${a.total}.`)
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
          : pick([`On the week, ${first(a.name)} leads ${first(b.name)} by ${gap}${left}.`, `For the whole trip, it's ${first(a.name)} on top, ${gap} ahead of ${first(b.name)}${left}.`]),
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
  const lines = [`${intro ? `${pick(['Up next', 'Next up', 'Coming up'])},` : 'The group is on'} the ${ordinalOf(hole)}: a ${what}${flavor}.`]

  const getting = c.players.filter((p) => (p.holes.get(hole)?.strokesReceived ?? 0) >= 1)
  const two = getting.filter((p) => (p.holes.get(hole)?.strokesReceived ?? 0) >= 2)
  if (getting.length === 0) lines.push('Nobody gets a shot there. Straight up.')
  else if (getting.length === c.players.length) lines.push('Everybody gets a shot there.')
  else lines.push(`${listOf(getting.map((p) => p.first))} ${getting.length === 1 ? 'gets' : 'get'} a shot there${two.length ? `, and ${listOf(two.map((p) => p.first))} ${two.length === 1 ? 'gets' : 'get'} two` : ''}.`)

  if (info.par === 3) lines.push(pick(["It's a par 3, so there's a closest to the pin up for grabs.", 'Par 3. Closest to the pin is on the line, and so is everyone\'s dignity.']))
  else if (info.par === 5 && !lastHole) lines.push(pick(['A par 5. Birdie chance, or disaster chance.', 'A par 5, where rounds get made and rounds get ruined.']))
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
    early: ['Plenty of golf left. Back to you.', 'Long way to go. Hydrate, gentlemen.'],
    front: ['Keep it in the short grass, boys. Back to you.', "We'll check back in a few holes."],
    turn: ['Hot dogs, then the back nine. Back to you in the clubhouse.', 'Reload at the turn. The back nine waits for no one.'],
    back: ["We'll be right here when it gets ugly. Back to you.", 'Stay tuned. This thing is far from over.'],
    closing: lastRound ? ['Everything on the line. Strap in.', 'Somebody is about to be very rich, relatively speaking. Strap in.'] : ['Strap in. Back to you.', "Bring it home, boys. We'll see you at the 18th."],
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
    ]),
    `${cap(words(rounds.length))} rounds. ${cap(words(rounds.length))} courses. ${cap(words(rounds.length))} days. And ${words(c.players.length)} men who have been talking about this trip for months.`,
  ]
  const field = c.players
    .map((p) => c.db.players.find((x) => x.id === p.id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => p.name)
  if (field.length > 0) out.push(`Let's meet the field. ${field.map((n) => `${n}.`).join(' ')}`)

  const weekday = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
  const stops = rounds.map((r, i) => {
    const course = c.db.courses.find((x) => x.id === r.course_id)
    const name = course ? courseRef(course.name) : `round ${r.round_number}`
    return i === 0 ? `${name} today` : `${name} on ${weekday(r.date)}`
  })
  if (stops.length > 1) out.push(`Here's the road ahead: ${listOf(stops)}.`)

  const purse = purseSettingsOf(c.db)
  const pot = purse.buyInPerPlayerCents * c.players.length
  if (purse.champFirstCents > 0) {
    out.push(
      `${pot > 0 ? `${dollars(pot)} on the line. ` : ''}${dollars(purse.champFirstCents)} for the champion, ${dollars(purse.champSecondCents)} for second${
        purse.roundWinnerCents > 0 ? `, and ${dollars(purse.roundWinnerCents)} to whoever wins each round` : ''
      }. Plus closest to the pin and shits, settled at the nineteenth hole, like gentlemen.`,
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
  else out.push(pick(['Nobody has a point yet. Everybody is still a contender, for about one more hour.', 'Clean slate. Everybody is undefeated. Enjoy it while it lasts.']))
  out.push(...upNext(c, 1, pick).map((l, i) => (i === 0 ? l.replace(/^(Up next|Next up|Coming up), the 1st/, 'First up, the 1st') : l)))
  out.push(pick(['Fairways and greens, gentlemen.', "Hit 'em straight. Back to you.", 'May the putts drop and the excuses be creative.']))
  return out
}

function finalCall(c: Ctx, pick: Pick): string[] {
  if (roundsAfter(c).length === 0) return tripFinale(c, pick)
  const out: string[] = [pick([`Here's how round ${c.roundNumber} went on ${c.course}.`, `The final word from ${c.course}, round ${c.roundNumber}.`])]
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
  out.push(pick(["That's the round.", "That's the round. Somebody's buying.", "That's the round. Hydrate. Stretch. Lie about it later."]))
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
    out.push(pick([`${fullName(champ.playerId)} is your champion!`, `Your champion of the Board of Directors… ${fullName(champ.playerId)}!`]))
    const how = st.tiebreakNote?.match(/leads on (.*)\.$/)?.[1]
    if (margin === 0 && how) out.push(`Level on points with ${short(runnerUp!.playerId)}, and ${short(champ.playerId)} wins it on ${how}. You cannot make this up.`)
    else if (margin === 1) out.push(`One point. ${totalHoles} holes, and it comes down to one point.`)
    else if (margin <= 3) out.push(`${cap(words(margin))} points. A photo finish over ${totalHoles} holes.`)
    else if (margin >= 10) out.push(`${margin} points clear. That wasn't a tournament, that was a statement.`)
    else out.push(pick([`${short(champ.playerId)} wins it by ${margin}, and it was never really in doubt.`, `${short(champ.playerId)} wins it by ${margin}. Earned, every point of it.`]))
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
  out.push(pick(["Same time next year? That's the week. Somebody's buying.", "Same time next year? That's the week, and that's the trip."]))
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
