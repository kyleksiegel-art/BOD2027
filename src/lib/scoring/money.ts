// Purse allocation, CTP weighting, and greedy net settlement. All arithmetic is in
// INTEGER CENTS — round only at display. Per-payment dollar rounding does not sum back
// to net balances (a three-way split of $100 is the classic case), so we never round
// mid-computation. Phase 3 provides the pure engine; Phase 7 wires it to settings/UI.

// ---------------------------------------------------------------------------
// Cent allocation primitives
// ---------------------------------------------------------------------------

/** Split `totalCents` into `n` parts as equal as possible; extra cents go to the
 *  EARLIEST parts. Sum of the result always equals totalCents exactly. */
export function allocateEvenCents(totalCents: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(totalCents / n)
  const remainder = totalCents - base * n
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}

/** Like allocateEvenCents but extra cents go to the LAST parts — used for CTP within a
 *  round, where the brief sends remainder cents to the round's last par 3. */
export function allocateEvenCentsRemainderLast(totalCents: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(totalCents / n)
  const remainder = totalCents - base * n
  return Array.from({ length: n }, (_, i) => base + (i >= n - remainder ? 1 : 0))
}

/**
 * Split `totalCents` in proportion to `weights` using the largest-remainder (Hamilton)
 * method, so the parts sum to totalCents exactly. Leftover cents go to the largest
 * fractional remainders; ties broken by index (earlier wins).
 */
export function allocateProportionalCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => 0)

  const exact = weights.map((w) => (totalCents * w) / sum)
  const floors = exact.map((x) => Math.floor(x))
  const allocated = floors.reduce((a, b) => a + b, 0)
  let remainder = totalCents - allocated

  const byFrac = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  const result = floors.slice()
  for (let k = 0; k < remainder && k < byFrac.length; k++) result[byFrac[k].i] += 1
  return result
}

// ---------------------------------------------------------------------------
// Purse allocation
// ---------------------------------------------------------------------------

export type PurseMode = 'fixed' | 'buyin'

export interface PurseWeights {
  championship: number // default 0.40
  roundWinners: number // default 0.30 total
  ctp: number // default 0.30 total
}

export const DEFAULT_PURSE_WEIGHTS: PurseWeights = {
  championship: 0.4,
  roundWinners: 0.3,
  ctp: 0.3,
}

/** A round as it participates in the money split. */
export interface MoneyRound {
  roundNumber: number
  par3Count: number
  abandoned: boolean // abandoned rounds get no round-winner or CTP share
}

export interface PurseConfig {
  mode: PurseMode
  weights: PurseWeights
  // buyin mode:
  buyInPerPlayerCents?: number
  playerCount?: number
  // fixed mode: an explicit dollar (cent) figure per pot
  fixedCents?: { championship: number; roundWinners: number; ctp: number }
}

export interface PurseAllocation {
  totalCents: number
  championshipCents: number
  roundWinnersTotalCents: number
  ctpTotalCents: number
  /** roundNumber -> that round's slice of the round-winner pot (counting rounds only). */
  perRoundWinnerCents: Map<number, number>
  /** roundNumber -> that round's CTP pot, proportional to its par-3 count. */
  perRoundCtpCents: Map<number, number>
  /** roundNumber -> per-par-3 CTP split within the round (remainder to the last par 3). */
  perRoundCtpPerHoleCents: Map<number, number[]>
}

/**
 * Compute the whole money split from config + rounds. The 40/30/30 weights apply in
 * buy-in mode; fixed mode uses the explicit pot amounts. The round-winner 30% splits
 * evenly across counting rounds (an abandoned round's share redistributes to the rest);
 * the CTP 30% splits across rounds in proportion to par-3 count, so every par 3 on the
 * trip is worth the same regardless of Black's five vs. Red/Blue's four.
 */
export function computePurse(config: PurseConfig, rounds: MoneyRound[]): PurseAllocation {
  let championshipCents: number
  let roundWinnersTotalCents: number
  let ctpTotalCents: number
  let totalCents: number

  if (config.mode === 'buyin') {
    const total = (config.buyInPerPlayerCents ?? 0) * (config.playerCount ?? 0)
    totalCents = total
    const [ch, rw, ctp] = allocateProportionalCents(total, [
      config.weights.championship,
      config.weights.roundWinners,
      config.weights.ctp,
    ])
    championshipCents = ch
    roundWinnersTotalCents = rw
    ctpTotalCents = ctp
  } else {
    const fixed = config.fixedCents ?? { championship: 0, roundWinners: 0, ctp: 0 }
    championshipCents = fixed.championship
    roundWinnersTotalCents = fixed.roundWinners
    ctpTotalCents = fixed.ctp
    totalCents = championshipCents + roundWinnersTotalCents + ctpTotalCents
  }

  const counting = rounds.filter((r) => !r.abandoned)

  // Round-winner pot: even split across counting rounds.
  const perRoundWinnerCents = new Map<number, number>()
  const rwParts = allocateEvenCents(roundWinnersTotalCents, counting.length)
  counting.forEach((r, i) => perRoundWinnerCents.set(r.roundNumber, rwParts[i] ?? 0))

  // CTP pot: split across counting rounds proportional to par-3 count.
  const perRoundCtpCents = new Map<number, number>()
  const perRoundCtpPerHoleCents = new Map<number, number[]>()
  const ctpParts = allocateProportionalCents(
    ctpTotalCents,
    counting.map((r) => r.par3Count),
  )
  counting.forEach((r, i) => {
    const roundCtp = ctpParts[i] ?? 0
    perRoundCtpCents.set(r.roundNumber, roundCtp)
    // Within the round, split evenly across its par 3s; remainder to the last par 3.
    perRoundCtpPerHoleCents.set(r.roundNumber, allocateEvenCentsRemainderLast(roundCtp, r.par3Count))
  })

  return {
    totalCents,
    championshipCents,
    roundWinnersTotalCents,
    ctpTotalCents,
    perRoundWinnerCents,
    perRoundCtpCents,
    perRoundCtpPerHoleCents,
  }
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/** A player's net position in cents: positive = owed money (creditor), negative = owes
 *  (debtor). Balances must sum to zero. */
export interface NetBalance {
  playerId: string
  cents: number
}

export interface Transfer {
  from: string // debtor
  to: string // creditor
  cents: number
}

/**
 * Greedy net settlement: repeatedly match the largest debtor to the largest creditor
 * and transfer the smaller of the two magnitudes. Yields at most n−1 transfers. Greedy
 * is not provably transaction-minimal in general — don't claim "minimum" in the UI.
 */
export function settle(balances: NetBalance[]): Transfer[] {
  const debtors = balances.filter((b) => b.cents < 0).map((b) => ({ id: b.playerId, cents: -b.cents }))
  const creditors = balances.filter((b) => b.cents > 0).map((b) => ({ id: b.playerId, cents: b.cents }))
  const transfers: Transfer[] = []

  // Re-select the current max each iteration so it is genuinely largest-to-largest.
  for (;;) {
    let di = -1
    let ci = -1
    for (let k = 0; k < debtors.length; k++) if (debtors[k].cents > 0 && (di < 0 || debtors[k].cents > debtors[di].cents)) di = k
    for (let k = 0; k < creditors.length; k++) if (creditors[k].cents > 0 && (ci < 0 || creditors[k].cents > creditors[ci].cents)) ci = k
    if (di < 0 || ci < 0) break

    const pay = Math.min(debtors[di].cents, creditors[ci].cents)
    transfers.push({ from: debtors[di].id, to: creditors[ci].id, cents: pay })
    debtors[di].cents -= pay
    creditors[ci].cents -= pay
  }

  return transfers
}

/** Buy-in reconciliation: total payouts must equal total buy-ins, to the cent. */
export function reconcile(totalInCents: number, payoutCents: number[]): {
  totalInCents: number
  totalOutCents: number
  balanced: boolean
} {
  const totalOutCents = payoutCents.reduce((a, b) => a + b, 0)
  return { totalInCents, totalOutCents, balanced: totalInCents === totalOutCents }
}
