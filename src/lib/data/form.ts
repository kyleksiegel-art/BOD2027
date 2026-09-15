import { buildRoundDetail, buildChampionships, buildOverallTiebreak, resolveRoundWinnerIds } from './compute'
import type { Db, RoundDetailVM, PlayerRoundVM } from './compute'
import { courseShortName, ordinalOf } from '@/lib/format'

/**
 * Player form — what the stored gross scores say about how each player has actually played the
 * trip. Three figures that start arguments (how far off the index, blanks against net birdies,
 * holes won outright against the field), then each round played hole by hole with its result.
 * Pure and offline-identical, like every other builder: rows in, view models out, every point
 * via the same round detail the scorecard renders from.
 *
 * Built for the whole field at once (one round detail per round, reused across players), the
 * same shape as buildPlayerCourseHandicaps.
 */

/** One hole on the strip. `points` is null when the hole isn't in yet. */
export interface FormCell {
  holeNumber: number
  points: number | null
  played: boolean
  pickedUp: boolean
  eagle: boolean // net eagle or better — gets the ring
  counted: boolean // false past a shortened round's cutoff — the hole isn't part of this round
}

export interface FormRun {
  holes: number // length of the run
  roundNumber: number
  courseName: string
  from: number
  to: number
  points: number
}

/** How the round went for this player: "Won", "Shared", "Leads" (live), or a place. */
export interface FormResult {
  place: number // competition ranking on this round's points (a countback loser drops below the winner)
  tie: boolean // shares the place
  won: boolean // a final round, and this player is one of its resolved winners
  onCountback: boolean // the place was decided by a countback (won or lost)
  label: string // "Won" | "Shared" | "Leads" | "T1" | "2nd" | …
}

export interface FormStrip {
  roundNumber: number
  courseName: string
  points: number
  thru: number
  holesCounted: number
  complete: boolean // through the counted window — the header drops the "thru N"
  live: boolean // the round is still in progress
  result: FormResult
  cells: FormCell[]
}

/**
 * Points against the index. Net Stableford pays 2 a hole for a net par, so a player playing
 * exactly to the index scores 36 over 18 holes; every point short is, near enough, a stroke over.
 * Scaled per 18 holes so a half-played round doesn't drag the figure down.
 */
export interface FormVsIndex {
  pointsPerRound: number // points per 18 holes played, one decimal
  perRound: number // strokes over (positive) or under (negative) the index per round, one decimal
  lean: 'over' | 'under' | 'level'
  verdict: string // the strong opening — "4 over the index a round."
  note: string // the rest — "36 points is level; the low round was 28 on the Red."
}

export interface PlayerFormVM {
  holesPlayed: number // completed holes across counting rounds
  points: number // points across those holes
  roundsPlayed: number // rounds with at least one hole in
  throughLabel: string // "54 holes · 3 rounds"
  bestRun: FormRun | null // longest run of scoring holes — read by the Annual Report's superlatives
  vsIndex: FormVsIndex
  zeros: number // holes with no points (including pick-ups)
  netBirdies: number // holes at 3+ points
  holesWon: number // holes won outright against everyone playing — the standings' own tally
  // One strip per round the player actually PLAYED (a DNP round is absent), newest first, so
  // two rounds of form are comparable without tapping (Kyle 2026-09-07, option A).
  strips: FormStrip[]
}

/** Within this many strokes a round of the index reads as "playing to it". */
const LEVEL_BAND = 0.5

export function buildPlayerForm(dbData: Db): Map<string, PlayerFormVM> {
  const rounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)
  const counts = (s: string) => s === 'final' || s === 'in_progress'

  // One detail per round, shared by every player and by the holes-won tally.
  const detailByRound = new Map<number, RoundDetailVM | null>()
  for (const round of rounds) detailByRound.set(round.round_number, buildRoundDetail(round.round_number, dbData))

  const details: RoundDetailVM[] = []
  for (const round of rounds) {
    if (!counts(round.status)) continue
    const d = detailByRound.get(round.round_number)
    if (d && d.holes && !d.course.data_is_placeholder) details.push(d)
  }

  // Holes won outright, from the SAME tally the overall tiebreak uses, so the card can never
  // disagree with the standings about who has beaten whom.
  const countingRoundNumbers = rounds.filter((r) => counts(r.status)).map((r) => r.round_number)
  const champs = buildChampionships(dbData, detailByRound)
  const { ctx } = buildOverallTiebreak(champs, detailByRound, countingRoundNumbers)

  const out = new Map<string, PlayerFormVM>()
  for (const player of dbData.players) {
    const vm = formFor(player.id, details, ctx.holesWonById.get(player.id) ?? 0)
    if (vm) out.set(player.id, vm)
  }
  return out
}

function formFor(playerId: string, details: RoundDetailVM[], holesWon: number): PlayerFormVM | null {
  let holesPlayed = 0
  let points = 0
  let zeros = 0
  let netBirdies = 0
  let bestRun: FormRun | null = null
  const strips: FormStrip[] = []

  for (const d of details) {
    const p = d.players.find((x) => x.playerId === playerId)
    if (!p || p.status !== 'playing') continue
    const played = p.holeResults.filter((h) => h.completed)
    if (played.length === 0) continue

    for (const h of played) {
      holesPlayed += 1
      const pts = h.points ?? 0
      points += pts
      if (pts === 0) zeros += 1
      if (pts >= 3) netBirdies += 1
    }

    // Longest run of consecutive holes with points, within this round. Ties go to the run worth
    // more points, then to the later round (the current form, not the ancient history).
    let run = 0
    let runPoints = 0
    for (let hole = 1; hole <= d.holesCounted; hole++) {
      const hr = p.holeResults.find((h) => h.holeNumber === hole)
      const scored = !!hr?.completed && (hr.points ?? 0) > 0
      if (scored) {
        run += 1
        runPoints += hr!.points ?? 0
        const better =
          !bestRun ||
          run > bestRun.holes ||
          (run === bestRun.holes && runPoints > bestRun.points) ||
          (run === bestRun.holes && runPoints === bestRun.points && d.round.round_number > bestRun.roundNumber)
        if (better) {
          bestRun = {
            holes: run,
            roundNumber: d.round.round_number,
            courseName: d.course.name,
            from: hole - run + 1,
            to: hole,
            points: runPoints,
          }
        }
      } else {
        run = 0
        runPoints = 0
      }
    }

    // One strip per round played, in round order; reversed to newest-first below.
    strips.push({
      roundNumber: d.round.round_number,
      courseName: d.course.name,
      points: p.totalPoints,
      thru: p.thru,
      holesCounted: d.holesCounted,
      complete: p.thru >= d.holesCounted,
      live: d.round.status === 'in_progress',
      result: resultFor(d, p),
      // Always 18 columns: a 15-hole round rendered 15-across would be wider per cell and
      // hole 8 would not sit above hole 8 of the next strip, which is the whole point of
      // stacking them. Holes past the cutoff are marked instead of dropped.
      cells: Array.from({ length: 18 }, (_, i) => {
        const hole = i + 1
        const counted = hole <= d.holesCounted
        const hr = counted ? p.holeResults.find((h) => h.holeNumber === hole) : undefined
        const pts = hr?.completed ? hr.points ?? 0 : null
        return {
          holeNumber: hole,
          points: pts,
          played: !!hr?.completed,
          pickedUp: !!hr?.pickedUp,
          eagle: pts !== null && pts >= 4,
          counted,
        }
      }),
    })
  }

  if (holesPlayed === 0) return null

  const roundsPlayed = strips.length
  return {
    holesPlayed,
    points,
    roundsPlayed,
    throughLabel: `${holesPlayed} holes · ${roundsPlayed} round${roundsPlayed === 1 ? '' : 's'}`,
    bestRun,
    vsIndex: vsIndexFor(holesPlayed, points, strips),
    zeros,
    netBirdies,
    holesWon,
    strips: strips.reverse(),
  }
}

/**
 * The round's result for one player. On a final round the winner is whoever
 * resolveRoundWinnerIds names (top points → countback → shared only if unbreakable), so the
 * strip agrees with the recap and the money page; anyone level on points who lost the countback
 * is placed behind. On a live round the leader "Leads" and everyone else has a provisional place.
 */
function resultFor(d: RoundDetailVM, p: PlayerRoundVM): FormResult {
  const lb = d.leaderboard
  const ahead = lb.filter((x) => x.totalPoints > p.totalPoints).length
  const level = lb.filter((x) => x.totalPoints === p.totalPoints).length
  let place = ahead + 1
  let tie = level > 1

  if (d.round.status === 'final') {
    const { ids, onCountback } = resolveRoundWinnerIds(d)
    if (ids.includes(p.playerId)) {
      return { place: 1, tie: ids.length > 1, won: true, onCountback, label: ids.length > 1 ? 'Shared' : 'Won' }
    }
    if (place === 1 && ids.length > 0) {
      // Level with the winner on points, beaten on the countback.
      place = ids.length + 1
      tie = level - ids.length > 1
      return { place, tie, won: false, onCountback: true, label: tie ? `T${place}` : ordinalOf(place) }
    }
    return { place, tie, won: false, onCountback: false, label: tie ? `T${place}` : ordinalOf(place) }
  }

  const label = place === 1 ? (tie ? 'T1' : 'Leads') : tie ? `T${place}` : ordinalOf(place)
  return { place, tie, won: false, onCountback: false, label }
}

/** No pronouns (the templates never guess one), names of courses only. */
function vsIndexFor(holesPlayed: number, points: number, strips: FormStrip[]): FormVsIndex {
  const ppr = (points / holesPlayed) * 18
  const over = 36 - ppr
  const pointsPerRound = Math.round(ppr * 10) / 10
  const perRound = Math.round(over * 10) / 10
  const lean: FormVsIndex['lean'] = Math.abs(over) < LEVEL_BAND ? 'level' : over > 0 ? 'over' : 'under'

  // Only a complete round is worth quoting — a live one is still moving.
  const complete = strips.filter((s) => s.complete)
  const low = complete.length ? complete.reduce((a, b) => (b.points < a.points ? b : a)) : null
  const high = complete.length ? complete.reduce((a, b) => (b.points > a.points ? b : a)) : null
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

  if (lean === 'level') {
    return { pointsPerRound, perRound, lean, verdict: 'Playing to the index.', note: '36 points a round is level.' }
  }
  const verdict = `${fmt(Math.abs(perRound))} ${lean} the index a round.`
  let note = '36 points is level'
  if (lean === 'over' && low) note += `; the low round was ${low.points} on the ${courseShortName(low.courseName)}`
  if (lean === 'under' && high) note += `; the best round was ${high.points} on the ${courseShortName(high.courseName)}`
  return { pointsPerRound, perRound, lean, verdict, note: `${note}.` }
}
