// The Annual Report — the trip's capstone, assembled purely from Dexie rows like every other
// builder. Null until the season is complete (every counting round final, or all its scores in);
// then: the champion, the final standings, each round's winner, a handful of superlatives the
// stored scores already imply, the settled money, and a short written letter.
//
// Plain language (CLAUDE.md conventions): the visual treatment carries the annual-report idea,
// the copy does not. Names only, never pronouns, so a template never has to guess one. Every fact
// is derived — nothing is typed — and every dollar comes from the same buildMoney the Money page
// uses, so the report can never disagree with it.

import {
  buildChampionships,
  buildOverallTiebreak,
  buildRoundDetail,
  buildRoundRecap,
  buildStandings,
  resolveRoundWinnerIds,
  type Db,
  type RoundDetailVM,
} from './compute'
import { buildMoney } from './money'
import { buildPlayerForm } from './form'
import type { ReportSeg } from './report'
import { standingsThroughRound } from '@/lib/scoring'
import { courseShortName, courseSlug, formatMoney } from '@/lib/format'

export interface AnnualStandingVM {
  playerId: string
  name: string
  position: number
  total: number
  gapToLeader: number
  tie: boolean
}

export interface AnnualRoundWinnerVM {
  roundNumber: number
  courseName: string
  slug: 'red' | 'black' | 'blue' | 'bone' | null
  dayLabel: string // "Thu"
  winnerNames: string[]
  points: number
  onCountback: boolean
}

/** One "The Numbers" tile. `value` is the headline figure; `who`/`detail` the caption. */
export interface AnnualSuperlativeVM {
  key: string
  label: string // "Low round"
  value: string // "41"
  who: string // "Kyle" — first name, for the tile caption
  playerId: string // the full identity, for the letter (which matches on last name)
  detail: string // "Black · Fri"
}

export interface AnnualMoneyLineVM {
  label: string
  amount: string
}

export interface AnnualMoneyVM {
  totalPot: string
  lines: AnnualMoneyLineVM[]
  balanced: boolean
  balanceLabel: string // "$1,000" — the awarded + pending total, for the balance row
}

export interface AnnualReportVM {
  seasonLabel: string // "The 2027 Season"
  dateLabel: string // "February 4–7, 2027"
  headline: string // "Kyle takes 2027."
  champion: {
    name: string
    total: number
    winnings: string // "$700"
    winningsDetail: string // "$600 championship + two round wins"
    shared: boolean // co-champions (an unbreakable tie for 1st)
  }
  standings: AnnualStandingVM[]
  roundWinners: AnnualRoundWinnerVM[]
  superlatives: AnnualSuperlativeVM[]
  money: AnnualMoneyVM
  letter: ReportSeg[][]
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

const t = (text: string): ReportSeg => ({ text })
const s = (text: string): ReportSeg => ({ text, strong: true })

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}
function lastName(name: string): string {
  const parts = name.split(/\s+/)
  return parts[parts.length - 1] || name
}
function ordinalOf(n: number): string {
  const suf = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (suf[(v - 20) % 10] ?? suf[v] ?? suf[0])
}
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
function countWord(n: number): string {
  const w = COUNT_WORDS[n]
  return w ? w[0].toUpperCase() + w.slice(1) : String(n)
}
/** "the Black" / "the Red" / "Bone Valley" — matches report.ts's voice. */
function theShortOf(name: string): string {
  const short = courseShortName(name)
  return /^(Red|Blue|Black)$/i.test(short) ? `the ${short}` : short
}
/** Weekday for an ISO date, read as a plain calendar date (no timezone drift). */
function weekdayOf(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? ''
}
function dayShort(iso: string): string {
  return weekdayOf(iso).slice(0, 3)
}

/** "February 4–7, 2027" from the season's first and last dates (same month assumed for this trip). */
function seasonDateLabel(dates: string[]): string {
  if (dates.length === 0) return ''
  const sorted = dates.slice().sort()
  const [ay, am, ad] = sorted[0].slice(0, 10).split('-').map(Number)
  const [by, bm, bd] = sorted[sorted.length - 1].slice(0, 10).split('-').map(Number)
  if (ay === by && am === bm) return `${MONTHS[am - 1]} ${ad}–${bd}, ${ay}`
  if (ay === by) return `${MONTHS[am - 1]} ${ad} – ${MONTHS[bm - 1]} ${bd}, ${ay}`
  return `${MONTHS[am - 1]} ${ad}, ${ay} – ${MONTHS[bm - 1]} ${bd}, ${by}`
}

export function buildAnnualReport(dbData: Db): AnnualReportVM | null {
  const orderedRounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)
  const countingRounds = orderedRounds.filter((r) => r.status === 'final' || r.status === 'in_progress')
  if (countingRounds.length === 0) return null

  // The season is complete when nothing is still to be played (no upcoming round) and every
  // counting round is done — official finalize OR all scores in, the same gate the round report
  // uses. That is the capstone moment; before it, the report does not exist.
  const anyUpcoming = orderedRounds.some((r) => r.status === 'upcoming')
  if (anyUpcoming) return null
  const allDone = countingRounds.every((r) => buildRoundRecap(r.round_number, dbData)?.act === 'final')
  if (!allDone) return null

  const countingRoundNumbers = countingRounds.map((r) => r.round_number)
  const detailByRound = new Map<number, RoundDetailVM | null>()
  for (const r of orderedRounds) detailByRound.set(r.round_number, buildRoundDetail(r.round_number, dbData))

  const standings = buildStandings(dbData)
  if (!standings.hasCountingRound || standings.rows.length === 0) return null
  const money = buildMoney(dbData)
  const champs = buildChampionships(dbData, detailByRound)
  const form = buildPlayerForm(dbData)
  const { ctx: tbCtx } = buildOverallTiebreak(champs, detailByRound, countingRoundNumbers)

  const nameById = new Map(dbData.players.map((p) => [p.id, p.name]))
  const nameOf = (id: string) => nameById.get(id) ?? 'Unknown'

  // ── Champion + standings ──
  const rows = standings.rows
  const champRow = rows[0]
  const champId = champRow.playerId
  const champName = nameOf(champId)
  const sharedChamp = champRow.tie
  const secondRow = rows.find((r) => r.position > champRow.position) ?? null

  const champMoney = money.players.find((p) => p.playerId === champId)
  const champRoundWins = money.rounds.filter((r) => r.roundWinner?.playerIds.includes(champId)).length
  const winningsDetail = winningsDetailFor(money.champFirstCents > 0, sharedChamp, champRoundWins)

  const standingVMs: AnnualStandingVM[] = rows.map((r) => ({
    playerId: r.playerId,
    name: nameOf(r.playerId),
    position: r.position,
    total: r.total,
    gapToLeader: r.gapToLeader,
    tie: r.tie,
  }))

  // ── Round winners ──
  const roundWinners: AnnualRoundWinnerVM[] = []
  for (const round of countingRounds) {
    const detail = detailByRound.get(round.round_number)
    if (!detail) continue
    const { ids, onCountback } = resolveRoundWinnerIds(detail)
    if (ids.length === 0) continue
    roundWinners.push({
      roundNumber: round.round_number,
      courseName: detail.course.name,
      slug: courseSlug(detail.course.name),
      dayLabel: dayShort(detail.round.date),
      winnerNames: ids.map(nameOf),
      points: detail.leaderboard[0]?.totalPoints ?? 0,
      onCountback,
    })
  }

  // ── The Numbers ──
  const superlatives = buildSuperlatives(dbData, detailByRound, countingRoundNumbers, form, tbCtx, nameOf)

  // ── Money ──
  const moneyVM: AnnualMoneyVM = {
    totalPot: formatMoney(money.totalPotCents),
    lines: [
      { label: `1st overall — ${firstName(champName)}`, amount: formatMoney(money.champFirstCents) },
      ...(secondRow ? [{ label: `2nd overall — ${firstName(nameOf(secondRow.playerId))}`, amount: formatMoney(money.champSecondCents) }] : []),
      { label: `Round winners — ${plural(roundWinners.length, 'round')} × ${formatMoney(money.rounds.find((r) => r.counts)?.roundPurseCents ?? 0)}`, amount: formatMoney(money.roundWinnersTotalCents) },
    ],
    balanced: money.reconciliation.balanced,
    balanceLabel: formatMoney(money.reconciliation.awardedCents + money.reconciliation.pendingCents),
  }

  // ── The letter ──
  const letter = buildLetter({
    dbData,
    champs,
    detailByRound,
    countingRoundNumbers,
    standings,
    superlatives,
    roundWinners,
    champId,
    sharedChamp,
    secondRow,
    nameOf,
  })

  return {
    seasonLabel: seasonLabelFor(countingRounds.map((r) => r.date)),
    dateLabel: seasonDateLabel(countingRounds.map((r) => r.date)),
    headline: `${firstName(champName)} ${sharedChamp ? 'shares' : 'takes'} ${seasonYear(countingRounds.map((r) => r.date))}.`,
    champion: {
      name: champName,
      total: champRow.total,
      winnings: formatMoney(champMoney?.winningsCents ?? 0),
      winningsDetail,
      shared: sharedChamp,
    },
    standings: standingVMs,
    roundWinners,
    superlatives,
    money: moneyVM,
    letter,
  }
}

function seasonYear(dates: string[]): string {
  return dates[0]?.slice(0, 4) ?? ''
}
function seasonLabelFor(dates: string[]): string {
  const y = seasonYear(dates)
  return y ? `The ${y} Season` : 'The Season'
}

function winningsDetailFor(hasChampMoney: boolean, shared: boolean, roundWins: number): string {
  const champ = shared ? 'shared 1st' : '1st overall'
  const parts = hasChampMoney ? [champ] : []
  if (roundWins === 1) parts.push('one round win')
  else if (roundWins > 1) parts.push(`${countWord(roundWins).toLowerCase()} round wins`)
  return parts.join(' + ')
}

// ── The Numbers ────────────────────────────────────────────────────────────────

function buildSuperlatives(
  dbData: Db,
  detailByRound: Map<number, RoundDetailVM | null>,
  countingRoundNumbers: number[],
  form: ReturnType<typeof buildPlayerForm>,
  tbCtx: ReturnType<typeof buildOverallTiebreak>['ctx'],
  nameOf: (id: string) => string,
): AnnualSuperlativeVM[] {
  const out: AnnualSuperlativeVM[] = []
  const first = (id: string) => firstName(nameOf(id))

  // Low round — best single-round total by anyone. Ties → earliest round (deterministic).
  let low: { pts: number; playerId: string; course: string; day: string } | null = null
  for (const rn of countingRoundNumbers) {
    const d = detailByRound.get(rn)
    if (!d) continue
    for (const p of d.leaderboard) {
      if (p.status !== 'playing') continue
      if (!low || p.totalPoints > low.pts) low = { pts: p.totalPoints, playerId: p.playerId, course: d.course.name, day: dayShort(d.round.date) }
    }
  }
  if (low && low.pts > 0) {
    out.push({ key: 'low-round', label: 'Low round', value: String(low.pts), who: first(low.playerId), playerId: low.playerId, detail: `${courseShortName(low.course)} · ${low.day}` })
  }

  // Longest run of scoring holes, within one round (from the form builder).
  let bestRun: { holes: number; playerId: string; course: string } | null = null
  for (const [playerId, vm] of form) {
    if (!vm.bestRun) continue
    if (!bestRun || vm.bestRun.holes > bestRun.holes) bestRun = { holes: vm.bestRun.holes, playerId, course: vm.bestRun.courseName }
  }
  if (bestRun && bestRun.holes >= 3) {
    out.push({ key: 'streak', label: 'Longest streak', value: String(bestRun.holes), who: first(bestRun.playerId), playerId: bestRun.playerId, detail: 'holes with points' })
  }

  // Holes won outright across the trip — the sole low net on a hole (from the tiebreak tally).
  let holesWon: { count: number; playerId: string } | null = null
  for (const [playerId, count] of tbCtx.holesWonById) {
    if (!holesWon || count > holesWon.count) holesWon = { count, playerId }
  }
  if (holesWon && holesWon.count > 0) {
    out.push({ key: 'holes-won', label: 'Holes won outright', value: String(holesWon.count), who: first(holesWon.playerId), playerId: holesWon.playerId, detail: 'sole low net' })
  }

  // Net birdies or better — completed holes worth 3+ points.
  const birdies = new Map<string, number>()
  for (const rn of countingRoundNumbers) {
    const d = detailByRound.get(rn)
    if (!d) continue
    for (const p of d.players) {
      if (p.status !== 'playing') continue
      for (const hr of p.holeResults) if (hr.completed && (hr.points ?? 0) >= 3) birdies.set(p.playerId, (birdies.get(p.playerId) ?? 0) + 1)
    }
  }
  let mostBirdies: { count: number; playerId: string } | null = null
  for (const [playerId, count] of birdies) if (!mostBirdies || count > mostBirdies.count) mostBirdies = { count, playerId }
  if (mostBirdies && mostBirdies.count > 0) {
    out.push({ key: 'net-birdies', label: 'Net birdies+', value: String(mostBirdies.count), who: first(mostBirdies.playerId), playerId: mostBirdies.playerId, detail: 'most in the field' })
  }

  // Roughest hole — the worst single net-to-par by anyone. Ties → earliest (round, hole).
  let roughest: { over: number; playerId: string; course: string; hole: number } | null = null
  for (const rn of countingRoundNumbers) {
    const d = detailByRound.get(rn)
    if (!d) continue
    for (const p of d.players) {
      if (p.status !== 'playing') continue
      for (const hr of p.holeResults) {
        if (!hr.completed || hr.netToPar === null) continue
        if (!roughest || hr.netToPar > roughest.over) roughest = { over: hr.netToPar, playerId: p.playerId, course: d.course.name, hole: hr.holeNumber }
      }
    }
  }
  if (roughest && roughest.over > 0) {
    out.push({ key: 'roughest', label: 'Roughest hole', value: `+${roughest.over}`, who: first(roughest.playerId), playerId: roughest.playerId, detail: `net · ${courseShortName(roughest.course)} ${ordinalOf(roughest.hole)}` })
  }

  // Closest to pin — the bragging-rights count (no money). Ties → the first recorded winner.
  const ctp = new Map<string, number>()
  for (const c of dbData.ctp_results) if (c.player_id) ctp.set(c.player_id, (ctp.get(c.player_id) ?? 0) + 1)
  let mostCtp: { count: number; playerId: string } | null = null
  for (const [playerId, count] of ctp) if (!mostCtp || count > mostCtp.count) mostCtp = { count, playerId }
  if (mostCtp && mostCtp.count > 0) {
    out.push({ key: 'ctp', label: 'Closest to pin', value: String(mostCtp.count), who: first(mostCtp.playerId), playerId: mostCtp.playerId, detail: 'bragging rights' })
  }

  return out
}

// ── The letter ───────────────────────────────────────────────────────────────

interface LetterInput {
  dbData: Db
  champs: ReturnType<typeof buildChampionships>
  detailByRound: Map<number, RoundDetailVM | null>
  countingRoundNumbers: number[]
  standings: ReturnType<typeof buildStandings>
  superlatives: AnnualSuperlativeVM[]
  roundWinners: AnnualRoundWinnerVM[]
  champId: string
  sharedChamp: boolean
  secondRow: ReturnType<typeof buildStandings>['rows'][number] | null
  nameOf: (id: string) => string
}

function buildLetter(input: LetterInput): ReportSeg[][] {
  const { dbData, champs, detailByRound, countingRoundNumbers, standings, superlatives, champId, secondRow, nameOf } = input
  const rows = standings.rows
  const champName = nameOf(champId)
  const champTotal = rows[0].total

  // Running week leader through each counting round, ties broken on the real chain (as the
  // standings and the round report do — never a raw points sort that names the wrong leader).
  const detailsFor = (nums: number[]) => {
    const m = new Map<number, RoundDetailVM | null>()
    for (const rn of nums) m.set(rn, detailByRound.get(rn) ?? null)
    return m
  }
  const leaderThrough = (n: number): string | null => {
    const nums = countingRoundNumbers.filter((r) => r <= n)
    if (nums.length === 0) return null
    const bt = buildOverallTiebreak(champs, detailsFor(nums), nums).breakTie
    const through = standingsThroughRound(champs, n, bt)
    return through[0]?.playerId ?? null
  }

  const leaders = countingRoundNumbers.map((n) => ({ n, leader: leaderThrough(n) }))

  // ── Paragraph 1: the result + when it was decided ──
  const p1: ReportSeg[] = []
  if (input.sharedChamp && secondRow) {
    p1.push(s(`${lastName(champName)} and ${lastName(nameOf(secondRow.playerId))}`), t(` shared the season at `), s(`${champTotal} points`), t(`.`))
  } else {
    p1.push(s(champName), t(` takes the season with `), s(`${champTotal} points`))
    if (secondRow) {
      const gap = champTotal - secondRow.total
      p1.push(gap > 0 ? t(`, `) : t(`, `))
      if (gap > 0) p1.push(s(`${gap} clear`), t(` of ${lastName(nameOf(secondRow.playerId))}.`))
      else p1.push(t(`level on points with ${lastName(nameOf(secondRow.playerId))} but ahead on the tiebreak.`))
    } else {
      p1.push(t(`.`))
    }
    // When the champion took the lead for good.
    const firstLeader = leaders[0]?.leader
    if (firstLeader === champId) {
      const firstRound = detailByRound.get(countingRoundNumbers[0])
      if (firstRound) p1.push(t(` ${lastName(champName)} led from ${weekdayOf(firstRound.round.date)} and was never caught.`))
    } else {
      // The last round after which the running leader was not yet the champion.
      let tookAfterIdx = -1
      for (let i = 0; i < leaders.length; i++) if (leaders[i].leader !== champId) tookAfterIdx = i
      const takeRoundNum = leaders[tookAfterIdx + 1]?.n
      const d = takeRoundNum !== undefined ? detailByRound.get(takeRoundNum) : null
      if (d) p1.push(t(` ${lastName(champName)} took the lead for good on ${theShortOf(d.course.name)}.`))
    }
  }

  // ── Paragraph 2: the chase ──
  const p2: ReportSeg[] = []
  if (secondRow && !input.sharedChamp) {
    const secondName = nameOf(secondRow.playerId)
    p2.push(s(secondName), t(` pushed hardest`))
    // Did second ever lead the week?
    const ledRounds = leaders.filter((l) => l.leader === secondRow.playerId)
    const lastLed = ledRounds.length ? ledRounds[ledRounds.length - 1].n : null
    if (lastLed !== null) {
      const d = detailByRound.get(lastLed)
      if (d) p2.push(t(`, in front of the week through ${theShortOf(d.course.name)}`))
    }
    const gap = champTotal - secondRow.total
    p2.push(t(gap > 0 ? `, ${plural(gap, 'point')} back at the close.` : `.`))
  }

  // ── Paragraph 3: the numbers, naming whoever they name ──
  const p3: ReportSeg[] = []
  const low = superlatives.find((x) => x.key === 'low-round')
  const rough = superlatives.find((x) => x.key === 'roughest')
  if (low) {
    p3.push(t(`The low round of the week was `), s(`${low.value} at ${low.detail.split(' · ')[0]}`), t(`, `), s(nameOf(low.playerId)), t(`.`))
  }
  if (rough) {
    if (p3.length) p3.push(t(` `))
    p3.push(s(nameOf(rough.playerId)), t(` found the roughest hole, `), s(`${rough.value} net`), t(` on the ${rough.detail.split('· ')[1] ?? rough.detail}.`))
  }

  // ── The rest of the field: every player named once, with a place and a hook. ──
  const named = (id: string) => {
    const last = lastName(nameOf(id))
    return [p1, p2, p3].some((para) => para.some((seg) => seg.text.includes(last)))
  }
  const hookFor = (id: string): string | null => {
    const mine = superlatives.find((x) => x.playerId === id)
    if (!mine) return null
    if (mine.key === 'ctp') return `${mine.value} closest-to-pins and, as designed, no money for them`
    if (mine.key === 'net-birdies') return `the field's most net birdies (${mine.value})`
    if (mine.key === 'streak') return `a ${mine.value}-hole run of scoring holes`
    if (mine.key === 'holes-won') return `${mine.value} holes won outright`
    return null
  }
  const pField: ReportSeg[] = []
  for (const r of rows) {
    if (named(r.playerId)) continue
    if (pField.length) pField.push(t(` `))
    const gap = rows[0].total - r.total
    pField.push(s(nameOf(r.playerId)), t(` finished ${ordinalOf(r.position)} at ${r.total}${gap > 0 ? `, ${gap} back` : ''}`))
    const hook = hookFor(r.playerId)
    pField.push(t(hook ? ` — ${hook}.` : `.`))
  }

  // ── Paragraph 4: the money + close ──
  const p4: ReportSeg[] = []
  const money = buildMoney(dbData)
  const champMoney = money.players.find((p) => p.playerId === champId)
  if (champMoney && champMoney.winningsCents > 0) {
    p4.push(s(firstName(champName)), t(` goes home with `), s(formatMoney(champMoney.winningsCents)), t(`. `))
  }
  // Only claim "every dollar accounted for" when the purse actually reconciles; an abandoned
  // round or a misconfigured amount genuinely won't, and the money card says so above.
  p4.push(
    t(
      money.reconciliation.balanced
        ? `${formatMoney(money.totalPotCents)} in, every dollar accounted for. Same time next year.`
        : `${formatMoney(money.totalPotCents)} in. Same time next year.`,
    ),
  )

  return [p1, p2, p3, pField, p4].filter((p) => p.length > 0)
}
