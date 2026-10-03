import { buildRoundDetail } from './compute'
import type { Db, PlayerRoundVM } from './compute'
import { pickRound } from './wire'
import { ordinalOf } from '@/lib/format'

/**
 * The Field Report as a story (Kyle 2026-10-02, "switch the field report to the narrative style"):
 * one or two sentences per hole about what CHANGED, quiet holes folded together, a scoreboard line
 * at the turn and at the finish. Newest first. Sits beside the hole-by-hole wire (`wire.ts`) on
 * the same page; this is the default view, that one is "Every hole".
 *
 * Same rules as the round report: analysis first (per-hole points, the lead before/after every
 * hole), prose second; first names, no pronouns, no em dashes; "real eagle" is the gross score,
 * anything earned with a stroke says "net". A hole only counts once EVERY playing player has it;
 * a half-finished hole is reported as such and never calls a lead change.
 */

export interface StorySeg {
  text: string
  strong?: boolean
}

export interface StoryEntry {
  key: string
  label: string // "18th" · "3rd–5th" · "The turn" · "14th" (partial)
  segs: StorySeg[]
  scoreline: string | null // "Chris 44, Kyle 36": the turn and the finish
  emphasis: boolean // lead changed hands, or the hole that broke it open
  kind: 'hole' | 'quiet' | 'turn' | 'partial'
}

export interface StoryVM {
  roundNumber: number
  entries: StoryEntry[] // newest first
}

type Hr = PlayerRoundVM['holeResults'][number]

interface P {
  id: string
  first: string
  holes: Map<number, Hr>
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const words = (n: number) => NUMBER_WORDS[n] ?? String(n)
const firstName = (name: string) => name.split(/\s+/)[0] || name
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
const t = (text: string): StorySeg => ({ text })
const s = (text: string): StorySeg => ({ text, strong: true })

// A shot worth naming, with its verb for one player and for several.
const SHOT: Record<string, { rank: number; one: string; many: string; noun: string }> = {
  albatross: { rank: 7, one: 'makes a real albatross', many: 'make real albatrosses', noun: 'a real albatross' },
  eagle: { rank: 6, one: 'makes a real eagle', many: 'make real eagles', noun: 'a real eagle' },
  birdieNetEagle: { rank: 5, one: 'birdies for a net eagle', many: 'birdie for net eagles', noun: 'a birdie for a net eagle' },
  netEagle: { rank: 4, one: 'makes a net eagle', many: 'make net eagles', noun: 'a net eagle' },
  birdie: { rank: 3, one: 'birdies', many: 'birdie', noun: 'a birdie' },
  netBirdie: { rank: 2, one: 'makes a net birdie', many: 'make net birdies', noun: 'a net birdie' },
  blank: { rank: 0, one: 'blanks', many: 'blank', noun: 'a blank' },
}

function shotOf(hr: Hr | undefined): string | null {
  if (!hr?.completed) return null
  const pts = hr.points ?? 0
  if (hr.pickedUp || pts === 0) return 'blank'
  if (hr.grossStrokes === null) return null
  const gross = hr.grossStrokes - hr.par
  if (gross <= -3) return 'albatross'
  if (gross === -2) return 'eagle'
  if (gross === -1) return pts >= 4 ? 'birdieNetEagle' : 'birdie'
  if (pts >= 4) return 'netEagle'
  if (pts === 3) return 'netBirdie'
  return null
}
const isEagleish = (k: string | null) => k === 'albatross' || k === 'eagle' || k === 'birdieNetEagle' || k === 'netEagle'

/**
 * "Chris birdies for a net eagle and Kyle birdies": players grouped by shot, best first. With
 * `hole`, each group names it ("birdie the 4th", "make net birdies on the 15th").
 */
function shotsClause(shots: { p: P; kind: string }[], hole?: number): string {
  const groups: { kind: string; names: string[] }[] = []
  for (const x of shots.slice().sort((a, b) => SHOT[b.kind].rank - SHOT[a.kind].rank)) {
    const g = groups.find((q) => q.kind === x.kind)
    if (g) g.names.push(x.p.first)
    else groups.push({ kind: x.kind, names: [x.p.first] })
  }
  return listOf(
    groups.map((g) => {
      const verb = g.names.length > 1 ? SHOT[g.kind].many : SHOT[g.kind].one
      const where = hole === undefined ? '' : /^(birdies?|blanks?)$/.test(verb) ? ` the ${ordinalOf(hole)}` : ` on the ${ordinalOf(hole)}`
      return `${listOf(g.names)} ${verb}${where}`
    }),
  )
}

export function buildFieldStory(dbData: Db): StoryVM | null {
  const roundNumber = pickRound(dbData)
  if (roundNumber === null) return null
  const detail = buildRoundDetail(roundNumber, dbData)
  if (!detail || !detail.holes || detail.course.data_is_placeholder) return null

  const players: P[] = detail.players
    .filter((p) => p.status === 'playing')
    .map((p) => ({ id: p.playerId, first: firstName(p.name), holes: new Map(p.holeResults.map((h) => [h.holeNumber, h])) }))
  if (players.length === 0) return null
  const n = detail.holesCounted
  const parOf = new Map(detail.holes.map((h) => [h.holeNumber, h.par]))
  const ctpByHole = new Map<number, string>()
  for (const c of dbData.ctp_results) if (c.round_id === detail.round.id && c.player_id) ctpByHole.set(c.hole_number, c.player_id)

  // ── Analysis: every hole the whole group has finished, and the lead around it ──
  const done = (h: number) => players.every((p) => p.holes.get(h)?.completed)
  let complete = 0
  while (complete < n && done(complete + 1)) complete++
  const anyOn = (h: number) => players.some((p) => p.holes.get(h)?.completed)
  if (complete === 0 && !anyOn(1)) return null

  const cum = (p: P, h: number) => {
    let sum = 0
    for (let i = 1; i <= h; i++) sum += p.holes.get(i)?.points ?? 0
    return sum
  }
  interface Lead {
    leaders: P[]
    gap: number // leader minus the next best; 0 when shared
  }
  const leadAt = (h: number): Lead => {
    const scores = players.map((p) => ({ p, c: cum(p, h) })).sort((a, b) => b.c - a.c)
    const top = scores[0].c
    const leaders = scores.filter((x) => x.c === top).map((x) => x.p)
    const next = scores.find((x) => x.c < top)
    return { leaders, gap: leaders.length > 1 || !next ? 0 : top - next.c }
  }
  const soleId = (l: Lead) => (l.leaders.length === 1 ? l.leaders[0].id : null)

  // The hole that broke it open: the biggest one-hole growth in a sole leader's margin (4+).
  let breaker: { h: number; d: number } | null = null
  for (let h = 2; h <= complete; h++) {
    const a = leadAt(h - 1)
    const b = leadAt(h)
    if (soleId(a) && soleId(a) === soleId(b) && b.gap - a.gap >= 4 && (!breaker || b.gap - a.gap > breaker.d)) breaker = { h, d: b.gap - a.gap }
  }
  // The biggest sole lead, named once, on the first hole it was reached.
  let peakHole = 0
  let peakGap = 0
  for (let q = 1; q <= complete; q++) {
    const l = leadAt(q)
    if (l.leaders.length === 1 && l.gap > peakGap) {
      peakGap = l.gap
      peakHole = q
    }
  }
  const biggest = (h: number) =>
    h === peakHole && h > 3 && peakGap >= 5 ? `, the biggest lead ${complete === n ? 'of the day' : 'so far'}` : ''
  const ctpCount = new Map<string, number>()

  const notable = (h: number): boolean => {
    if (h === 1 || h === n) return true
    const a = leadAt(h - 1)
    const b = leadAt(h)
    if (soleId(a) !== soleId(b) || (a.leaders.length > 1) !== (b.leaders.length > 1)) return true
    if (Math.abs(b.gap - a.gap) >= 3) return true
    if (ctpByHole.has(h)) return true
    return players.some((p) => isEagleish(shotOf(p.holes.get(h))))
  }

  // ── Prose ──
  const entries: StoryEntry[] = [] // oldest first, reversed at the end
  const tail = (l: Lead, h: number, prev: Lead | null): string => {
    if (l.leaders.length > 1) return l.leaders.length === players.length ? 'All square.' : `${listOf(l.leaders.map((p) => p.first))} level at the top.`
    const who = l.leaders[0].first
    if (biggest(h)) return `${who} ${l.gap} clear${biggest(h)}.`
    if (prev && soleId(prev) === soleId(l) && l.gap === prev.gap) return `${who} still ${l.gap} up.`
    return `${who} by ${l.gap}.`
  }

  let h = 1
  while (h <= complete) {
    const prev = h > 1 ? leadAt(h - 1) : null
    if (!notable(h)) {
      // Fold a run of quiet holes into one entry.
      let end = h
      while (end + 1 <= complete && !notable(end + 1)) end++
      const bits: string[] = []
      for (let q = h; q <= end; q++) {
        const shots = players
          .map((p) => ({ p, kind: shotOf(p.holes.get(q)) }))
          .filter((x): x is { p: P; kind: string } => x.kind !== null && x.kind !== 'blank')
        if (shots.length) bits.push(shotsClause(shots, q))
      }
      const after = leadAt(end)
      const lead = bits.length ? `${cap(listOf(bits.slice(0, 3)))}. ` : 'Nothing moves. '
      entries.push({
        key: `q${h}`,
        label: h === end ? ordinalOf(h) : `${ordinalOf(h)}–${ordinalOf(end)}`,
        segs: [t(lead), s(tail(after, end, prev))],
        scoreline: null,
        emphasis: false,
        kind: 'quiet',
      })
      h = end + 1
    } else {
      const now = leadAt(h)
      const segs: StorySeg[] = []
      const shots = players
        .map((p) => ({ p, kind: shotOf(p.holes.get(h)) }))
        .filter((x): x is { p: P; kind: string } => x.kind !== null)
      const changed =
        h === 1 || !prev || soleId(prev) !== soleId(now) || (prev.leaders.length > 1) !== (now.leaders.length > 1)
      let used = new Set<string>()

      if (breaker?.h === h) segs.push(t('The hole that broke it open: '))
      if (changed && now.leaders.length === 1) {
        const x = now.leaders[0]
        const mine = shots.find((q) => q.p.id === x.id && q.kind !== 'blank')
        const verb = h === 1 ? 'leads early' : prev && prev.leaders.length > 1 ? 'takes the lead outright' : 'takes the lead'
        segs.push(s(x.first), t(` ${verb}${mine ? ` with ${SHOT[mine.kind].noun}` : ''}, ${now.gap} clear.`))
        used = new Set([x.id])
      } else if (changed && now.leaders.length > 1) {
        segs.push(
          s(listOf(now.leaders.map((p) => p.first))),
          t(h === 1 ? ' share the early lead.' : now.leaders.length === players.length ? ' are all square.' : ' are level for the lead.'),
        )
        now.leaders.forEach((p) => used.add(p.id))
      }

      // The shots, with blanks only where they matter: the leader's, or everyone else's on an eagle.
      const rest = shots.filter((x) => !used.has(x.p.id))
      const scorers = rest.filter((x) => x.kind !== 'blank')
      const blanks = rest.filter((x) => x.kind === 'blank')
      const othersAllBlank = scorers.length === 1 && isEagleish(scorers[0].kind) && blanks.length === players.length - 1 && blanks.length >= 2
      let clause = ''
      let gapSaid = false
      const prevLeader = prev && prev.leaders.length === 1 ? prev.leaders[0] : null
      const leaderBlank = prevLeader ? blanks.find((b) => b.p.id === prevLeader.id) : undefined
      if (othersAllBlank) {
        clause = `${scorers[0].p.first} ${SHOT[scorers[0].kind].one} while the other ${words(blanks.length)} blank`
      } else {
        const leaderIds = new Set((prev ?? now).leaders.map((p) => p.id))
        const shown = [...scorers, ...blanks.filter((b) => (leaderIds.has(b.p.id) && !leaderBlank) || (blanks.length === 1 && !leaderBlank))]
        if (shown.length) clause = shotsClause(shown)
        const sole = now.leaders.length === 1 ? now.leaders[0] : null
        if (!changed && prev && sole && scorers.length === 1 && !leaderBlank) {
          // One scorer moving the gap reads as one sentence: "to go 11 up" / "and cuts it to 10".
          if (scorers[0].p.id === sole.id && now.gap > prev.gap && breaker?.h !== h) {
            clause += ` to go ${now.gap} up${biggest(h)}`
            gapSaid = true
          } else if (scorers[0].p.id !== sole.id && now.gap < prev.gap) {
            clause += ` and cuts it to ${now.gap}`
            gapSaid = true
          }
        }
      }
      if (leaderBlank && prevLeader) {
        // The leader's blank is the news: lead with it, and say what run it ended.
        let run = 0
        for (let q = h - 1; q >= 1 && (prevLeader.holes.get(q)?.points ?? 0) > 0; q--) run++
        const where = h === n ? 'the last' : `the ${ordinalOf(h)}`
        const note = run === h - 1 && run >= 8 ? ', the first hole all day without a point' : run >= 8 ? ` after ${run} straight holes with points` : ''
        segs.push(t(`${segs.length ? ' ' : ''}${prevLeader.first} blanks ${where}${note}.`))
      }
      if (clause) segs.push(t(`${segs.length && !segs[segs.length - 1].text.endsWith(': ') ? ' ' : ''}${cap(clause)}.`))

      if (!changed && !gapSaid) {
        const a = prev!
        const g = now.gap - a.gap
        const who = now.leaders[0]?.first ?? ''
        const text =
          now.leaders.length > 1
            ? tail(now, h, prev)
            : g >= 3
              ? `${a.gap} clear becomes ${now.gap}${biggest(h)}.`
              : g <= -3
                ? `${who}'s lead is cut to ${now.gap}.`
                : !clause && !leaderBlank && g === 0
                  ? `Nothing moves. ${who} still ${now.gap} up.`
                  : tail(now, h, prev)
        segs.push(t(segs.length ? ' ' : ''), s(text))
      }

      const ctp = ctpByHole.get(h)
      if (ctp && parOf.get(h) === 3) {
        const winner = players.find((p) => p.id === ctp)
        if (winner) {
          const c = (ctpCount.get(ctp) ?? 0) + 1
          ctpCount.set(ctp, c)
          segs.push(t(c >= 2 ? ` ${winner.first} wins the pin again, ${words(c)} for the day.` : ` ${winner.first} wins the closest-to-pin.`))
        }
      }

      const last = h === n
      entries.push({
        key: `h${h}`,
        label: ordinalOf(h),
        segs: segs.length ? segs : [t('Pars all round.')],
        scoreline: last ? scoreline(players, h) : null,
        emphasis: changed && h > 1 ? true : breaker?.h === h,
        kind: 'hole',
      })
      h++
    }
    // A scoreboard at the turn, once the whole group is through 9 of 18.
    if (n === 18 && h === 10 && complete >= 9) {
      entries.push({ key: 'turn', label: 'The turn', segs: [], scoreline: scoreline(players, 9), emphasis: false, kind: 'turn' })
    }
  }

  // A hole some of the group has finished: report who is in, call nothing.
  const partial = complete + 1
  if (partial <= n && anyOn(partial)) {
    const inP = players.filter((p) => p.holes.get(partial)?.completed)
    const outP = players.filter((p) => !p.holes.get(partial)?.completed)
    const shots = inP
      .map((p) => ({ p, kind: shotOf(p.holes.get(partial)) }))
      .filter((x): x is { p: P; kind: string } => x.kind !== null)
    entries.push({
      key: `p${partial}`,
      label: ordinalOf(partial),
      segs: [
        t(`${listOf(inP.map((p) => p.first))} in`),
        t(shots.length ? `: ${shotsClause(shots)}. ` : '. '),
        t(`${listOf(outP.map((p) => p.first))} still to post.`),
      ],
      scoreline: null,
      emphasis: false,
      kind: 'partial',
    })
  }

  return { roundNumber, entries: entries.reverse() }
}

function cap(str: string): string {
  return str ? str[0].toUpperCase() + str.slice(1) : str
}

/** "Chris 44, Kyle 36, Jon 31, Adam 27": everyone at the turn; the top two at the finish. */
function scoreline(players: P[], h: number): string {
  const rows = players
    .map((p) => {
      let c = 0
      for (let i = 1; i <= h; i++) c += p.holes.get(i)?.points ?? 0
      return { first: p.first, c }
    })
    .sort((a, b) => b.c - a.c)
  return rows.map((r) => `${r.first} ${r.c}`).join(', ')
}
