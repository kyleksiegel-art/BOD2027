import { buildChampionships, buildRoundDetail, buildRoundRecap } from './compute'
import type { Db } from './compute'
import { standingsThroughRound } from '@/lib/scoring'
import { formatDay, formatDayLong } from '@/lib/format'

/**
 * The round report — the round's story in four short, plain paragraphs, once the round is
 * final. Pure and offline-identical, like every other builder: rows in, a view model out, all
 * facts from the same recap/detail/championship builders the rest of the round page uses.
 * Nothing is typed; every sentence is derived.
 *
 * Plain language (CLAUDE.md conventions): no boardroom voice — the visual treatment carries the
 * annual-report idea, the copy does not. Names only, never pronouns, so a template never has
 * to guess one.
 */

/** One run of report text; `strong` marks a derived fact the eye should land on. */
export interface ReportSeg {
  text: string
  strong?: boolean
}

export interface ReportVM {
  roundNumber: number
  courseName: string
  dateLabel: string // "Friday, February 5"
  dayLabel: string // "Day 2 of 4"
  headline: string // "Kyle takes the Black. Jon keeps the week."
  paragraphs: ReportSeg[][]
  dateline: string // "Streamsong Black · Fri, Feb 5"
  latest: boolean // the most recent counting round — the report opens by default only then
}

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}
function lastName(name: string): string {
  const parts = name.split(/\s+/)
  return parts[parts.length - 1] || name
}
function ordinalOf(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}
function courseShortName(name: string): string {
  return name.replace(/^Streamsong\s+/i, '')
}
function theShortOf(name: string): string {
  const short = courseShortName(name)
  return /^(Red|Blue|Black)$/i.test(short) ? `the ${short}` : short
}
/** Small counts as words where they open a sentence ("Two rounds remain."). */
function countWord(n: number): string {
  const w = COUNT_WORDS[n]
  return w ? w[0].toUpperCase() + w.slice(1) : String(n)
}
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
/** Stableford points on one hole, in words. */
function pointsPhrase(points: number): string {
  if (points >= 5) return 'a net albatross'
  if (points === 4) return 'a net eagle'
  if (points === 3) return 'a net birdie'
  if (points === 2) return 'a net par'
  if (points === 1) return 'one point'
  return 'a zero'
}

const t = (text: string): ReportSeg => ({ text })
const s = (text: string): ReportSeg => ({ text, strong: true })

export function buildRoundReport(roundNumber: number, dbData: Db): ReportVM | null {
  const recap = buildRoundRecap(roundNumber, dbData)
  if (!recap || recap.act !== 'final') return null
  const detail = buildRoundDetail(roundNumber, dbData)
  if (!detail) return null

  const playing = detail.leaderboard // playing only, desc by points
  if (playing.length === 0) return null
  const nameOf = new Map(playing.map((p) => [p.playerId, p.name]))

  const winner = playing[0]
  const multi = recap.winners.length > 1
  const winnerLabel = multi ? recap.winners.map((w) => lastName(w.name)).join(' and ') : winner.name
  const theShort = theShortOf(detail.course.name)

  // Counting rounds so far, and the trip race through this one.
  const rounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)
  const remainingRounds = rounds.filter((r) => r.round_number > roundNumber && r.status !== 'abandoned').length
  const latest = !rounds.some((r) => r.round_number > roundNumber && (r.status === 'final' || r.status === 'in_progress'))
  const champs = buildChampionships(dbData)
  const overall = standingsThroughRound(champs, roundNumber)
  const before = roundNumber > 1 ? standingsThroughRound(champs, roundNumber - 1) : []
  const champLeader = overall[0]
  const champSecond = overall.find((r) => r.position > 1) ?? null
  const champGap = champLeader && champSecond ? champLeader.total - champSecond.total : 0
  const leaderBefore = before[0]?.playerId ?? null
  const champLeaderName = champLeader ? nameOf.get(champLeader.playerId) ?? playerName(dbData, champLeader.playerId) : ''

  // ── Paragraph 1: the result ──
  const p1: ReportSeg[] = []
  if (multi) {
    p1.push(s(winnerLabel), t(` shared ${theShort} at `), s(`${winner.totalPoints} points`), t(`.`))
  } else {
    p1.push(s(winner.name), t(` won ${theShort} with `), s(`${winner.totalPoints} points`))
    p1.push(t(recap.margin > 0 ? `, ${recap.margin} clear of the field.` : `.`))
    const turn = recap.holeLeaders[8]
    if (turn?.inPlay && turn.order[0] !== winner.playerId) {
      const nth = nthFromBehind(dbData, roundNumber)
      p1.push(t(` ${lastName(winner.name)} was behind at the turn${nth === 1 ? ' — the first round this week won from there' : ''}.`))
    }
  }

  // ── Paragraph 2: how it was decided ──
  const p2: ReportSeg[] = []
  if (multi) {
    p2.push(t(`The lead changed hands ${plural(recap.leadChangeCount, 'time')} and nobody got clear.`))
  } else if (recap.leadChangeCount === 0) {
    p2.push(s(lastName(winner.name)), t(` led from the 1st and was never caught.`))
  } else {
    // The last hole on which the leader changed is where it was decided.
    let prev: string | null = null
    let decided: { hole: number; displaced: string | null } | null = null
    for (const h of recap.holeLeaders) {
      if (!h.inPlay) continue
      if (prev !== null && h.order[0] !== prev) decided = { hole: h.holeNumber, displaced: prev }
      prev = h.order[0]
    }
    if (decided) {
      const wHole = winner.holeResults.find((h) => h.holeNumber === decided!.hole)
      const displaced = decided.displaced ? playing.find((p) => p.playerId === decided!.displaced) : null
      const dHole = displaced?.holeResults.find((h) => h.holeNumber === decided!.hole)
      p2.push(t(`It turned on the `), s(ordinalOf(decided.hole)), t(`: `), s(lastName(winner.name)))
      p2.push(t(` made ${pointsPhrase(wHole?.points ?? 0)} there`))
      if (displaced && dHole) {
        p2.push(
          t(` while `),
          s(displaced.name),
          t(`, the leader through ${decided.hole - 1}, made ${pointsPhrase(dHole.points ?? 0)}.`),
        )
      } else {
        p2.push(t('.'))
      }
    }
  }
  // Biggest improvement on the previous counting round (round 2+).
  const prevRound = rounds.filter((r) => r.round_number < roundNumber && (r.status === 'final' || r.status === 'in_progress')).pop()
  if (prevRound) {
    let best: { name: string; pts: number; delta: number } | null = null
    for (const p of playing) {
      const c = champs.find((x) => x.playerId === p.playerId)
      const prevPts = c?.byRound.find((r) => r.roundNumber === prevRound.round_number && r.counts)?.points
      if (prevPts === undefined) continue
      const delta = p.totalPoints - prevPts
      if (delta > 0 && (!best || delta > best.delta)) best = { name: p.name, pts: p.totalPoints, delta }
    }
    if (best) {
      const prevCourse = dbData.courses.find((c) => c.id === prevRound.course_id)
      const prevShort = prevCourse ? courseShortName(prevCourse.name) : `round ${prevRound.round_number}`
      if (p2.length) p2.push(t(' '))
      p2.push(
        s(best.name),
        t(` posted ${best.pts}, `),
        s(`${best.delta} better`),
        t(` than at ${prevShort}, the biggest jump of the day.`),
      )
    }
  }

  // ── Paragraph 3: the worst three-hole stretch on the books ──
  const p3: ReportSeg[] = []
  const worst = worstStretch(playing, detail.holesCounted)
  if (worst) {
    const who = nameOf.get(worst.playerId) ?? ''
    if (worst.points <= 2) {
      p3.push(
        t(`Worst stretch of the day: `),
        s(who),
        t(`, ${worst.points === 0 ? 'no points' : plural(worst.points, 'point')} across the `),
        s(`${ordinalOf(worst.from)} through ${ordinalOf(worst.from + 2)}`),
        t(`.`),
      )
      const row = overall.find((r) => r.playerId === worst.playerId)
      if (row && champLeader && row.playerId !== champLeader.playerId) {
        p3.push(t(` ${lastName(who)} is ${ordinalOf(row.position)} overall, ${champLeader.total - row.total} back.`))
      }
    } else {
      p3.push(t(`Nobody had a three-hole stretch worse than ${plural(worst.points, 'point')}.`))
    }
  }

  // ── The rest of the field: every player is named, once. Anyone the story above skipped
  //    gets a line with a place and a hook; anyone who sat out is named as such. ──
  const named = (id: string) => {
    const last = lastName(nameOf.get(id) ?? playerName(dbData, id))
    return [p1, p2, p3].some((para) => para.some((seg) => seg.text.includes(last)))
  }
  const pField: ReportSeg[] = []
  for (const p of playing) {
    if (named(p.playerId)) continue
    // Competition place: ties share the higher place.
    const place = playing.findIndex((q) => q.totalPoints === p.totalPoints) + 1
    const gap = winner.totalPoints - p.totalPoints
    if (pField.length) pField.push(t(' '))
    pField.push(s(p.name), t(` finished ${ordinalOf(place)} with ${p.totalPoints} points${gap > 0 ? `, ${gap} back` : ''}`))
    const done = p.holeResults.filter((h) => h.completed)
    const best = done.reduce<(typeof done)[number] | null>((b, h) => ((h.points ?? 0) >= 3 && (h.points ?? 0) > (b?.points ?? 0) ? h : b), null)
    const blanks = done.filter((h) => (h.points ?? 0) === 0).length
    if (best) pField.push(t(`; ${pointsPhrase(best.points ?? 0)} on the ${ordinalOf(best.holeNumber)} was the high point.`))
    else if (blanks >= 2) pField.push(t(` and ${blanks} blanks.`))
    else pField.push(t('.'))
  }
  for (const p of detail.players) {
    if (p.status !== 'did_not_play') continue
    if (pField.length) pField.push(t(' '))
    pField.push(s(p.name), t(' sat out.'))
  }

  // ── Paragraph 4: the week ──
  const p4: ReportSeg[] = []
  if (champLeader) {
    const secondName = champSecond ? nameOf.get(champSecond.playerId) ?? playerName(dbData, champSecond.playerId) : null
    const gapText = secondName ? (champGap > 0 ? `, ${champGap} clear of ${lastName(secondName)}` : `, level with ${lastName(secondName)}`) : ''
    if (remainingRounds === 0) {
      p4.push(s(champLeaderName), t(` wins the week at `), s(String(champLeader.total)), t(`${gapText}.`))
    } else {
      p4.push(s(champLeaderName), t(` leads the week at `), s(String(champLeader.total)), t(`${gapText}. `))
      p4.push(t(remainingRounds === 1 ? 'One round to go.' : `${countWord(remainingRounds)} rounds to go.`))
    }
  }

  // ── Headline ──
  const winFirst = multi ? recap.winners.map((w) => firstName(w.name)).join(' and ') : firstName(winner.name)
  let head = `${winFirst} ${multi ? 'share' : 'takes'} ${theShort}.`
  if (champLeader) {
    const lf = firstName(champLeaderName)
    if (remainingRounds === 0) head += ` ${lf} takes the week.`
    else if (roundNumber === 1) head += ` ${lf} leads the week.`
    else if (leaderBefore === champLeader.playerId) head += ` ${lf} keeps the week.`
    else head += ` ${lf} takes the week lead.`
  }

  return {
    roundNumber,
    courseName: detail.course.name,
    dateLabel: formatDayLong(detail.round.date),
    dayLabel: `Day ${roundNumber} of ${rounds.length}`,
    headline: head,
    paragraphs: [p1, p2, p3, pField, p4].filter((p) => p.length > 0),
    dateline: `${detail.course.name} · ${formatDay(detail.round.date)}`,
    latest,
  }
}

function playerName(dbData: Db, id: string): string {
  return dbData.players.find((p) => p.id === id)?.name ?? 'Unknown'
}

/** How many final rounds so far (this one included) were won by someone behind at the turn. */
function nthFromBehind(dbData: Db, roundNumber: number): number {
  let n = 0
  for (const r of dbData.rounds) {
    if (r.round_number > roundNumber || r.status !== 'final') continue
    const rc = buildRoundRecap(r.round_number, dbData)
    if (!rc || rc.winners.length !== 1) continue
    const turn = rc.holeLeaders[8]
    const winnerId = rc.standing[0]?.playerId
    if (turn?.inPlay && winnerId && turn.order[0] !== winnerId) n++
  }
  return n
}

/** The lowest three consecutive completed holes by anyone in the counted window. Ties → earliest, then leaderboard order. */
function worstStretch(
  playing: { playerId: string; holeResults: { holeNumber: number; points: number | null; completed: boolean }[] }[],
  holesCounted: number,
): { playerId: string; from: number; points: number } | null {
  let best: { playerId: string; from: number; points: number } | null = null
  for (const p of playing) {
    for (let from = 1; from + 2 <= holesCounted; from++) {
      let sum = 0
      let ok = true
      for (let h = from; h <= from + 2; h++) {
        const hr = p.holeResults.find((x) => x.holeNumber === h)
        if (!hr?.completed) {
          ok = false
          break
        }
        sum += hr.points ?? 0
      }
      if (ok && (!best || sum < best.points)) best = { playerId: p.playerId, from, points: sum }
    }
  }
  return best
}
