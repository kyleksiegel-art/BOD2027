import { buildRoundDetail } from './compute'
import type { Db, RoundDetailVM } from './compute'

/**
 * Player form — what the stored gross scores say about how each player has actually played the
 * trip: the longest run of scoring holes, the worst three-hole stretch, the front/back split,
 * and the latest round hole by hole. Pure and offline-identical, like every other builder: rows
 * in, view models out, every point via the same round detail the scorecard renders from.
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
}

export interface FormRun {
  holes: number // length of the run
  roundNumber: number
  courseName: string
  from: number
  to: number
  points: number
}

export interface FormStretch {
  points: number // total over the three holes
  roundNumber: number
  courseName: string
  from: number // first hole of the three
}

export interface FormNine {
  points: number
  holes: number // completed holes counted into `points`
}

export interface FormStrip {
  roundNumber: number
  courseName: string
  points: number
  thru: number
  holesCounted: number
  cells: FormCell[]
}

export interface PlayerFormVM {
  holesPlayed: number // completed holes across counting rounds
  points: number // points across those holes
  throughLabel: string // "through R3, hole 12 · 48 holes"
  bestRun: FormRun | null
  worstStretch: FormStretch | null
  front: FormNine
  back: FormNine
  // The nines compared honestly: raw totals are misleading (mid-round the front has more holes
  // in it), so the sentence quotes points PER HOLE and the tile shows the hole counts.
  splitNote: string | null // "1.4 points a hole on the front, 1.2 on the back" — null when too early
  splitLean: 'front' | 'back' | 'even' | null
  strip: FormStrip | null // the latest counting round the player actually played
}

/** A nine needs this many holes before the split is worth a sentence. */
const MIN_NINE_HOLES = 5

export function buildPlayerForm(dbData: Db): Map<string, PlayerFormVM> {
  const rounds = dbData.rounds
    .slice()
    .filter((r) => r.status === 'final' || r.status === 'in_progress')
    .sort((a, b) => a.round_number - b.round_number)

  // One detail per round, shared by every player.
  const details: RoundDetailVM[] = []
  for (const round of rounds) {
    const d = buildRoundDetail(round.round_number, dbData)
    if (d && d.holes && !d.course.data_is_placeholder) details.push(d)
  }

  const out = new Map<string, PlayerFormVM>()
  for (const player of dbData.players) {
    const vm = formFor(player.id, details)
    if (vm) out.set(player.id, vm)
  }
  return out
}

function formFor(playerId: string, details: RoundDetailVM[]): PlayerFormVM | null {
  let holesPlayed = 0
  let points = 0
  const front: FormNine = { points: 0, holes: 0 }
  const back: FormNine = { points: 0, holes: 0 }
  let bestRun: FormRun | null = null
  let worstStretch: FormStretch | null = null
  let strip: FormStrip | null = null
  let lastRoundNumber = 0
  let lastThru = 0

  for (const d of details) {
    const p = d.players.find((x) => x.playerId === playerId)
    if (!p || p.status !== 'playing') continue
    const played = p.holeResults.filter((h) => h.completed)
    if (played.length === 0) continue

    for (const h of played) {
      holesPlayed += 1
      points += h.points ?? 0
      const nine = h.holeNumber <= 9 ? front : back
      nine.points += h.points ?? 0
      nine.holes += 1
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

    // Worst three consecutive COMPLETED holes. Ties go to the earliest (round, hole), so the
    // number never jumps around as later rounds match it.
    for (let from = 1; from + 2 <= d.holesCounted; from++) {
      let sum = 0
      let ok = true
      for (let hole = from; hole <= from + 2; hole++) {
        const hr = p.holeResults.find((h) => h.holeNumber === hole)
        if (!hr?.completed) {
          ok = false
          break
        }
        sum += hr.points ?? 0
      }
      if (ok && (!worstStretch || sum < worstStretch.points)) {
        worstStretch = {
          points: sum,
          roundNumber: d.round.round_number,
          courseName: d.course.name,
          from,
        }
      }
    }

    // The strip follows the latest round this player actually played.
    lastRoundNumber = d.round.round_number
    lastThru = p.thru
    strip = {
      roundNumber: d.round.round_number,
      courseName: d.course.name,
      points: p.totalPoints,
      thru: p.thru,
      holesCounted: d.holesCounted,
      cells: Array.from({ length: d.holesCounted }, (_, i) => {
        const hole = i + 1
        const hr = p.holeResults.find((h) => h.holeNumber === hole)
        const pts = hr?.completed ? hr.points ?? 0 : null
        return {
          holeNumber: hole,
          points: pts,
          played: !!hr?.completed,
          pickedUp: !!hr?.pickedUp,
          eagle: pts !== null && pts >= 4,
        }
      }),
    }
  }

  if (holesPlayed === 0) return null

  return {
    holesPlayed,
    points,
    throughLabel: `through R${lastRoundNumber}, hole ${lastThru} · ${holesPlayed} holes`,
    bestRun,
    worstStretch,
    front,
    back,
    splitNote: splitNoteFor(front, back),
    splitLean: splitLeanFor(front, back),
    strip,
  }
}

/** Points per hole on a nine, to one decimal. */
function rate(nine: FormNine): number {
  return nine.holes === 0 ? 0 : Math.round((nine.points / nine.holes) * 10) / 10
}

/** Which nine is actually the better one, per hole. Null until both nines have enough holes. */
function splitLeanFor(front: FormNine, back: FormNine): 'front' | 'back' | 'even' | null {
  if (front.holes < MIN_NINE_HOLES || back.holes < MIN_NINE_HOLES) return null
  const diff = front.points / front.holes - back.points / back.holes
  if (Math.abs(diff) < 0.25) return 'even'
  return diff > 0 ? 'front' : 'back'
}

/**
 * The one-line read on the split — quotes the per-hole rate, because that is what the verdict is
 * based on and what makes unequal hole counts add up. No pronouns, same as the report and wire.
 */
function splitNoteFor(front: FormNine, back: FormNine): string | null {
  const lean = splitLeanFor(front, back)
  if (!lean) return null
  const f = rate(front).toFixed(1)
  const b = rate(back).toFixed(1)
  if (lean === 'even') return `Even either way — ${f} points a hole on the front, ${b} on the back.`
  return `${f} points a hole on the front, ${b} on the back.`
}
