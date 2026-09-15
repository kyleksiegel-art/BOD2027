// The strokes card — "how many do I get tomorrow, and on which holes" — as a shareable
// picture. Pure, same rule as every builder: rows in, view model out, no React, no network.
//
// The card follows the NEXT round: the lowest-numbered round that is `in_progress` or
// `upcoming` (in progress first — the morning of, the round may already be started and the
// strokes are still the thing to know). Once every round is final there is no card. Strokes
// come from `buildRoundDetail`, so the figure and the hole allocation are exactly what the
// scorecard will use: own playing handicap minus the field's low man, then by stroke index.
import { allocateStrokes } from '@/lib/scoring'
import { buildRoundDetail, buildStandings } from './compute'
import type { Db, RoundDetailVM } from './compute'
import { courseSlug, formatDay, formatPosition, formatStandingBack, formatTeeTime } from '@/lib/format'

export interface StrokesCardVM {
  playerId: string
  name: string
  roundNumber: number
  courseName: string
  courseSlug: 'red' | 'black' | 'blue' | 'bone' | null
  dayLabel: string // "Sat, Feb 6"
  teeTime: string | null // "8:40 AM ET"
  teeName: string
  par: number
  /** Strokes actually received today: own playing handicap minus the low man's (≥ 0). */
  strokesToday: number
  /** The holes a stroke lands on, ascending. A hole may repeat when strokes exceed 18. */
  strokeHoles: number[]
  /** Strokes per hole, index 0 = hole 1. Empty when the course card is a placeholder. */
  strokesByHole: number[]
  /** The low man (scratch today) — null when this player is the low man or is level with them. */
  lowMan: { name: string; firstName: string } | null
  isLowMan: boolean
  handicap: {
    index: number
    courseHandicap: number // unrounded, shown to one decimal
    playingHandicap: number // own, post cap/override
    lowStrokes: number // subtracted from everyone
  }
  /** Where the player stands in the week, or null before any round has counted. */
  week: { positionLabel: string; total: number; backLabel: string; note: string } | null
}

export function nextRoundNumber(dbData: Db): number | null {
  const live = dbData.rounds.filter((r) => r.status === 'in_progress').sort((a, b) => a.round_number - b.round_number)
  if (live.length > 0) return live[0].round_number
  const up = dbData.rounds.filter((r) => r.status === 'upcoming').sort((a, b) => a.round_number - b.round_number)
  return up.length > 0 ? up[0].round_number : null
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] ?? name
}

/** One card per playing player of the next round, keyed by player id. Empty when no round is next. */
export function buildStrokesCards(dbData: Db): Map<string, StrokesCardVM> {
  const out = new Map<string, StrokesCardVM>()
  const n = nextRoundNumber(dbData)
  if (n === null) return out
  const detail = buildRoundDetail(n, dbData)
  if (!detail) return out

  const standings = buildStandings(dbData)
  const nameById = new Map(dbData.players.map((p) => [p.id, p.name]))

  for (const p of detail.players) {
    if (p.status !== 'playing' || !p.worksheet) continue
    const vm = cardFor(detail, p.playerId, standings, nameById)
    if (vm) out.set(p.playerId, vm)
  }
  return out
}

function cardFor(
  detail: RoundDetailVM,
  playerId: string,
  standings: ReturnType<typeof buildStandings>,
  nameById: Map<string, string>,
): StrokesCardVM | null {
  const p = detail.players.find((x) => x.playerId === playerId)
  if (!p || !p.worksheet) return null
  const ws = p.worksheet

  const strokesByHole: number[] = []
  const strokeHoles: number[] = []
  if (detail.holes) {
    const alloc = allocateStrokes(ws.strokesReceivedFinal, detail.holes)
    for (let h = 1; h <= 18; h++) {
      const s = alloc.get(h) ?? 0
      strokesByHole.push(s)
      for (let i = 0; i < s; i++) strokeHoles.push(h)
    }
  }

  // The low man: the first playing player (by sort order) whose own strokes equal the field
  // low. If that is this player, the card says "plays scratch" instead of naming someone.
  const playing = detail.players.filter((x) => x.status === 'playing' && x.worksheet)
  const low = playing.find((x) => x.worksheet!.ownStrokes === ws.fieldLowest)
  const isLowMan = ws.ownStrokes === ws.fieldLowest
  const lowMan =
    !isLowMan && low ? { name: low.name, firstName: firstName(low.name) } : null

  let week: StrokesCardVM['week'] = null
  if (standings.hasCountingRound) {
    const row = standings.rows.find((r) => r.playerId === playerId)
    if (row) {
      const others = standings.rows
        .filter((r) => r.playerId !== playerId)
        .map((r) => `${lastName(nameById.get(r.playerId) ?? r.name)} ${r.total}`)
        .join(' · ')
      week = {
        positionLabel: formatPosition(row.position, row.tie),
        total: row.total,
        backLabel: formatStandingBack(row.position, row.gapToLeader),
        note: others,
      }
    }
  }

  return {
    playerId,
    name: p.name,
    roundNumber: detail.round.round_number,
    courseName: detail.course.name,
    courseSlug: courseSlug(detail.course.name),
    dayLabel: formatDay(detail.round.date),
    teeTime: formatTeeTime(detail.round.tee_time),
    teeName: p.teeName,
    par: detail.holes ? detail.holes.reduce((s, h) => s + h.par, 0) : ws.result.par,
    strokesToday: ws.strokesReceivedFinal,
    strokeHoles,
    strokesByHole,
    lowMan,
    isLowMan,
    handicap: {
      index: ws.result.index,
      courseHandicap: ws.result.courseHandicapUnrounded,
      playingHandicap: ws.ownStrokes,
      lowStrokes: ws.fieldLowest,
    },
    week,
  }
}

/** File name for the PNG: `bod2027-r3-black-strokes-jon.png`. */
export function strokesCardFilename(vm: StrokesCardVM, variant: 'card' | 'lockscreen' = 'card'): string {
  const who = firstName(vm.name).toLowerCase().replace(/[^a-z0-9]+/g, '')
  const course = vm.courseSlug ?? 'round'
  return `bod2027-r${vm.roundNumber}-${course}-strokes-${who}${variant === 'lockscreen' ? '-lockscreen' : ''}.png`
}
