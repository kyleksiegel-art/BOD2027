import { buildRoundDetail } from './compute'
import type { Db } from './compute'
import { compareBestRounds } from '@/lib/scoring'
import { formatOdds, ordinalOf } from '@/lib/format'

/**
 * Win probability: each player's chance to win the week, from simulating the rest of it.
 *
 * Every hole still to play is drawn from that player's own points-per-hole spread this week
 * (points already carry the strokes, so the low man and a 12-shot man are on the same scale),
 * shrunk toward a generic net-Stableford spread so two holes of form can't make anyone a lock.
 * Each simulated finish is settled the way the board is: total → best single round → holes won
 * outright; anything still level shares the win. The countback stage is skipped (it needs the
 * hole order of a tie that hasn't happened); in a simulation that is a rounding error.
 *
 * Pure and seeded, so the same scores always give the same numbers and nothing flickers on a
 * re-render. Every checkpoint of the history reruns with the same seed (common random numbers),
 * so a line moves because a hole was played, not because the dice changed.
 */

export const SIMS_NOW = 5_000
export const SIMS_HISTORY = 1_000

/** Generic per-hole net Stableford spread (0..5 points); the prior every player starts from. */
const PRIOR = [0.2, 0.3, 0.33, 0.13, 0.035, 0.005]
/** How many holes of the generic PRIOR the field's pooled spread is weighed against. */
const PRIOR_HOLES = 18
/** How many holes of the field's spread each player's own holes are weighed against. */
const FIELD_HOLES = 72
const MAX_POINTS = PRIOR.length - 1
const BUCKETS = 1024
const DRAW = -2
const PICKED_UP = -1
const SITTING_OUT = -3

export interface OddsRow {
  playerId: string
  name: string // first name
  colorIndex: number // sort-order slot, for the recap's player colours
  pct: number // 0..100, unrounded
  label: string // "58%" · "<1%" · ">99%" · "Out"
  delta: number | null // percentage points since the previous hole; null when there is no previous hole
  out: boolean // cannot reach the leader's current total even with a net albatross on every hole left
}

export interface WinOddsVM {
  rows: OddsRow[] // by chance, highest first
  holesLeft: number // most holes any player still has to play
  sinceLabel: string | null // "on the 13th" — what `delta` covers; null between rounds
  live: boolean
}

export interface OddsPoint {
  roundNumber: number
  hole: number // 0 = before the round's first hole
  pct: Record<string, number>
}

export interface OddsSwing {
  key: string
  label: string // "6th" · "R2 · 14th"
  text: string // "Kyle makes a net eagle, Chris takes a zero"
  playerId: string // the biggest mover on that hole
  move: number // signed percentage points
}

export interface OddsSeries {
  points: OddsPoint[]
  swings: OddsSwing[] // biggest three, biggest first
}

export interface OddsHistoryVM {
  players: { playerId: string; name: string; colorIndex: number; pct: number }[]
  round: (OddsSeries & { roundNumber: number; courseName: string }) | null
  week: OddsSeries & { roundBreaks: { roundNumber: number; courseName: string; index: number }[] }
}

// ── The model ────────────────────────────────────────────────────────────────

interface Cell {
  points: number // Stableford points (a pick-up is 0)
  winnable: boolean // a pick-up can never win a hole outright
}

interface RoundTrack {
  roundNumber: number
  courseName: string
  status: string
  holesCounted: number
  playing: boolean[] // by player index
  cells: (Cell | null)[][] // [player][hole - 1]; null = not played yet
}

interface Model {
  players: { playerId: string; name: string; colorIndex: number }[]
  rounds: RoundTrack[] // every non-abandoned round, in order
}

function buildModel(db: Db): Model | null {
  const sorted = db.players.slice().sort((a, b) => a.sort_order - b.sort_order)
  const players = sorted.map((p, i) => ({ playerId: p.id, name: p.name.split(/\s+/)[0], colorIndex: i }))
  const idx = new Map(players.map((p, i) => [p.playerId, i]))
  const rounds: RoundTrack[] = []
  for (const r of db.rounds.slice().sort((a, b) => a.round_number - b.round_number)) {
    if (r.status === 'abandoned') continue
    const course = db.courses.find((c) => c.id === r.course_id)
    const holesCounted = r.holes_counted ?? 18
    const rps = db.round_players.filter((rp) => rp.round_id === r.id)
    // A round nobody has been set up for yet is assumed to be all four, 18 holes.
    const playing = players.map((p) => {
      if (rps.length === 0) return true
      const rp = rps.find((x) => x.player_id === p.playerId)
      return rp?.status === 'playing'
    })
    const cells: (Cell | null)[][] = players.map(() => Array.from({ length: holesCounted }, () => null))
    if (r.status === 'final' || r.status === 'in_progress') {
      const detail = buildRoundDetail(r.round_number, db)
      for (const pr of detail?.players ?? []) {
        const i = idx.get(pr.playerId)
        if (i === undefined || pr.status !== 'playing') continue
        for (const hr of pr.holeResults) {
          if (!hr.completed || hr.holeNumber > holesCounted) continue
          cells[i][hr.holeNumber - 1] = { points: hr.points ?? 0, winnable: !hr.pickedUp }
        }
      }
    }
    rounds.push({ roundNumber: r.round_number, courseName: course?.name ?? `Round ${r.round_number}`, status: r.status, holesCounted, playing, cells })
  }
  if (players.length < 2 || rounds.length === 0) return null
  return { players, rounds }
}

/** Which stored holes a checkpoint is allowed to see: rounds before `roundNumber` whole, holes ≤ `hole` of it. */
type Reveal = { roundNumber: number; hole: number } | 'all'

function visible(reveal: Reveal, roundNumber: number, hole: number): boolean {
  if (reveal === 'all') return true
  return roundNumber < reveal.roundNumber || (roundNumber === reveal.roundNumber && hole <= reveal.hole)
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface SimResult {
  pct: number[] // by player index, 0..100
  out: boolean[]
  holesLeft: number
}

function simulate(model: Model, reveal: Reveal, sims: number): SimResult {
  const n = model.players.length
  const R = model.rounds.length

  // What is known at this checkpoint, and each player's spread built from only that.
  const knownTotal = new Array(n).fill(0)
  const knownRound: number[][] = model.players.map(() => new Array(R).fill(0))
  const counts: number[][] = model.players.map(() => new Array(MAX_POINTS + 1).fill(0))
  const knownWon = new Array(n).fill(0)
  // Holes with anything left to draw, flattened for the hot loop: per (hole, player) a code —
  // a known cell's points, PICKED_UP, SITTING_OUT, or DRAW.
  const codes: number[] = []
  const openRound: number[] = []
  const holesLeft = new Array(n).fill(0)

  model.rounds.forEach((rt, r) => {
    for (let h = 1; h <= rt.holesCounted; h++) {
      const row: number[] = []
      let anyOpen = false
      const inView = visible(reveal, rt.roundNumber, h)
      for (let i = 0; i < n; i++) {
        if (!rt.playing[i]) {
          row.push(SITTING_OUT)
          continue
        }
        const c = rt.cells[i][h - 1]
        if (c && inView) {
          knownTotal[i] += c.points
          knownRound[i][r] += c.points
          counts[i][Math.min(c.points, MAX_POINTS)]++
          row.push(c.winnable ? c.points : PICKED_UP)
        } else if (!inView || rt.status !== 'final') {
          anyOpen = true
          holesLeft[i]++
          row.push(DRAW)
        } else {
          // In view, a final round's missing cell is a hole that will never be played (0).
          row.push(SITTING_OUT)
        }
      }
      if (anyOpen) {
        codes.push(...row)
        openRound.push(r)
      } else {
        const w = holeWinner(row, 0, n)
        if (w >= 0) knownWon[w]++
      }
    }
  })

  // Each player's spread as a 1024-bucket lookup: one multiply per draw, no search. A player's
  // own holes are weighed against FIELD_HOLES of the field's pooled spread (itself pulled toward
  // the generic PRIOR), so the model leans on the handicaps: a hot two rounds moves a player's
  // numbers, it doesn't make a different golfer.
  const pooled = PRIOR.map((_, k) => counts.reduce((a, cs) => a + cs[k], 0))
  const pooledN = pooled.reduce((a, b) => a + b, 0)
  const field = PRIOR.map((p, k) => (pooled[k] + PRIOR_HOLES * p) / (pooledN + PRIOR_HOLES))
  const table = new Uint8Array(n * BUCKETS)
  counts.forEach((cs, i) => {
    const seen = cs.reduce((a, b) => a + b, 0)
    let acc = 0
    let k = 0
    const cdf = cs.map((c, j) => (acc += (c + FIELD_HOLES * field[j]) / (seen + FIELD_HOLES)))
    for (let b = 0; b < BUCKETS; b++) {
      while (k < MAX_POINTS && (b + 0.5) / BUCKETS >= cdf[k]) k++
      table[i * BUCKETS + b] = k
    }
  })

  const leaderNow = Math.max(...knownTotal)
  const out = knownTotal.map((t, i) => t + MAX_POINTS * holesLeft[i] < leaderNow)

  const wins = new Float64Array(n)
  const rand = mulberry32(0xb0d2027)
  const total = new Int32Array(n)
  const won = new Int32Array(n)
  const byRound = new Int32Array(n * R)
  const vals = new Int8Array(n)
  const holes = openRound.length
  const best = new Int32Array(n)
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) {
      total[i] = knownTotal[i]
      won[i] = knownWon[i]
      for (let r = 0; r < R; r++) byRound[i * R + r] = knownRound[i][r]
    }
    for (let k = 0; k < holes; k++) {
      const base = k * n
      for (let i = 0; i < n; i++) {
        const c = codes[base + i]
        if (c === DRAW) {
          const p = table[i * BUCKETS + ((rand() * BUCKETS) | 0)]
          total[i] += p
          byRound[i * R + openRound[k]] += p
          vals[i] = p
        } else vals[i] = c
      }
      const w = holeWinner(vals, 0, n)
      if (w >= 0) won[w]++
    }
    // Settle: total → best single round → holes won; still level shares the win.
    let nBest = 1
    best[0] = 0
    for (let i = 1; i < n; i++) {
      const b = best[0]
      let cmp = total[i] - total[b]
      if (cmp === 0) cmp = -compareBestRounds(Array.from(byRound.subarray(i * R, i * R + R)), Array.from(byRound.subarray(b * R, b * R + R))) || won[i] - won[b]
      if (cmp > 0) {
        best[0] = i
        nBest = 1
      } else if (cmp === 0) best[nBest++] = i
    }
    for (let j = 0; j < nBest; j++) wins[best[j]] += 1 / nBest
  }
  return {
    pct: Array.from(wins, (w) => (sims > 0 ? (100 * w) / sims : 0)),
    out,
    holesLeft: Math.max(0, ...holesLeft),
  }
}

/** Sole highest value in vals[from..from+n) wins the hole; codes below 0 can't. Index or -1. */
function holeWinner(vals: ArrayLike<number>, from: number, n: number): number {
  let best = -1
  let bestV = -1
  let level = false
  let eligible = 0
  for (let i = 0; i < n; i++) {
    const v = vals[from + i]
    if (v < 0) continue
    eligible++
    if (v > bestV) {
      bestV = v
      best = i
      level = false
    } else if (v === bestV) level = true
  }
  return eligible >= 2 && !level ? best : -1
}

// ── View models ──────────────────────────────────────────────────────────────

/** The round the odds follow hole by hole: the live one, else the latest final one. */
function focusRound(model: Model): RoundTrack | null {
  const live = model.rounds.find((r) => r.status === 'in_progress')
  if (live) return live
  const finals = model.rounds.filter((r) => r.status === 'final')
  return finals.length > 0 ? finals[finals.length - 1] : null
}

/** Furthest hole any playing player has saved in a round. */
function thruMax(rt: RoundTrack): number {
  let m = 0
  rt.cells.forEach((row, i) => {
    if (!rt.playing[i]) return
    row.forEach((c, h) => {
      if (c) m = Math.max(m, h + 1)
    })
  })
  return m
}

/** True while the week still has something to decide: a round has counted and one is still open. */
function hasOddsToShow(model: Model): boolean {
  const counting = model.rounds.some((r) => r.status === 'in_progress' || r.status === 'final')
  const open = model.rounds.some((r) => r.status === 'in_progress' || r.status === 'upcoming')
  return counting && open
}

export function buildWinOdds(db: Db): WinOddsVM | null {
  const model = buildModel(db)
  if (!model || !hasOddsToShow(model)) return null
  const now = simulate(model, 'all', SIMS_NOW)

  const live = model.rounds.find((r) => r.status === 'in_progress') ?? null
  const h = live ? thruMax(live) : 0
  const prev = live && h >= 1 ? simulate(model, { roundNumber: live.roundNumber, hole: h - 1 }, SIMS_NOW) : null

  const rows: OddsRow[] = model.players.map((p, i) => ({
    ...p,
    pct: now.pct[i],
    label: formatOdds(now.pct[i], now.out[i]),
    delta: prev ? Math.round(now.pct[i]) - Math.round(prev.pct[i]) : null,
    out: now.out[i],
  }))
  rows.sort((a, b) => b.pct - a.pct || a.colorIndex - b.colorIndex)
  return {
    rows,
    holesLeft: now.holesLeft,
    sinceLabel: prev ? `on the ${ordinalOf(h)}` : null,
    live: live !== null,
  }
}

const VERB = ['takes a zero', 'makes a net bogey', 'makes a net par', 'makes a net birdie', 'makes a net eagle', 'makes a net albatross']

function describeHole(model: Model, rt: RoundTrack, hole: number, gainer: number, loser: number | null): string {
  const say = (i: number) => {
    const c = rt.cells[i]?.[hole - 1]
    if (!c) return null
    const verb = !c.winnable ? 'picks up' : VERB[Math.min(c.points, MAX_POINTS)]
    return `${model.players[i].name} ${verb}`
  }
  const parts = [say(gainer), loser !== null ? say(loser) : null].filter((x): x is string => x !== null)
  return parts.length > 0 ? parts.join(', ') : `${model.players[gainer].name} moves on the others`
}

function series(model: Model, checkpoints: { rt: RoundTrack; hole: number }[], labelOf: (rt: RoundTrack, hole: number) => string): OddsSeries {
  const n = model.players.length
  const pcts = checkpoints.map(({ rt, hole }) => simulate(model, { roundNumber: rt.roundNumber, hole }, SIMS_HISTORY).pct)
  const points: OddsPoint[] = checkpoints.map(({ rt, hole }, k) => ({
    roundNumber: rt.roundNumber,
    hole,
    pct: Object.fromEntries(model.players.map((p, i) => [p.playerId, pcts[k][i]])),
  }))

  const steps: OddsSwing[] = []
  for (let k = 1; k < checkpoints.length; k++) {
    const { rt, hole } = checkpoints[k]
    if (hole === 0) continue // a round break, not a hole
    let gainer = 0
    let loser = 0
    for (let i = 1; i < n; i++) {
      if (pcts[k][i] - pcts[k - 1][i] > pcts[k][gainer] - pcts[k - 1][gainer]) gainer = i
      if (pcts[k][i] - pcts[k - 1][i] < pcts[k][loser] - pcts[k - 1][loser]) loser = i
    }
    const gain = pcts[k][gainer] - pcts[k - 1][gainer]
    const loss = pcts[k][loser] - pcts[k - 1][loser]
    const mover = gain >= -loss ? gainer : loser
    const move = Math.round(pcts[k][mover] - pcts[k - 1][mover])
    if (move === 0) continue
    const other = mover === gainer ? (loss <= -3 ? loser : null) : gain >= 3 ? gainer : null
    steps.push({
      key: `${rt.roundNumber}-${hole}`,
      label: labelOf(rt, hole),
      text: describeHole(model, rt, hole, mover, other),
      playerId: model.players[mover].playerId,
      move,
    })
  }
  steps.sort((a, b) => Math.abs(b.move) - Math.abs(a.move))
  return { points, swings: steps.slice(0, 3) }
}

export function buildOddsHistory(db: Db): OddsHistoryVM | null {
  const model = buildModel(db)
  if (!model || !hasOddsToShow(model)) return null
  const now = simulate(model, 'all', SIMS_NOW)

  const focus = focusRound(model)
  const roundCps = focus ? Array.from({ length: thruMax(focus) + 1 }, (_, hole) => ({ rt: focus, hole })) : []

  const weekCps: { rt: RoundTrack; hole: number }[] = []
  const roundBreaks: OddsHistoryVM['week']['roundBreaks'] = []
  for (const rt of model.rounds) {
    if (rt.status !== 'final' && rt.status !== 'in_progress') continue
    roundBreaks.push({ roundNumber: rt.roundNumber, courseName: rt.courseName, index: weekCps.length })
    const last = rt.status === 'final' ? rt.holesCounted : thruMax(rt)
    // Hole 0 of a later round is the same state as the end of the one before it.
    for (let hole = weekCps.length === 0 ? 0 : 1; hole <= last; hole++) weekCps.push({ rt, hole })
  }

  return {
    players: model.players.map((p, i) => ({ ...p, pct: now.pct[i] })),
    round:
      focus && roundCps.length > 1
        ? { roundNumber: focus.roundNumber, courseName: focus.courseName, ...series(model, roundCps, (_, h) => ordinalOf(h)) }
        : null,
    week: { ...series(model, weekCps, (rt, h) => `R${rt.roundNumber} · ${ordinalOf(h)}`), roundBreaks },
  }
}
