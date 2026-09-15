import { allocateEvenCents } from '@/lib/scoring'
import { buildStandings } from './compute'
import type { Db } from './compute'
import { buildMoney } from './money'
import { ordinalOf } from '@/lib/format'

/**
 * Where each player stands in the week, for the top of an opened row on the Players tab: place,
 * total, the gap to the leader by name, and the money already banked. Reads the same standings
 * and ledger every other screen does, so the row can never disagree with Standings or Money.
 */
export interface PlayerWeekVM {
  position: number
  tie: boolean
  positionLabel: string // "2nd", or "T2" for a genuinely shared place
  total: number
  gap: number
  backLabel: string // "Leader" | "Level for the lead" | "Level with Kyle" | "4 back of Kyle" | "4 back"
  throughLabel: string // "through R3" | "R2 live"
  wonCents: number // round-winner money from FINAL rounds only — nothing provisional
}

export function buildPlayerWeek(dbData: Db): Map<string, PlayerWeekVM> {
  const out = new Map<string, PlayerWeekVM>()
  const standings = buildStandings(dbData)
  if (!standings.hasCountingRound || standings.rows.length === 0) return out

  const rows = standings.rows
  const leaders = rows.filter((r) => r.position === 1)
  const leaderFirst = leaders.length === 1 ? leaders[0].name.split(/\s+/)[0] : null
  const throughLabel = standings.liveRound
    ? `R${standings.liveRound.roundNumber} live`
    : `through R${standings.countingRoundNumbers[standings.countingRoundNumbers.length - 1]}`

  // Banked money: a final round's winner payout, split the way the ledger splits it (even, the
  // odd cent to the higher standing). A live round's provisional winner and the championship
  // places are deliberately left out — "won so far" has to mean won.
  const money = buildMoney(dbData)
  const standingIndex = new Map(rows.map((r, i) => [r.playerId, i]))
  const won = new Map<string, number>()
  for (const rm of money.rounds) {
    if (!rm.frozen || !rm.roundWinner || rm.roundPurseCents <= 0) continue
    const ids = rm.roundWinner.playerIds
      .slice()
      .sort((a, b) => (standingIndex.get(a) ?? 99) - (standingIndex.get(b) ?? 99))
    const parts = allocateEvenCents(rm.roundPurseCents, ids.length)
    ids.forEach((id, i) => won.set(id, (won.get(id) ?? 0) + parts[i]))
  }

  for (const r of rows) {
    let backLabel: string
    if (r.position === 1) backLabel = r.tie ? 'Level for the lead' : 'Leader'
    else if (r.gapToLeader === 0) backLabel = leaderFirst ? `Level with ${leaderFirst}` : 'Level on points'
    else backLabel = leaderFirst ? `${r.gapToLeader} back of ${leaderFirst}` : `${r.gapToLeader} back`

    out.set(r.playerId, {
      position: r.position,
      tie: r.tie,
      positionLabel: r.tie ? `T${r.position}` : ordinalOf(r.position),
      total: r.total,
      gap: r.gapToLeader,
      backLabel,
      throughLabel,
      wonCents: won.get(r.playerId) ?? 0,
    })
  }
  return out
}
