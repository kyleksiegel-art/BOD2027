// Phase 7 — the money ledger, assembled purely from Dexie rows. Like compute.ts this is
// React-free and network-free, so it runs identically online or off, and every dollar figure
// derives at compute time from `settings` + the rounds' par-3 counts (brief §Money: "Pot
// values derive from settings ... changing the model doesn't leave historical rows
// inconsistent"). The frozen `round_money` snapshot written at finalization is a verification
// mirror of this derivation, not its source — a one-cent disagreement between the two is a bug.
//
// All arithmetic is INTEGER CENTS; rounding happens only at display. The pot splits and the
// greedy settlement come from the already-tested pure engine in src/lib/scoring/money.ts; the
// championship / round-winner / CTP-carry orchestration lives here.
import {
  computePurse,
  settle,
  tallyHolesWon,
  compareCountback,
  allocateEvenCents,
  type MoneyRound,
  type PurseConfig,
  type PurseMode,
  type Transfer,
  type NetBalance,
  type CountbackContext,
  type CountbackRound,
  type HoleNetCell,
  type RoundStatus,
} from '@/lib/scoring'
import { buildRoundDetail, buildStandings, buildChampionships, type Db, type RoundDetailVM } from './compute'
import type { RoundRow, SettingRow } from './types'

// ── Settings → PurseConfig ────────────────────────────────────────────────────

export type CtpCarryMode = 'carry' | 'void'

function settingValue<T>(settings: SettingRow[], key: string, fallback: T): T {
  const row = settings.find((s) => s.key === key)
  return row === undefined || row.value === null ? fallback : (row.value as T)
}

export function purseConfigOf(dbData: Db): PurseConfig {
  const s = dbData.settings
  const mode = settingValue<PurseMode>(s, 'purse_mode', 'buyin')
  const weights = settingValue(s, 'purse_weights', {
    championship: 0.4,
    roundWinners: 0.3,
    ctp: 0.3,
  })
  const amounts = settingValue<{ buy_in_per_player_cents?: number; fixed_cents?: Record<string, number> }>(
    s,
    'purse_amounts',
    {},
  )
  const playerCount = dbData.players.length

  if (mode === 'buyin') {
    return {
      mode,
      weights,
      buyInPerPlayerCents: amounts.buy_in_per_player_cents ?? 0,
      playerCount,
    }
  }
  const fixed = amounts.fixed_cents ?? {}
  return {
    mode,
    weights,
    fixedCents: {
      championship: fixed.championship ?? 0,
      roundWinners: fixed.roundWinners ?? 0,
      ctp: fixed.ctp ?? 0,
    },
  }
}

// ── View models ───────────────────────────────────────────────────────────────

export type CtpHoleStatus = 'won' | 'carry' | 'void' | 'pending'

export interface CtpHoleVM {
  holeNumber: number
  /** This hole's base CTP slice (before any carry-in). */
  baseCents: number
  /** Cents carried in from earlier unclaimed par 3s in this round. */
  carriedInCents: number
  /** The pot actually decided on this hole: base + carry when won or voided. */
  potCents: number
  winnerId: string | null
  winnerName: string | null
  distanceFeet: number | null
  status: CtpHoleStatus
}

export interface WinnerVM {
  playerIds: string[] // >1 only when a countback couldn't separate co-winners
  names: string[]
  points: number
}

export interface RoundMoneyVM {
  roundNumber: number
  courseName: string
  status: RoundStatus
  counts: boolean // a counting round reserves a share (everything but abandoned)
  par3Count: number
  championshipShareCents: number // this round's slice of the championship pot (additive)
  roundPurseCents: number // this round's round-winner slice
  ctpPotCents: number // this round's CTP pot
  ctpPerHole: CtpHoleVM[]
  roundWinner: WinnerVM | null // resolved winner(s), or null if not yet decided
  frozen: boolean // the round is final — the server has frozen these figures
}

export interface PlayerMoneyVM {
  playerId: string
  name: string
  sortOrder: number
  buyInCents: number
  championshipCents: number
  roundWinningsCents: number
  ctpWinningsCents: number
  refundCents: number // returned share of voided CTP pots
  winningsCents: number // championship + round + ctp + refund
  netCents: number // winnings − buy-in
}

export interface ReconciliationVM {
  totalInCents: number // buy-ins collected
  awardedCents: number // paid out so far
  pendingCents: number // reserved for rounds/holes not yet decided
  balanced: boolean // awarded + pending === totalIn (a structural tripwire)
}

export interface MoneyVM {
  mode: PurseMode
  carryMode: CtpCarryMode
  championshipTotalCents: number
  roundWinnersTotalCents: number
  ctpTotalCents: number
  totalPotCents: number
  rounds: RoundMoneyVM[]
  players: PlayerMoneyVM[]
  championSet: WinnerVM | null // current overall leader(s) taking the championship pot
  transfers: Transfer[] // greedy settlement — only when fully settled (no pending) in buy-in mode
  settleable: boolean // true once every counting round is final (transfers are final)
  reconciliation: ReconciliationVM | null // buy-in mode only
  hasMoney: boolean
}

// ── Countback / holes-won helpers (reuse the tested engine primitives) ──────────

/** A round counts toward the money once it is in play and stays counting unless abandoned. */
function isCounting(status: RoundStatus): boolean {
  return status !== 'abandoned' && status !== 'upcoming'
}

function countbackContext(details: Map<number, RoundDetailVM>, roundOrder: readonly number[]): CountbackContext {
  const rounds = new Map<number, CountbackRound>()
  for (const [rn, d] of details) {
    if (!d.holes) continue
    const pph = new Map<string, Map<number, number>>()
    for (const p of d.players) {
      if (p.status !== 'playing') continue
      const m = new Map<number, number>()
      for (const hr of p.holeResults) m.set(hr.holeNumber, hr.points ?? 0)
      pph.set(p.playerId, m)
    }
    rounds.set(rn, {
      roundNumber: rn,
      status: d.round.status as RoundStatus,
      holesCounted: d.holesCounted,
      pointsByPlayerHole: pph,
    })
  }
  return { rounds, roundOrder }
}

/** The subset of `candidates` that a countback cannot separate from the leader. */
function tiedAtTopByCountback(candidates: string[], ctx: CountbackContext): string[] {
  if (candidates.length <= 1) return candidates
  const order = [...candidates].sort((a, b) => compareCountback(a, b, ctx).cmp)
  const top = order[0]
  return order.filter((id) => id === top || compareCountback(top, id, ctx).cmp === 0)
}

// ── Round winner ────────────────────────────────────────────────────────────

/**
 * Resolve one round's winner from its leaderboard: top points, ties broken by a countback on
 * that round (brief §Round-level tiebreaker), and a genuinely unbreakable tie splits the round
 * purse. Returns null when nobody has scored yet (nothing to award).
 */
export function resolveRoundWinner(detail: RoundDetailVM): WinnerVM | null {
  if (!detail.holes) return null
  const lb = detail.leaderboard
  if (lb.length === 0 || lb[0].totalPoints <= 0) return null
  const top = lb[0].totalPoints
  let tiedIds = lb.filter((p) => p.totalPoints === top).map((p) => p.playerId)

  if (tiedIds.length > 1) {
    const rn = detail.round.round_number
    const ctx = countbackContext(new Map([[rn, detail]]), [rn])
    tiedIds = tiedAtTopByCountback(tiedIds, ctx)
  }

  const nameById = new Map(lb.map((p) => [p.playerId, p.name]))
  return { playerIds: tiedIds, names: tiedIds.map((id) => nameById.get(id) ?? 'Player'), points: top }
}

// ── Overall champion ──────────────────────────────────────────────────────────

/**
 * Resolve the overall championship winner(s) among the point-leaders, walking the brief's
 * tiebreak chain: best single round, then most holes won outright, then countback in the
 * preference order, then a declared tie (co-champions split). Reuses the engine's
 * tallyHolesWon / compareCountback so the money page and the standings page agree.
 */
function resolveChampion(dbData: Db, details: Map<number, RoundDetailVM>): WinnerVM | null {
  const standings = buildStandings(dbData)
  const leaders = standings.rows.filter((r) => r.position === 1).map((r) => r.playerId)
  const total = standings.rows.length > 0 ? standings.rows[0].total : 0
  if (leaders.length === 0 || total <= 0) return null

  const nameById = new Map(dbData.players.map((p) => [p.id, p.name]))
  const asWinner = (ids: string[]): WinnerVM => ({
    playerIds: ids,
    names: ids.map((id) => nameById.get(id) ?? 'Player'),
    points: total,
  })

  if (leaders.length === 1) return asWinner(leaders)

  // Step 1 — best single round: compare each candidate's counting-round points, sorted
  // descending, lexicographically. Keep those tied at the best.
  const champs = buildChampionships(dbData)
  const byPlayer = new Map(champs.map((c) => [c.playerId, c.byRound]))
  const sortedPoints = (id: string): number[] =>
    (byPlayer.get(id) ?? [])
      .filter((e) => e.counts)
      .map((e) => e.points)
      .sort((a, b) => b - a)
  const cmpArrays = (a: number[], b: number[]): number => {
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      const d = (b[i] ?? 0) - (a[i] ?? 0) // higher points ranks first
      if (d !== 0) return d
    }
    return 0
  }
  let cand = [...leaders]
  const best = cand.reduce((acc, id) => (cmpArrays(sortedPoints(id), sortedPoints(acc)) < 0 ? id : acc), cand[0])
  cand = cand.filter((id) => cmpArrays(sortedPoints(id), sortedPoints(best)) === 0)
  if (cand.length === 1) return asWinner(cand)

  // Step 2 — most holes won outright across the counting rounds.
  const holeCells: HoleNetCell[][] = []
  for (const d of details.values()) {
    if (!d.holes || !isCounting(d.round.status as RoundStatus)) continue
    const playing = d.players.filter((p) => p.status === 'playing')
    for (let h = 1; h <= d.holesCounted; h++) {
      holeCells.push(
        playing.map((p) => {
          const hr = p.holeResults.find((r) => r.holeNumber === h)
          return { playerId: p.playerId, net: hr?.net ?? null, completed: hr?.completed ?? false }
        }),
      )
    }
  }
  const won = tallyHolesWon(holeCells)
  const maxWon = Math.max(...cand.map((id) => won.get(id) ?? 0))
  const afterHoles = cand.filter((id) => (won.get(id) ?? 0) === maxWon)
  if (afterHoles.length === 1) return asWinner(afterHoles)
  cand = afterHoles

  // Step 3 — countback in the preference order; whatever it can't separate splits (step 4).
  const ctx = countbackContext(details, [3, 4, 2, 1])
  return asWinner(tiedAtTopByCountback(cand, ctx))
}

// ── The whole ledger ────────────────────────────────────────────────────────

export function buildMoney(dbData: Db): MoneyVM {
  const config = purseConfigOf(dbData)
  const carryMode = settingValue<CtpCarryMode>(dbData.settings, 'ctp_carry_mode', 'carry')
  const playerCount = dbData.players.length

  const coursesById = new Map(dbData.courses.map((c) => [c.id, c]))
  const orderedRounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)

  // Par-3 count per round comes from the course's holes (0 while a card is placeholder).
  const par3CountOf = (round: RoundRow): number =>
    dbData.holes.filter((h) => h.course_id === round.course_id && h.par === 3).length

  // The pot split: every non-abandoned round reserves an even share of the round-winner pot
  // and a par-3-proportional share of the CTP pot (src/lib/scoring/money.ts).
  const moneyRounds: MoneyRound[] = orderedRounds.map((r) => ({
    roundNumber: r.round_number,
    par3Count: par3CountOf(r),
    abandoned: r.status === 'abandoned',
  }))
  const purse = computePurse(config, moneyRounds)

  // Build each in-play round's detail once — reused for winners, countback and holes-won.
  const details = new Map<number, RoundDetailVM>()
  for (const r of orderedRounds) {
    if (!isCounting(r.status as RoundStatus)) continue
    const d = buildRoundDetail(r.round_number, dbData)
    if (d) details.set(r.round_number, d)
  }

  // Per-player accumulators.
  const nameById = new Map(dbData.players.map((p) => [p.id, p]))
  const buyInPerPlayer = config.mode === 'buyin' ? config.buyInPerPlayerCents ?? 0 : 0
  const acc = new Map<
    string,
    { championship: number; round: number; ctp: number; refund: number }
  >()
  for (const p of dbData.players) acc.set(p.id, { championship: 0, round: 0, ctp: 0, refund: 0 })

  const contributors = dbData.players.map((p) => p.id) // everyone who bought in / is in the pot
  const refundEvenly = (cents: number) => {
    if (cents <= 0 || contributors.length === 0) return
    const parts = allocateEvenCents(cents, contributors.length)
    contributors.forEach((id, i) => {
      const a = acc.get(id)
      if (a) a.refund += parts[i] ?? 0
    })
  }

  let pendingCents = 0

  // ── Per-round money view + payouts ──
  const ctpByRoundHole = new Map<string, { playerId: string | null }>()
  for (const c of dbData.ctp_results) ctpByRoundHole.set(`${c.round_id}|${c.hole_number}`, { playerId: c.player_id })
  const ctpDistanceByRoundHole = new Map<string, number | null>()
  for (const c of dbData.ctp_results) ctpDistanceByRoundHole.set(`${c.round_id}|${c.hole_number}`, c.distance_feet)

  const rounds: RoundMoneyVM[] = orderedRounds.map((round) => {
    const course = coursesById.get(round.course_id)
    const status = round.status as RoundStatus
    const counts = round.status !== 'abandoned'
    const chShare = perRoundChampionshipShare(purse, moneyRounds, round.round_number)
    const roundPurse = purse.perRoundWinnerCents.get(round.round_number) ?? 0
    const ctpPot = purse.perRoundCtpCents.get(round.round_number) ?? 0
    const perHole = purse.perRoundCtpPerHoleCents.get(round.round_number) ?? []
    const detail = details.get(round.round_number)

    // Round winner + round purse payout.
    let roundWinner: WinnerVM | null = null
    if (detail) roundWinner = resolveRoundWinner(detail)
    if (roundWinner && roundPurse > 0) {
      awardEvenly(acc, orderByStanding(roundWinner.playerIds, dbData), roundPurse, 'round')
    } else if (counts && roundPurse > 0) {
      pendingCents += roundPurse // reserved but not yet won
    }

    // CTP: walk this round's PLAYED par 3s in order, carrying an unclaimed pot forward. A
    // shortened round can leave a par 3 past its cutoff (Black's hole 17 when only 15 count):
    // that hole can never be won, so its slice folds into the last played par 3's pot rather
    // than vanishing — keeping every played par 3 worth the same and the ledger whole.
    const holesCounted = detail?.holesCounted ?? 18
    const allPar3s = detail?.holes ? detail.holes.filter((h) => h.par === 3).map((h) => h.holeNumber) : []
    const par3Holes: number[] = []
    const bases: number[] = []
    let orphanCents = 0
    allPar3s.forEach((hole, i) => {
      if (hole <= holesCounted) {
        par3Holes.push(hole)
        bases.push(perHole[i] ?? 0)
      } else {
        orphanCents += perHole[i] ?? 0
      }
    })
    if (bases.length > 0) bases[bases.length - 1] += orphanCents

    const roundFinal = status === 'final'
    const ctpPerHole: CtpHoleVM[] = []
    let carry = 0
    let resolvedSoFar = true
    // No played par 3s but a CTP pot exists (all cut off): return it (final) or hold it pending.
    if (par3Holes.length === 0 && ctpPot > 0) {
      if (roundFinal) refundEvenly(ctpPot)
      else pendingCents += ctpPot
    }
    par3Holes.forEach((hole, i) => {
      const base = bases[i] ?? 0
      const isLast = i === par3Holes.length - 1
      const key = `${round.id}|${hole}`
      const rec = ctpByRoundHole.get(key)
      const winnerId = rec?.playerId ?? null
      const distance = ctpDistanceByRoundHole.get(key) ?? null

      if (!resolvedSoFar) {
        ctpPerHole.push({ holeNumber: hole, baseCents: base, carriedInCents: 0, potCents: base, winnerId: null, winnerName: null, distanceFeet: distance, status: 'pending' })
        pendingCents += base
        return
      }

      if (winnerId) {
        const pot = base + carry
        carry = 0
        const a = acc.get(winnerId)
        if (a) a.ctp += pot
        ctpPerHole.push({
          holeNumber: hole,
          baseCents: base,
          carriedInCents: pot - base,
          potCents: pot,
          winnerId,
          winnerName: nameById.get(winnerId)?.name ?? 'Player',
          distanceFeet: distance,
          status: 'won',
        })
        return
      }

      // No winner on this hole. An explicit no-winner row, or a final round with no entry,
      // resolves it now; otherwise it is still pending.
      const explicitNoWinner = rec !== undefined && rec.playerId === null
      if (explicitNoWinner || roundFinal) {
        if (carryMode === 'carry' && !isLast) {
          carry += base
          ctpPerHole.push({ holeNumber: hole, baseCents: base, carriedInCents: 0, potCents: base, winnerId: null, winnerName: null, distanceFeet: distance, status: 'carry' })
        } else {
          // Void, or the last par 3 with an unclaimed pot: returned to contributors.
          const pot = base + carry
          refundEvenly(pot)
          carry = 0
          ctpPerHole.push({ holeNumber: hole, baseCents: base, carriedInCents: pot - base, potCents: pot, winnerId: null, winnerName: null, distanceFeet: distance, status: 'void' })
        }
        return
      }

      // Pending: unknown outcome, stop carrying past it.
      resolvedSoFar = false
      const pot = base + carry
      carry = 0
      ctpPerHole.push({ holeNumber: hole, baseCents: base, carriedInCents: pot - base, potCents: pot, winnerId: null, winnerName: null, distanceFeet: distance, status: 'pending' })
      pendingCents += pot
    })

    return {
      roundNumber: round.round_number,
      courseName: course?.name ?? 'Course',
      status,
      counts,
      par3Count: par3CountOf(round),
      championshipShareCents: chShare,
      roundPurseCents: roundPurse,
      ctpPotCents: ctpPot,
      ctpPerHole,
      roundWinner,
      frozen: status === 'final',
    }
  })

  // ── Championship pot ──
  const championSet = resolveChampion(dbData, details)
  const championshipTotal = purse.championshipCents
  if (championSet && championshipTotal > 0) {
    // Remainder cents to the better single round: order the champion set by best single round.
    awardEvenly(acc, orderByStanding(championSet.playerIds, dbData), championshipTotal, 'championship')
  } else if (championshipTotal > 0) {
    pendingCents += championshipTotal
  }

  // ── Per-player rows ──
  const players: PlayerMoneyVM[] = dbData.players
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => {
      const a = acc.get(p.id) ?? { championship: 0, round: 0, ctp: 0, refund: 0 }
      const winnings = a.championship + a.round + a.ctp + a.refund
      return {
        playerId: p.id,
        name: p.name,
        sortOrder: p.sort_order,
        buyInCents: buyInPerPlayer,
        championshipCents: a.championship,
        roundWinningsCents: a.round,
        ctpWinningsCents: a.ctp,
        refundCents: a.refund,
        winningsCents: winnings,
        netCents: winnings - buyInPerPlayer,
      }
    })

  // ── Settlement + reconciliation (buy-in mode) ──
  const settleable = orderedRounds.filter((r) => r.status !== 'abandoned').every((r) => r.status === 'final')
  let transfers: Transfer[] = []
  if (config.mode === 'buyin' && settleable && pendingCents === 0) {
    const balances: NetBalance[] = players.map((p) => ({ playerId: p.playerId, cents: p.netCents }))
    transfers = settle(balances)
  }

  let reconciliation: ReconciliationVM | null = null
  if (config.mode === 'buyin') {
    const totalIn = buyInPerPlayer * playerCount
    const awarded = players.reduce((s, p) => s + p.winningsCents, 0)
    reconciliation = {
      totalInCents: totalIn,
      awardedCents: awarded,
      pendingCents,
      balanced: awarded + pendingCents === totalIn,
    }
  }

  return {
    mode: config.mode,
    carryMode,
    championshipTotalCents: purse.championshipCents,
    roundWinnersTotalCents: purse.roundWinnersTotalCents,
    ctpTotalCents: purse.ctpTotalCents,
    totalPotCents: purse.totalCents,
    rounds,
    players,
    championSet,
    transfers,
    settleable,
    reconciliation,
    hasMoney: purse.totalCents > 0,
  }
}

// ── Small allocation helpers ──────────────────────────────────────────────────

type Bucket = 'championship' | 'round' | 'ctp'

/** Split `cents` evenly among the (already order-prioritised) winners; remainder to the
 *  earliest, which allocateEvenCents does, so the caller orders by standing / better round. */
function awardEvenly(
  acc: Map<string, { championship: number; round: number; ctp: number; refund: number }>,
  orderedIds: string[],
  cents: number,
  bucket: Bucket,
): void {
  if (orderedIds.length === 0 || cents <= 0) return
  const parts = allocateEvenCents(cents, orderedIds.length)
  orderedIds.forEach((id, i) => {
    const a = acc.get(id)
    if (a) a[bucket] += parts[i] ?? 0
  })
}

/** Order tied players so the remainder cent lands on the one higher in the overall
 *  standings (brief: "remainder cents ... to the player higher in the final standings"). */
function orderByStanding(ids: string[], dbData: Db): string[] {
  if (ids.length <= 1) return ids
  const standings = buildStandings(dbData)
  const posById = new Map(standings.rows.map((r) => [r.playerId, r.position]))
  const sortById = new Map(dbData.players.map((p) => [p.id, p.sort_order]))
  return [...ids].sort(
    (a, b) => (posById.get(a) ?? 99) - (posById.get(b) ?? 99) || (sortById.get(a) ?? 99) - (sortById.get(b) ?? 99),
  )
}

/** This round's even share of the championship pot (remainder to the earliest counting
 *  round), so the four `round_money` rows stay additive — decisions.md §"championship_share". */
function perRoundChampionshipShare(
  purse: ReturnType<typeof computePurse>,
  moneyRounds: MoneyRound[],
  roundNumber: number,
): number {
  const counting = moneyRounds.filter((r) => !r.abandoned)
  const idx = counting.findIndex((r) => r.roundNumber === roundNumber)
  if (idx < 0) return 0
  const parts = allocateEvenCents(purse.championshipCents, counting.length)
  return parts[idx] ?? 0
}
