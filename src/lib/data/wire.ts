import { buildRoundDetail } from './compute'
import type { Db, PlayerRoundVM } from './compute'
import { formatClock } from '@/lib/format'

/**
 * The Field Report — a wire of plain-English events generated from saved scores, newest hole
 * first. Nothing is typed. Pure and offline-identical, like every other builder: rows in, a view
 * model out, all scoring via the same round detail the scorecard renders from.
 *
 * Follows the live round; between rounds it follows the most recent counting round so the wire
 * is never empty once the trip has started. Names only, never pronouns.
 */

export interface WireSeg {
  text: string
  strong?: boolean
}

export type WireKind = 'lead' | 'move' | 'score' | 'zero' | 'ctp' | 'field'

export interface WireEvent {
  key: string
  kind: WireKind
  playerId: string | null // null for a field-wide line
  colorIndex: number | null // stable identity slot (by sort order), as the recap's ribbon uses
  segs: WireSeg[] // "Denove birdies the 12th. Moves to 2nd, 3 back of Aronson."
  meta: string // "net birdie · 3 pts · position change"
  emphasis: boolean // a lead or position change — gets the leader-row treatment
  notability: number // higher = shown first within the hole
}

export interface WireHole {
  holeNumber: number
  par: number | null
  strokeIndex: number | null
  timeLabel: string | null // latest save on this hole, ET clock ("10:42"); null when unknown
  events: WireEvent[] // notability desc
}

export interface WirePlayer {
  playerId: string
  short: string
  colorIndex: number
}

export interface WireVM {
  roundNumber: number
  courseName: string
  dateIso: string
  live: boolean
  roundThru: number // furthest hole any playing player has completed
  holes: WireHole[] // newest first; only holes with at least one completed score
  latest: WireEvent | null // the top event of the newest hole — the Standings strip
  latestHole: number | null
  moreOnLatestHole: number // events on the newest hole beyond `latest`
  players: WirePlayer[]
}

const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth']

function lastName(name: string): string {
  const parts = name.split(/\s+/)
  return parts[parts.length - 1] || name
}
function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}
function ordinalOf(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}
const t = (text: string): WireSeg => ({ text })
const s = (text: string): WireSeg => ({ text, strong: true })

const NET_NAME: Record<number, string> = { 5: 'net albatross', 4: 'net eagle', 3: 'net birdie', 2: 'net par', 1: 'net bogey' }
const GROSS_VERB: Record<number, string> = { [-3]: 'makes an albatross on', [-2]: 'eagles', [-1]: 'birdies', 0: 'pars', 1: 'bogeys' }

/**
 * The verb phrase for one player's hole. Net achievements say "net" in the sentence itself:
 * nearly every birdie in a net game is a net birdie, and the big line must not read as a real
 * one. Plain golf verbs ("birdies") are kept for what the gross score actually was: a hole with
 * no stroke on it (gross is net), or a real gross birdie or better ("birdies the 7th for a net eagle").
 */
export function scoreVerb(points: number, pickedUp: boolean, hole: string, grossToPar: number | null, stroked: boolean): string {
  if (pickedUp) return `picks up on the ${hole}`
  if (points === 0) return `blanks the ${hole}`
  const gross = grossToPar === null ? null : Math.max(-3, grossToPar)
  if (gross !== null && gross < 0) {
    const verb = GROSS_VERB[gross]
    return stroked ? `${verb} the ${hole} for a ${NET_NAME[Math.min(5, points)]}` : `${verb} the ${hole}`
  }
  if (!stroked && gross !== null && gross <= 1) return `${GROSS_VERB[gross]} the ${hole}`
  return `makes a ${NET_NAME[Math.min(5, points)]} on the ${hole}`
}
/** "net birdie" — the points label for the meta line. */
function scoreLabel(points: number, pickedUp: boolean): string {
  if (pickedUp) return 'picked up'
  if (points >= 5) return 'net albatross'
  if (points === 4) return 'net eagle'
  if (points === 3) return 'net birdie'
  if (points === 2) return 'net par'
  if (points === 1) return 'net bogey'
  return 'net double or worse'
}
/** "Everyone makes a net par on the 11th." — the field-collapse line, net in the sentence. */
function fieldLine(points: number, hole: string, plainGross: number | null): string {
  if (plainGross !== null) return `Field ${GROSS_VERB[plainGross]} the ${hole}.` // no strokes, same gross: say what it was
  if (points === 0) return `Everyone blanks the ${hole}.`
  return `Everyone makes a ${NET_NAME[Math.min(5, points)]} on the ${hole}.`
}

/** The shared gross-to-par when nobody got a stroke and all made the same score (par/bogey range), else null. */
function plainFieldGross(done: { grossToPar: number | null; stroked: boolean }[]): number | null {
  const g = done[0]?.grossToPar ?? null
  if (g === null || g < -3 || g > 1) return null
  return done.every((d) => !d.stroked && d.grossToPar === g) ? g : null
}

/** Competition rank (ties share the higher place) by cumulative points, desc. */
function rankOf(cum: Map<string, number>, playing: PlayerRoundVM[]): Map<string, number> {
  const sorted = playing.slice().sort((a, b) => (cum.get(b.playerId) ?? 0) - (cum.get(a.playerId) ?? 0))
  const rank = new Map<string, number>()
  for (const p of sorted) {
    const pts = cum.get(p.playerId) ?? 0
    rank.set(p.playerId, sorted.findIndex((q) => (cum.get(q.playerId) ?? 0) === pts) + 1)
  }
  return rank
}

/** The round the wire follows: the live one, else the most recent counting round. */
function pickRound(dbData: Db): number | null {
  const rounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)
  const live = rounds.filter((r) => r.status === 'in_progress').pop()
  if (live) return live.round_number
  const final = rounds.filter((r) => r.status === 'final').pop()
  return final ? final.round_number : null
}

export function buildFieldReport(dbData: Db): WireVM | null {
  const roundNumber = pickRound(dbData)
  if (roundNumber === null) return null
  const detail = buildRoundDetail(roundNumber, dbData)
  if (!detail || !detail.holes || detail.course.data_is_placeholder) return null

  const playing = detail.players.filter((p) => p.status === 'playing')
  if (playing.length === 0) return null
  const roundThru = Math.max(0, ...playing.map((p) => p.thru))
  if (roundThru === 0) return null

  const live = detail.round.status === 'in_progress'
  const holeInfo = new Map(detail.holes.map((h) => [h.holeNumber, h]))

  // Stable identity colours keyed by sort order, exactly as the recap ribbon does.
  const colorRank = new Map(
    playing
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p, i) => [p.playerId, i]),
  )
  const players: WirePlayer[] = playing.map((p) => ({
    playerId: p.playerId,
    short: firstName(p.name),
    colorIndex: colorRank.get(p.playerId) ?? 0,
  }))

  // Latest save per hole, for the clock.
  const saveAt = new Map<number, string>()
  for (const sc of dbData.scores) {
    if (sc.round_id !== detail.round.id || !sc.client_updated_at_effective) continue
    const prev = saveAt.get(sc.hole_number)
    if (!prev || sc.client_updated_at_effective > prev) saveAt.set(sc.hole_number, sc.client_updated_at_effective)
  }
  const ctpByHole = new Map<number, string | null>()
  for (const c of dbData.ctp_results) if (c.round_id === detail.round.id) ctpByHole.set(c.hole_number, c.player_id)

  const nameOf = new Map(playing.map((p) => [p.playerId, p.name]))
  const cum = new Map<string, number>(playing.map((p) => [p.playerId, 0]))
  const zeros = new Map<string, number>(playing.map((p) => [p.playerId, 0]))
  const streak = new Map<string, number>(playing.map((p) => [p.playerId, 0]))
  let bestStreak = 0

  const holes: WireHole[] = []
  for (let hole = 1; hole <= Math.min(roundThru, detail.holesCounted); hole++) {
    const nth = ordinalOf(hole)
    const rankBefore = rankOf(cum, playing)
    const topBefore = Math.max(...playing.map((p) => cum.get(p.playerId) ?? 0))
    const leadersBefore = playing.filter((p) => (cum.get(p.playerId) ?? 0) === topBefore).map((p) => p.playerId)
    const secondBefore = Math.max(0, ...playing.map((p) => cum.get(p.playerId) ?? 0).filter((v) => v < topBefore))
    const marginBefore = topBefore - secondBefore
    // Until someone separates, nobody "leads" — the first birdie takes the lead, it doesn't break a tie.
    const noLeaderBefore = leadersBefore.length === playing.length

    // Apply the hole.
    const runBefore = new Map(streak)
    const done: { p: PlayerRoundVM; points: number; pickedUp: boolean; grossToPar: number | null; stroked: boolean }[] = []
    for (const p of playing) {
      const hr = p.holeResults.find((h) => h.holeNumber === hole)
      if (!hr?.completed) continue
      const points = hr.points ?? 0
      done.push({
        p,
        points,
        pickedUp: hr.pickedUp,
        grossToPar: hr.grossStrokes === null ? null : hr.grossStrokes - hr.par,
        stroked: hr.strokesReceived !== 0,
      })
      cum.set(p.playerId, (cum.get(p.playerId) ?? 0) + points)
      if (points === 0) zeros.set(p.playerId, (zeros.get(p.playerId) ?? 0) + 1)
      const run = points > 0 ? (streak.get(p.playerId) ?? 0) + 1 : 0
      streak.set(p.playerId, run)
    }
    if (done.length === 0) continue

    const rankAfter = rankOf(cum, playing)
    const topAfter = Math.max(...playing.map((p) => cum.get(p.playerId) ?? 0))
    const leadersAfter = playing.filter((p) => (cum.get(p.playerId) ?? 0) === topAfter).map((p) => p.playerId)
    const secondAfter = Math.max(0, ...playing.map((p) => cum.get(p.playerId) ?? 0).filter((v) => v < topAfter))
    const margin = topAfter - secondAfter
    const leaderName = leadersAfter.length === 1 ? lastName(nameOf.get(leadersAfter[0]) ?? '') : null
    const anyMove = done.some(({ p }) => rankBefore.get(p.playerId) !== rankAfter.get(p.playerId))

    const events: WireEvent[] = []

    // Field collapse: everyone in, same points, nobody moved.
    const allIn = done.length === playing.length && hole > 1
    if (allIn && !anyMove && done.every((d) => d.points === done[0].points && !d.pickedUp)) {
      events.push({
        key: `${hole}-field`,
        kind: 'field',
        playerId: null,
        colorIndex: null,
        segs: [t(`${fieldLine(done[0].points, nth, plainFieldGross(done))} No movement.`)],
        meta: `${done[0].points} ${done[0].points === 1 ? 'pt' : 'pts'} each`,
        emphasis: false,
        notability: 1,
      })
    } else {
      for (const { p, points, pickedUp, grossToPar, stroked } of done) {
        const last = lastName(p.name)
        const before = rankBefore.get(p.playerId) ?? 1
        const after = rankAfter.get(p.playerId) ?? 1
        const wasLeader = leadersBefore.includes(p.playerId)
        const isLeader = leadersAfter.includes(p.playerId)
        const gap = topAfter - (cum.get(p.playerId) ?? 0)
        const segs: WireSeg[] = [s(last), t(` ${scoreVerb(points, pickedUp, nth, grossToPar, stroked)}.`)]
        const metaBits = [scoreLabel(points, pickedUp), `${points} ${points === 1 ? 'pt' : 'pts'}`]
        let kind: WireKind = points === 0 ? 'zero' : 'score'
        let notability = points >= 4 ? 4 : points === 3 ? 2 : points === 0 ? 2 : 1
        let emphasis = false

        const soleBefore = wasLeader && leadersBefore.length === 1
        const tiedBefore = wasLeader && !soleBefore && !noLeaderBefore
        const soleAfter = isLeader && leadersAfter.length === 1
        const where = `${ordinalOf(after)}${gap > 0 ? `, ${gap} back` : ''}${leaderName && !isLeader ? ` of ${leaderName}` : ''}`
        // Taking the lead outranks losing it on the same hole (6 vs 5), so the new leader reads first.
        const lead = (text: string, rank = 5) => {
          segs.push(t(` ${text}`))
          kind = 'lead'
          notability = rank
          emphasis = true
          metaBits.push('lead change')
        }
        const move = (text: string) => {
          segs.push(t(` ${text}`))
          kind = 'move'
          notability = 4
          emphasis = true
          metaBits.push('position change')
        }
        if (hole > 1) {
          if (isLeader && (!wasLeader || noLeaderBefore)) {
            lead(soleAfter ? (margin > 0 ? `Takes the lead by ${margin}.` : 'Takes the lead.') : 'Ties for the lead.', 6)
          } else if (tiedBefore && soleAfter) {
            lead(`Breaks the tie, leads by ${margin}.`, 6)
          } else if (soleBefore && isLeader && !soleAfter) {
            lead('Caught. Tied for the lead.')
          } else if (soleBefore && !isLeader) {
            lead(`Drops to ${where}.`)
          } else if (after !== before) {
            move(`${after < before ? 'Moves' : 'Slips'} to ${where}.`)
          } else if (soleBefore && soleAfter) {
            segs.push(t(margin > marginBefore ? ` Lead grows to ${margin}.` : margin < marginBefore ? ` Lead cut to ${margin}.` : ` Lead holds at ${margin}.`))
          }
        }

        const run = streak.get(p.playerId) ?? 0
        const prevRun = points > 0 ? run - 1 : runBefore.get(p.playerId) ?? 0
        if (run > bestStreak) bestStreak = run
        if (run >= 5 && (run - 5) % 4 === 0) {
          segs.push(t(` ${run} straight holes with points${run === bestStreak ? ', longest of the round' : ''}.`))
          metaBits.push('streak')
          notability = Math.max(notability, 3)
        } else if (points === 0 && prevRun >= 5) {
          segs.push(t(` Ends a run of ${prevRun} holes with points.`))
          metaBits.push('streak over')
          notability = Math.max(notability, 3)
        } else if (points === 0) {
          const z = zeros.get(p.playerId) ?? 0
          segs.push(t(` ${(ORDINAL_WORDS[z - 1] ?? ordinalOf(z)).replace(/^./, (c) => c.toUpperCase())} zero of the round.`))
        }

        events.push({
          key: `${hole}-${p.playerId}`,
          kind,
          playerId: p.playerId,
          colorIndex: colorRank.get(p.playerId) ?? 0,
          segs,
          meta: metaBits.join(' · '),
          emphasis,
          notability,
        })
      }
    }

    // Closest to pin, when recorded with a winner.
    const info = holeInfo.get(hole)
    const ctp = ctpByHole.get(hole)
    if (info?.par === 3 && ctp) {
      const winner = nameOf.get(ctp)
      if (winner) {
        events.push({
          key: `${hole}-ctp`,
          kind: 'ctp',
          playerId: ctp,
          colorIndex: colorRank.get(ctp) ?? 0,
          segs: [s(lastName(winner)), t(` takes closest to pin on the ${nth}.`)],
          meta: 'closest to pin',
          emphasis: false,
          notability: 3,
        })
      }
    }

    events.sort((a, b) => b.notability - a.notability)
    const at = saveAt.get(hole)
    holes.push({
      holeNumber: hole,
      par: info?.par ?? null,
      strokeIndex: info?.strokeIndex ?? null,
      timeLabel: at ? formatClock(at) : null,
      events,
    })
  }

  holes.reverse()
  const newest = holes[0] ?? null
  return {
    roundNumber,
    courseName: detail.course.name,
    dateIso: detail.round.date,
    live,
    roundThru,
    holes,
    latest: newest?.events[0] ?? null,
    latestHole: newest?.holeNumber ?? null,
    moreOnLatestHole: newest ? Math.max(0, newest.events.length - 1) : 0,
    players,
  }
}
