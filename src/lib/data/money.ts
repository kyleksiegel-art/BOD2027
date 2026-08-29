// Phase 7 (revised) — the money ledger, assembled purely from Dexie rows. Like compute.ts
// this is React-free and network-free, so it runs identically online or off, and every
// dollar figure derives at compute time from `settings`. The frozen `round_money` snapshot
// written at finalization is a verification mirror of this derivation, not its source.
//
// The model (Kyle 2026-08-23, from the trip's money sheet):
//   Buy-in per man funds three payouts — 1st overall, 2nd overall, and a per-round winner.
//   There is NO closest-to-pin money (CTP is still entered on the round screen for bragging
//   rights, it just doesn't pay). Ties pool the tied positions' purses and split evenly, the
//   remainder cent going to the player higher in the standings.
//
// All arithmetic is INTEGER CENTS; rounding happens only at display. The cent-splits and the
// greedy settlement come from the tested pure engine in src/lib/scoring/money.ts.
import {
  settle,
  compareCountback,
  allocateEvenCents,
  type Transfer,
  type NetBalance,
  type CountbackContext,
  type CountbackRound,
  type RoundStatus,
} from '@/lib/scoring'
import { buildRoundDetail, buildStandings, type Db, type RoundDetailVM, type StandingsVM } from './compute'
import type { SettingRow } from './types'

// ── Settings → PurseSettings ──────────────────────────────────────────────────

export interface PurseSettings {
  buyInPerPlayerCents: number
  champFirstCents: number
  champSecondCents: number
  roundWinnerCents: number
}

function settingValue<T>(settings: SettingRow[], key: string, fallback: T): T {
  const row = settings.find((s) => s.key === key)
  return row === undefined || row.value === null ? fallback : (row.value as T)
}

export function purseSettingsOf(dbData: Db): PurseSettings {
  const amounts = settingValue<{
    buy_in_per_player_cents?: number
    champ_first_cents?: number
    champ_second_cents?: number
    round_winner_cents?: number
  }>(dbData.settings, 'purse_amounts', {})
  return {
    buyInPerPlayerCents: amounts.buy_in_per_player_cents ?? 0,
    champFirstCents: amounts.champ_first_cents ?? 0,
    champSecondCents: amounts.champ_second_cents ?? 0,
    roundWinnerCents: amounts.round_winner_cents ?? 0,
  }
}

// ── View models ───────────────────────────────────────────────────────────────

export interface WinnerVM {
  playerIds: string[] // >1 only when players are genuinely tied (their purses are pooled)
  names: string[]
  points: number
}

export interface RoundMoneyVM {
  roundNumber: number
  courseName: string
  status: RoundStatus
  counts: boolean // a counting round carries a round-winner obligation (everything but abandoned)
  roundPurseCents: number // this round's winner payout (0 if abandoned)
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
  winningsCents: number // championship + round
  netCents: number // winnings − buy-in
}

export interface ReconciliationVM {
  totalInCents: number // buy-ins collected
  awardedCents: number // paid out so far
  pendingCents: number // reserved for rounds / the championship not yet decided
  balanced: boolean // awarded + pending === totalIn (a structural tripwire)
}

export interface MoneyVM {
  buyInPerPlayerCents: number
  champFirstCents: number
  champSecondCents: number
  championshipTotalCents: number // 1st + 2nd
  roundWinnersTotalCents: number // per-round × counting rounds
  totalPotCents: number // buy-in × players
  rounds: RoundMoneyVM[]
  players: PlayerMoneyVM[]
  firstPlace: WinnerVM | null // current overall leader(s) taking 1st
  secondPlace: WinnerVM | null // runner-up(s) taking 2nd (null when 1st is a tie that pools both)
  transfers: Transfer[] // greedy settlement — only when fully settled and balanced
  settleable: boolean // true once every counting round is final
  reconciliation: ReconciliationVM
  hasMoney: boolean
}

// ── Countback / round-winner helpers (reuse the tested engine primitives) ───────

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

/**
 * Resolve one round's winner from its leaderboard: top points, ties broken by a countback on
 * that round, and a genuinely unbreakable tie splits the round purse. Returns null when nobody
 * has scored yet (nothing to award).
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

// ── Championship places (1st / 2nd overall) ─────────────────────────────────────

interface ChampionPlaces {
  firstPlace: WinnerVM | null
  secondPlace: WinnerVM | null
  awardsByPlayer: Map<string, number>
  awardedTotalCents: number
}

/**
 * Pay 1st and 2nd overall off the standings. Ties share a position (competition ranking), so a
 * tie pools the purses of the positions it occupies and splits them evenly — two tied for 1st
 * split ($first + $second); a tie for 2nd splits $second; three tied for 1st still only share
 * the two paid places. The remainder cent lands on the player higher in the standings.
 */
function resolveChampionPlaces(standings: StandingsVM, dbData: Db, purse: PurseSettings): ChampionPlaces {
  const awards = new Map<string, number>()
  const empty: ChampionPlaces = { firstPlace: null, secondPlace: null, awardsByPlayer: awards, awardedTotalCents: 0 }
  const rows = standings.rows
  if (!standings.hasCountingRound || rows.length === 0 || rows[0].total <= 0) return empty

  const nameById = new Map(dbData.players.map((p) => [p.id, p.name]))
  const placeAmount = (place: number): number =>
    place === 1 ? purse.champFirstCents : place === 2 ? purse.champSecondCents : 0

  const asWinner = (ids: string[], points: number): WinnerVM => ({
    playerIds: ids,
    names: ids.map((id) => nameById.get(id) ?? 'Player'),
    points,
  })

  let firstPlace: WinnerVM | null = null
  let secondPlace: WinnerVM | null = null
  let awardedTotal = 0
  let i = 0
  let placeIndex = 0 // 0-based count of places already filled by earlier groups

  while (i < rows.length && placeIndex < 2) {
    const pos = rows[i].position
    let j = i
    while (j < rows.length && rows[j].position === pos) j++
    const group = rows.slice(i, j).map((r) => r.playerId)
    const g = group.length

    // Places this tie group occupies: (placeIndex+1) … (placeIndex+g). Pool their purses.
    let pool = 0
    for (let k = 1; k <= g; k++) pool += placeAmount(placeIndex + k)
    if (pool > 0) {
      const ordered = orderByStanding(group, dbData)
      const parts = allocateEvenCents(pool, g)
      ordered.forEach((id, idx) => awards.set(id, (awards.get(id) ?? 0) + (parts[idx] ?? 0)))
      awardedTotal += pool
    }

    if (placeIndex === 0) firstPlace = asWinner(group, rows[i].total)
    else if (placeIndex === 1) secondPlace = asWinner(group, rows[i].total)

    placeIndex += g
    i = j
  }

  return { firstPlace, secondPlace, awardsByPlayer: awards, awardedTotalCents: awardedTotal }
}

// ── The whole ledger ────────────────────────────────────────────────────────

export function buildMoney(dbData: Db): MoneyVM {
  const purse = purseSettingsOf(dbData)
  const playerCount = dbData.players.length
  const totalPot = purse.buyInPerPlayerCents * playerCount

  const coursesById = new Map(dbData.courses.map((c) => [c.id, c]))
  const orderedRounds = dbData.rounds.slice().sort((a, b) => a.round_number - b.round_number)

  // Build each in-play round's detail once — reused for the round winner and the standings.
  const details = new Map<number, RoundDetailVM>()
  for (const r of orderedRounds) {
    if (!isCounting(r.status as RoundStatus)) continue
    const d = buildRoundDetail(r.round_number, dbData)
    if (d) details.set(r.round_number, d)
  }

  const acc = new Map<string, { championship: number; round: number }>()
  for (const p of dbData.players) acc.set(p.id, { championship: 0, round: 0 })

  let pendingCents = 0

  // ── Per-round money view + round-winner payouts ──
  const rounds: RoundMoneyVM[] = orderedRounds.map((round) => {
    const course = coursesById.get(round.course_id)
    const status = round.status as RoundStatus
    const counts = status !== 'abandoned'
    const roundPurse = counts ? purse.roundWinnerCents : 0
    const detail = details.get(round.round_number)

    let roundWinner: WinnerVM | null = null
    if (detail) roundWinner = resolveRoundWinner(detail)
    if (roundWinner && roundPurse > 0) {
      awardEvenly(acc, orderByStanding(roundWinner.playerIds, dbData), roundPurse, 'round')
    } else if (counts && roundPurse > 0) {
      pendingCents += roundPurse // reserved but not yet won
    }

    return {
      roundNumber: round.round_number,
      courseName: course?.name ?? 'Course',
      status,
      counts,
      roundPurseCents: roundPurse,
      roundWinner,
      frozen: status === 'final',
    }
  })

  // ── Championship (1st + 2nd overall) ──
  const standings = buildStandings(dbData)
  const places = resolveChampionPlaces(standings, dbData, purse)
  for (const [id, cents] of places.awardsByPlayer) {
    const a = acc.get(id)
    if (a) a.championship += cents
  }
  const champObligation = purse.champFirstCents + purse.champSecondCents
  pendingCents += Math.max(0, champObligation - places.awardedTotalCents)

  // ── Per-player rows ──
  const buyIn = purse.buyInPerPlayerCents
  const players: PlayerMoneyVM[] = dbData.players
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => {
      const a = acc.get(p.id) ?? { championship: 0, round: 0 }
      const winnings = a.championship + a.round
      return {
        playerId: p.id,
        name: p.name,
        sortOrder: p.sort_order,
        buyInCents: buyIn,
        championshipCents: a.championship,
        roundWinningsCents: a.round,
        winningsCents: winnings,
        netCents: winnings - buyIn,
      }
    })

  // ── Reconciliation + settlement ──
  const totalIn = buyIn * playerCount
  const awarded = players.reduce((s, p) => s + p.winningsCents, 0)
  const reconciliation: ReconciliationVM = {
    totalInCents: totalIn,
    awardedCents: awarded,
    pendingCents,
    balanced: awarded + pendingCents === totalIn,
  }

  const settleable = orderedRounds.filter((r) => r.status !== 'abandoned').every((r) => r.status === 'final')
  let transfers: Transfer[] = []
  // Settle only when nothing is pending AND the awards reconcile to the pot — otherwise the net
  // balances don't sum to zero and the greedy settlement would be nonsense.
  if (settleable && pendingCents === 0 && reconciliation.balanced) {
    const balances: NetBalance[] = players.map((p) => ({ playerId: p.playerId, cents: p.netCents }))
    transfers = settle(balances)
  }

  const roundWinnersTotal = rounds.reduce((s, r) => s + r.roundPurseCents, 0)

  return {
    buyInPerPlayerCents: buyIn,
    champFirstCents: purse.champFirstCents,
    champSecondCents: purse.champSecondCents,
    championshipTotalCents: champObligation,
    roundWinnersTotalCents: roundWinnersTotal,
    totalPotCents: totalPot,
    rounds,
    players,
    firstPlace: places.firstPlace,
    secondPlace: places.secondPlace,
    transfers,
    settleable,
    reconciliation,
    hasMoney: totalPot > 0 || champObligation > 0 || roundWinnersTotal > 0,
  }
}

// ── Small allocation helpers ──────────────────────────────────────────────────

type Bucket = 'championship' | 'round'

/** Split `cents` evenly among the (already order-prioritised) winners; remainder to the
 *  earliest, so the caller orders by standing. */
function awardEvenly(
  acc: Map<string, { championship: number; round: number }>,
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

/** Order tied players so the remainder cent lands on the one higher in the overall standings. */
function orderByStanding(ids: string[], dbData: Db): string[] {
  if (ids.length <= 1) return ids
  const standings = buildStandings(dbData)
  const posById = new Map(standings.rows.map((r) => [r.playerId, r.position]))
  const sortById = new Map(dbData.players.map((p) => [p.id, p.sort_order]))
  return [...ids].sort(
    (a, b) => (posById.get(a) ?? 99) - (posById.get(b) ?? 99) || (sortById.get(a) ?? 99) - (sortById.get(b) ?? 99),
  )
}
