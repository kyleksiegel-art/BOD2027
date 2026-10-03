import {
  buildChampionships,
  buildRoundDetail,
  buildRoundRecap,
  buildOverallTiebreak,
  resolveRoundWinnerIds,
} from './compute'
import type { Db, RoundDetailVM, PlayerRoundVM } from './compute'
import { standingsThroughRound } from '@/lib/scoring'
import { courseShortName, formatDay, formatDayLong, ordinalOf } from '@/lib/format'

/**
 * The round report: the round's story as a short narrative, once every score is in. Pure and
 * offline-identical, like every other builder: rows in, a view model out.
 *
 * Two layers, kept apart so every sentence traces to a number (Kyle 2026-10-02, "more of a
 * narrative", option A):
 *   1. ANALYSIS: per-hole points, the winner and the player to beat, the decisive stretch, the
 *      biggest deficit, when the lead was taken for good, the peak lead, each nine, real (gross)
 *      eagles/birdies vs net ones, closest-to-pins.
 *   2. PROSE: picks the story the analysis supports (runaway / comeback / late / close / steady
 *      / shared) and writes four short paragraphs from it: how it was decided, what happened
 *      after, everyone else (one specific line each), and the week.
 *
 * Plain language (CLAUDE.md conventions): no business jargon, no em dashes, first names only,
 * and never a pronoun, so a template never has to guess one. "Real eagle" means the gross score;
 * anything earned with a stroke says "net".
 */

/** One run of report text; `strong` marks a derived fact the eye should land on. */
export interface ReportSeg {
  text: string
  strong?: boolean
}

export type StoryKind = 'runaway' | 'comeback' | 'late' | 'close' | 'steady' | 'shared'

/** Where the winner did the damage: a 3–6 hole window, winner's points vs the rival's over it. */
export interface Stretch {
  from: number
  to: number
  aPts: number // the winner's points over the stretch
  bPts: number // the rival's points over the same holes
  gapBefore: number // winner minus rival after hole `from - 1` (negative = behind)
  gapAfter: number // winner minus rival after hole `to`
}

export interface ReportVM {
  roundNumber: number
  courseName: string
  dateLabel: string // "Friday, February 5"
  dayLabel: string // "Day 2 of 4"
  headline: string // "Chris runs away with the Red."
  paragraphs: ReportSeg[][]
  dateline: string // "Streamsong Black · Fri, Feb 5"
  latest: boolean // the most recent counting round — the report opens by default only then
  /** Scores are all in but the round isn't finalized: only the footer says so; the copy reads as a result. */
  pending: boolean
  kind: StoryKind
  stretch: Stretch | null
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}
function theShortOf(name: string): string {
  const short = courseShortName(name)
  return /^(Red|Blue|Black)$/i.test(short) ? `the ${short}` : short
}
function words(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}
function cap(str: string): string {
  return str ? str[0].toUpperCase() + str.slice(1) : str
}
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
/** "a, b and c" */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const t = (text: string): ReportSeg => ({ text })
const s = (text: string): ReportSeg => ({ text, strong: true })

// ── Analysis ────────────────────────────────────────────────────────────────

interface Line {
  id: string
  first: string
  total: number
  pts: number[] // points per hole, index = hole - 1, counted window only (0 where not completed)
  holes: PlayerRoundVM['holeResults']
}

const cumAt = (l: Line, h: number) => l.pts.slice(0, h).reduce((a, b) => a + b, 0)
const sumRange = (l: Line, from: number, to: number) => l.pts.slice(from - 1, to).reduce((a, b) => a + b, 0)

/**
 * The decisive stretch between `a` (the winner) and `b` (the player to beat). Among every 3–6
 * hole window, find the biggest swing; then take the SHORTEST window that delivers at least
 * three quarters of it (ties: bigger swing, then earlier). A short window people can picture
 * beats a long one that only adds a point; requiring most of the max swing stops it
 * cherry-picking a blip; among equals, the one ending on the bigger lead, then one that starts on a gain. Null when no window swings 4+ points: no stretch, only a grind.
 * `after` restricts windows to start after that hole (a comeback is told from its low point).
 */
export function decisiveStretch(a: number[], b: number[], n: number, after = 0): Stretch | null {
  const cands: { from: number; to: number; aPts: number; bPts: number; swing: number }[] = []
  for (let len = 3; len <= 6; len++) {
    for (let from = after + 1; from + len - 1 <= n; from++) {
      const to = from + len - 1
      let aPts = 0
      let bPts = 0
      for (let h = from; h <= to; h++) {
        aPts += a[h - 1] ?? 0
        bPts += b[h - 1] ?? 0
      }
      cands.push({ from, to, aPts, bPts, swing: aPts - bPts })
    }
  }
  if (cands.length === 0) return null
  const max = Math.max(...cands.map((c) => c.swing))
  if (max < 4) return null
  const need = Math.ceil(max * 0.75)
  const cum = (arr: number[], h: number) => arr.slice(0, h).reduce((p, q) => p + q, 0)
  const gapAt = (h: number) => cum(a, h) - cum(b, h)
  const gains = (h: number) => (a[h - 1] ?? 0) > (b[h - 1] ?? 0) // a stretch reads best starting on a gain
  const pick = cands
    .filter((c) => c.swing >= need)
    .sort(
      (x, y) =>
        x.to - x.from - (y.to - y.from) ||
        y.swing - x.swing ||
        gapAt(y.to) - gapAt(x.to) ||
        Number(gains(y.from)) - Number(gains(x.from)) ||
        x.from - y.from,
    )[0]
  return {
    from: pick.from,
    to: pick.to,
    aPts: pick.aPts,
    bPts: pick.bPts,
    gapBefore: cum(a, pick.from - 1) - cum(b, pick.from - 1),
    gapAfter: cum(a, pick.to) - cum(b, pick.to),
  }
}

const SHOTS: Record<string, { one: string; many: string }> = {
  albatross: { one: 'a real albatross', many: 'real albatrosses' },
  eagle: { one: 'a real eagle', many: 'real eagles' },
  netEagle: { one: 'a net eagle', many: 'net eagles' },
  birdie: { one: 'a birdie', many: 'birdies' },
  netBirdie: { one: 'a net birdie', many: 'net birdies' },
}

/** A notable hole's kind. Gross first ("a real eagle"); "net" only when a stroke earned it. */
function shotKind(hr: PlayerRoundVM['holeResults'][number]): { kind: string; rank: number } | null {
  if (!hr.completed || hr.pickedUp || hr.grossStrokes === null) return null
  const gross = hr.grossStrokes - hr.par
  const pts = hr.points ?? 0
  if (gross <= -3) return { kind: 'albatross', rank: 6 }
  if (gross === -2) return { kind: 'eagle', rank: 5 }
  if (pts >= 4) return { kind: 'netEagle', rank: 4 }
  if (gross === -1) return { kind: 'birdie', rank: 3 }
  if (pts === 3) return { kind: 'netBirdie', rank: 2 }
  return null
}

/**
 * Up to three of a player's best holes inside a stretch, in hole order, with like shots grouped:
 * "birdies on the 16th and 17th and a real eagle on the par-5 18th".
 */
function stretchShots(l: Line, from: number, to: number): string[] {
  const picked = l.holes
    .filter((h) => h.holeNumber >= from && h.holeNumber <= to)
    .map((h) => ({ h, k: shotKind(h) }))
    .filter((x): x is { h: PlayerRoundVM['holeResults'][number]; k: { kind: string; rank: number } } => x.k !== null)
    .sort((x, y) => y.k.rank - x.k.rank || x.h.holeNumber - y.h.holeNumber)
    .slice(0, 3)
    .sort((x, y) => x.h.holeNumber - y.h.holeNumber)
  const groups: { kind: string; holes: PlayerRoundVM['holeResults'] }[] = []
  for (const x of picked) {
    const g = groups.find((q) => q.kind === x.k.kind)
    if (g) g.holes.push(x.h)
    else groups.push({ kind: x.k.kind, holes: [x.h] })
  }
  return groups.map((g) => {
    const names = SHOTS[g.kind]
    if (g.holes.length > 1) return `${names.many} on the ${listOf(g.holes.map((h) => ordinalOf(h.holeNumber)))}`
    const h = g.holes[0]
    const where = g.kind === 'eagle' || g.kind === 'albatross' ? `the par-${h.par} ${ordinalOf(h.holeNumber)}` : `the ${ordinalOf(h.holeNumber)}`
    return `${names.one} on ${where}`
  })
}

/** " with a birdie": the shot that did it, when it was one worth naming. */
function withShot(l: Line, hole: number): string {
  const hr = l.holes.find((h) => h.holeNumber === hole)
  const k = hr ? shotKind(hr) : null
  return k ? ` with ${SHOTS[k.kind].one}` : ''
}

/** "once", "twice", "three times" */
function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${words(n)} times`
}

/** "the lead went from 2 to 10": what a stretch did to the gap, from the winner's side. */
function gapChange(before: number, after: number, winner: string): string {
  if (before > 0 && after > 0) return `the lead went from ${before} to ${after}`
  if (before === 0 && after > 0) return `level became a ${after}-point lead`
  if (before < 0 && after > 0) return `a ${-before}-point deficit became a ${after}-point lead`
  if (before < 0 && after === 0) return `${winner} drew level`
  if (before < 0 && after < 0) return `the gap closed from ${-before} to ${-after}`
  return `the gap went from ${before} to ${after}`
}

/** "2027-02-05" for "2027-02-04": date-only arithmetic, no timezone involved. */
function dayAfter(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ── The builder ─────────────────────────────────────────────────────────────

export function buildRoundReport(roundNumber: number, dbData: Db): ReportVM | null {
  const recap = buildRoundRecap(roundNumber, dbData)
  if (!recap || recap.act !== 'final') return null
  const detail = buildRoundDetail(roundNumber, dbData)
  if (!detail || !detail.holes) return null

  const n = detail.holesCounted
  const lines: Line[] = detail.leaderboard.map((p) => {
    const pts = Array.from({ length: n }, (_, i) => {
      const hr = p.holeResults.find((h) => h.holeNumber === i + 1)
      return hr?.completed ? hr.points ?? 0 : 0
    })
    return { id: p.playerId, first: firstName(p.name), total: p.totalPoints, pts, holes: p.holeResults }
  })
  if (lines.length === 0) return null
  const byId = new Map(lines.map((l) => [l.id, l]))
  const theShort = theShortOf(detail.course.name)

  // Winner(s) off the same resolver the recap and Money use, so the three always agree.
  const resolved = resolveRoundWinnerIds(detail)
  const winnerIds = resolved.ids.length ? resolved.ids : [lines[0].id]
  const winners = winnerIds.map((id) => byId.get(id)).filter((l): l is Line => !!l)
  const W = winners[0]
  const shared = winners.length > 1
  const R = lines.find((l) => !winnerIds.includes(l.id)) ?? null // the best of the rest
  const margin = R ? W.total - R.total : 0

  // Leader after each hole, the biggest deficit the winner faced, and when the lead was won for good.
  const leaderAt = (h: number): Line[] => {
    const top = Math.max(...lines.map((l) => cumAt(l, h)))
    return lines.filter((l) => cumAt(l, h) === top)
  }
  let deficit = 0
  let deficitHole = 0
  let chased: Line | null = null
  for (let h = 1; h < n; h++) {
    const lead = leaderAt(h)
    const d = cumAt(lead[0], h) - cumAt(W, h)
    // Latest hole on a tie: the comeback is told from the last time it looked lost.
    if (d > 0 && d >= deficit) {
      deficit = d
      deficitHole = h
      chased = lead.find((l) => l.id !== W.id) ?? null
    }
  }
  let forGood: number | null = null
  for (let h = n; h >= 1; h--) {
    const lead = leaderAt(h)
    if (lead.length === 1 && lead[0].id === W.id) forGood = h
    else break
  }

  // ── Which story? ──
  let kind: StoryKind
  if (shared) kind = 'shared'
  else if (deficit >= 3 && deficitHole >= 6 && chased) kind = forGood !== null && forGood >= n - 2 ? 'late' : 'comeback'
  else if (margin >= 6) kind = 'runaway'
  else if (margin <= 2) kind = 'close'
  else kind = 'steady'
  const fromBehind = kind === 'comeback' || kind === 'late'

  const rival = fromBehind && chased ? chased : R
  const stretch = rival && !shared ? decisiveStretch(W.pts, rival.pts, n, fromBehind ? deficitHole : 0) : null

  // ── Paragraph 1: how it was decided ──
  const p1: ReportSeg[] = []
  if (shared) {
    p1.push(s(listOf(winners.map((w) => w.first))), t(` finished level on `), s(`${W.total} points`))
    p1.push(t(`, and the countback could not split them.`))
    if (recap.leadChangeCount > 0) p1.push(t(` The lead changed hands ${times(recap.leadChangeCount)} along the way.`))
  } else if (rival) {
    if (fromBehind) {
      p1.push(s(rival.first), t(` led `), s(W.first), t(` by `), s(String(deficit)), t(` after the ${ordinalOf(deficitHole)}.`))
    } else if (stretch && stretch.from > 1) {
      const g = stretch.gapBefore
      const after = ordinalOf(stretch.from - 1)
      if (g >= 4) {
        p1.push(s(W.first), t(` was already ${g} up on `), s(rival.first), t(` after the ${after}.`))
      } else {
        p1.push(t(`It was close for ${stretch.from - 1 === 1 ? 'one hole' : `${words(stretch.from - 1)} holes`}. `))
        if (g > 0) p1.push(s(W.first), t(` led `), s(rival.first), t(` by ${g} after the ${after}.`))
        else if (g === 0) p1.push(s(W.first), t(` and `), s(rival.first), t(` were level after the ${after}.`))
        else p1.push(s(rival.first), t(` led `), s(W.first), t(` by ${-g} after the ${after}.`))
      }
    }
    if (stretch) {
      const shots = stretchShots(W, stretch.from, stretch.to)
      if (shots.length) {
        if (fromBehind) p1.push(t(` ${W.first} answered with ${listOf(shots)}.`))
        else if (p1.length) p1.push(t(` Then the round broke open: ${listOf(shots)}.`))
        else p1.push(s(W.first), t(` came out fast: ${listOf(shots)}.`))
      }
      p1.push(
        t(`${p1.length ? ' ' : ''}From the `),
        s(`${ordinalOf(stretch.from)} through the ${ordinalOf(stretch.to)}`),
        t(`, ${W.first} made `),
        s(`${stretch.aPts} points`),
        t(` to ${rival.first}'s ${stretch.bPts}, and ${gapChange(stretch.gapBefore, stretch.gapAfter, W.first)}.`),
      )
    } else if (recap.onCountback && R) {
      p1.push(t(p1.length ? ' ' : ''), s(W.first), t(` and `), s(R.first), t(` finished level on `), s(`${W.total} points`), t(`, and ${W.first} took it on countback.`))
    } else if (forGood !== null) {
      p1.push(
        t(p1.length ? ' ' : ''),
        s(W.first),
        t(forGood === 1 ? ` led from the 1st and was never caught` : ` took the lead for good on the ${ordinalOf(forGood)}${withShot(W, forGood)}`),
        t(`, finishing ${margin} clear of ${R?.first ?? rival.first}.`),
      )
    } else {
      p1.push(t(p1.length ? ' ' : ''), s(W.first), t(` won ${theShort} by ${margin}.`))
    }
    if (kind === 'late' && forGood !== null && !(stretch && stretch.to >= forGood)) {
      p1.push(t(forGood === n ? ` ${W.first} went in front on the last hole.` : ` ${W.first} only went in front for good on the ${ordinalOf(forGood)}.`))
    }
    if (recap.onCountback && R && stretch) p1.push(t(` ${W.first} and ${R.first} finished level on ${W.total}, and ${W.first} took it on countback.`))
  }

  // ── Paragraph 2: what happened after ──
  const p2: ReportSeg[] = []
  if (!shared && R) {
    const bits: ReportSeg[] = []
    if (n === 18) {
      const backs = lines.map((l) => ({ l, back: sumRange(l, 10, 18) })).sort((a, b) => b.back - a.back)
      const best = backs[0]
      const tied = backs.filter((b) => b.back === best.back).length > 1
      if (!tied && best.l.id !== W.id) bits.push(s(best.l.first), t(` had the best back nine in the group, `), s(`${best.back} points`))
    }
    // A late blank by the winner, and the run it ended.
    const lateZero = W.holes.filter((h) => h.completed && (h.points ?? 0) === 0 && h.holeNumber > n - 3).pop()
    if (lateZero) {
      let run = 0
      for (let h = lateZero.holeNumber - 1; h >= 1 && (W.pts[h - 1] ?? 0) > 0; h--) run++
      bits.push(
        t(bits.length ? `, and ` : ''),
        s(W.first),
        t(` ${bits.length ? 'finally ' : ''}blanked the ${ordinalOf(lateZero.holeNumber)}`),
        t(run >= 8 ? ` after ${run} straight holes with points` : ''),
      )
    }
    if (bits.length) {
      p2.push(...bits, t('.'))
      // Did the late damage matter? Only say so when the lead actually shrank a lot.
      let peak = 0
      for (let h = 1; h <= n; h++) peak = Math.max(peak, cumAt(W, h) - cumAt(R, h))
      if (peak - margin >= 3 && margin >= 3) p2.push(t(` It only brought the final margin down to ${margin}.`))
    } else if (kind === 'close' && margin > 0) {
      // Close finish: how near the chaser got late on.
      let near: { h: number; g: number } | null = null
      for (let h = Math.max(1, n - 4); h < n; h++) {
        const g = cumAt(W, h) - cumAt(R, h)
        if (!near || g < near.g) near = { h, g }
      }
      if (near && near.g <= 1) {
        p2.push(
          s(R.first),
          t(near.g <= 0 ? ` was level with ${words(n - near.h)} to play` : ` was within a point with ${words(n - near.h)} to play`),
          t(`, and ${W.first} held on by ${margin}.`),
        )
      }
    }
  }

  // ── Paragraph 3: everyone else, one specific line each ──
  const textSoFar = () => [p1, p2].flatMap((p) => p.map((x) => x.text)).join(' ')
  const named = (first: string) => new RegExp(`\\b${first}\\b`).test(textSoFar())
  const ctpWins = new Map<string, number[]>()
  const ctpHoles = detail.holes.filter((h) => h.par === 3 && h.holeNumber <= n).map((h) => h.holeNumber)
  for (const c of dbData.ctp_results) {
    if (c.round_id !== detail.round.id || !c.player_id || !ctpHoles.includes(c.hole_number)) continue
    ctpWins.set(c.player_id, [...(ctpWins.get(c.player_id) ?? []), c.hole_number])
  }
  const usedHooks = new Set<string>()
  const pField: ReportSeg[] = []
  for (const l of lines) {
    if (named(l.first)) continue
    const hooks: { kind: string; text: string }[] = []
    const front = sumRange(l, 1, Math.min(9, n))
    const back = n === 18 ? sumRange(l, 10, 18) : null
    const opening = sumRange(l, 1, 3)
    if (back !== null && back - front >= 5) {
      hooks.push(
        opening <= 3
          ? { kind: 'turnaround', text: `opened with ${plural(opening, 'point')} through three holes, then came home in ${back}` }
          : { kind: 'turnaround', text: `turned in ${front} and came home in ${back}` },
      )
    } else if (back !== null && front - back >= 6) {
      hooks.push({ kind: 'fade', text: `went out in ${front} and came home in only ${back}` })
    }
    const eagles = l.holes.filter((h) => h.completed && h.grossStrokes !== null && h.grossStrokes - h.par <= -2)
    if (eagles.length) {
      const last = eagles[eagles.length - 1].holeNumber
      hooks.push({
        kind: 'eagle',
        text:
          eagles.length > 1
            ? `made ${words(eagles.length)} real eagles`
            : last === n
              ? `finished with a real eagle on ${last}`
              : `made a real eagle on the ${ordinalOf(last)}`,
      })
    }
    const ctps = ctpWins.get(l.id) ?? []
    if (ctps.length >= 2) {
      hooks.push({ kind: 'ctp', text: `won ${words(ctps.length)} of the ${words(ctpHoles.length)} closest-to-pins, which pay exactly nothing` })
    }
    const birdies = l.holes.filter((h) => h.completed && h.grossStrokes !== null && h.grossStrokes - h.par === -1).length
    if (birdies >= 2) hooks.push({ kind: 'birdies', text: `made ${words(birdies)} real birdies` })
    const blanks = l.pts.filter((p) => p === 0).length
    if (blanks >= 4) hooks.push({ kind: 'blanks', text: `blanked ${words(blanks)} holes` })

    // Prefer hooks nobody else has used, so two lines never read the same.
    const fresh = hooks.filter((h) => !usedHooks.has(h.kind))
    // The closest-to-pin hook ends in its own aside, so it always goes last.
    const chosen = (fresh.length ? fresh : hooks).slice(0, 2).sort((a, b) => Number(a.kind === 'ctp') - Number(b.kind === 'ctp'))
    chosen.forEach((h) => usedHooks.add(h.kind))
    const place = lines.findIndex((q) => q.total === l.total) + 1
    if (pField.length) pField.push(t(' '))
    if (chosen.length) {
      pField.push(s(l.first), t(` ${chosen.map((h) => h.text).join(' and ')}.`))
    } else {
      const back2 = W.total - l.total
      pField.push(s(l.first), t(` finished ${ordinalOf(place)} with ${l.total} points${back2 > 0 ? `, ${back2} back` : ''}.`))
    }
  }
  for (const p of detail.players) {
    if (p.status !== 'did_not_play') continue
    if (pField.length) pField.push(t(' '))
    pField.push(s(firstName(p.name)), t(' sat out.'))
  }

  // ── Paragraph 4: the week, and what's next ──
  const rounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)
  const remaining = rounds.filter((r) => r.round_number > roundNumber && r.status !== 'abandoned')
  const latest = !rounds.some((r) => r.round_number > roundNumber && (r.status === 'final' || r.status === 'in_progress'))
  const champs = buildChampionships(dbData)
  const countingNums = (upto: number) =>
    rounds.filter((r) => r.round_number <= upto && (r.status === 'final' || r.status === 'in_progress')).map((r) => r.round_number)
  const detailsFor = (nums: number[]) => {
    const m = new Map<number, RoundDetailVM | null>()
    for (const rn of nums) m.set(rn, buildRoundDetail(rn, dbData))
    return m
  }
  const weekAt = (upto: number) => {
    const nums = countingNums(upto)
    if (nums.length === 0) return []
    return standingsThroughRound(champs, upto, buildOverallTiebreak(champs, detailsFor(nums), nums).breakTie)
  }
  const overall = weekAt(roundNumber)
  const before = roundNumber > 1 ? weekAt(roundNumber - 1) : []
  const nameOfId = (id: string) => firstName(dbData.players.find((p) => p.id === id)?.name ?? 'Unknown')
  const p4: ReportSeg[] = []
  const L = overall[0]
  const S = overall.find((r) => r.playerId !== L?.playerId) ?? null
  if (L) {
    const lf = nameOfId(L.playerId)
    const gap = S ? L.total - S.total : 0
    const sf = S ? nameOfId(S.playerId) : ''
    if (remaining.length === 0) {
      p4.push(s(lf), t(gap > 0 ? ` wins the week by ${gap}.` : ` wins the week on the tiebreak, level with ${sf}.`))
    } else if (S && gap === 0) {
      p4.push(s(lf), t(` and `), s(sf), t(` are level for the week on ${L.total}, ${lf} ahead on the tiebreak.`))
    } else if (before.length === 0) {
      p4.push(s(lf), t(` leads the week by `), s(String(gap)), t('.'))
    } else if (before[0]?.playerId === L.playerId) {
      p4.push(s(lf), t(` still leads the week, `), s(`${gap} clear`), t(` of ${sf}.`))
    } else {
      p4.push(s(lf), t(` takes over the week lead, `), s(`${gap} clear`), t(` of ${sf}.`))
    }
    const next = remaining[0]
    if (next) {
      const course = dbData.courses.find((c) => c.id === next.course_id)
      const when = dayAfter(detail.round.date) === next.date.slice(0, 10) ? 'tomorrow' : `on ${formatDay(next.date).split(',')[0]}`
      const left = remaining.length === 1 ? 'one round to go' : `${words(remaining.length)} rounds to go`
      p4.push(t(` ${cap(course ? theShortOf(course.name) : `round ${next.round_number}`)} ${when}, ${left}.`))
    }
  }

  // ── Headline: the story in a line ──
  let headline: string
  switch (kind) {
    case 'shared':
      headline = `${listOf(winners.map((w) => w.first))} share ${theShort}.`
      break
    case 'late':
      headline = forGood === n ? `${W.first} catches ${rival!.first} on the last.` : `${W.first} catches ${rival!.first} late on ${theShort}.`
      break
    case 'comeback':
      headline = `${W.first} comes from ${deficit} back to take ${theShort}.`
      break
    case 'runaway':
      headline = `${W.first} runs away with ${theShort}.`
      break
    case 'close':
      headline = recap.onCountback ? `${W.first} edges ${R!.first} on countback.` : `${W.first} holds off ${R!.first} by ${margin}.`
      break
    default:
      headline = `${W.first} takes ${theShort} by ${margin}.`
  }

  return {
    roundNumber,
    courseName: detail.course.name,
    dateLabel: formatDayLong(detail.round.date),
    dayLabel: `Day ${roundNumber} of ${rounds.length}`,
    headline,
    paragraphs: [p1, p2, pField, p4].filter((p) => p.length > 0),
    dateline: `${detail.course.name} · ${formatDay(detail.round.date)}`,
    latest,
    pending: recap.pending,
    kind,
    stretch,
  }
}
