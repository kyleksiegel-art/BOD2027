import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useMoney } from '@/lib/data/selectors'
import { formatMoney, formatMoneySigned } from '@/lib/format'
import type { MoneyVM, RoundMoneyVM, WinnerVM } from '@/lib/data/money'

export default function Money() {
  const money = useMoney()

  if (!money) {
    return (
      <Page>
        <PageHeader eyebrow="The Purse" title="Money" />
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader eyebrow="The Purse" title="Money" meta="All figures derive from the current purse settings" />

      {!money.hasMoney ? (
        <div className="mt-8 rounded-lg border border-hair bg-ground-2/40 p-5">
          <p className="text-paper-dim">
            No money is on the trip yet. Set the buy-in and payouts in Admin, and the full
            breakdown appears here.
          </p>
        </div>
      ) : (
        <>
          <PotSummary money={money} />
          <PerRound money={money} />
          <Ledger money={money} />
          <Settlement money={money} />
          <Footnotes />
        </>
      )}
    </Page>
  )
}

function PotSummary({ money }: { money: MoneyVM }) {
  return (
    <section className="mt-8">
      <div className="rounded-lg border border-hair-strong bg-ground-2 p-5">
        <span className="eyebrow block">Total purse</span>
        <div className="mt-1 font-display text-4xl font-semibold tnum text-gold">
          {formatMoney(money.totalPotCents)}
        </div>
        <p className="mt-1 text-[0.8rem] text-paper-faint">
          {formatMoney(money.buyInPerPlayerCents)}/man × {money.players.length}
        </p>
        <dl className="mt-4 space-y-2">
          <PotLine label="1st place overall" value={money.champFirstCents} winner={money.firstPlace} />
          <PotLine label="2nd place overall" value={money.champSecondCents} winner={money.secondPlace} />
          <PotLine
            label="Daily round winners"
            value={money.roundWinnersTotalCents}
            note={`${formatMoney(money.rounds.find((r) => r.counts)?.roundPurseCents ?? 0)} per round`}
          />
        </dl>
      </div>
    </section>
  )
}

function PotLine({
  label,
  value,
  note,
  winner,
}: {
  label: string
  value: number
  note?: string
  winner?: WinnerVM | null
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-hair pt-2">
      <span className="text-paper">
        {label}
        {winner ? (
          <span className="ml-2 text-[0.78rem] text-gold-bright">{winner.names.join(' & ')}</span>
        ) : note ? (
          <span className="ml-2 text-[0.75rem] text-paper-faint">{note}</span>
        ) : null}
      </span>
      <span className="tnum text-paper">{formatMoney(value)}</span>
    </div>
  )
}

function PerRound({ money }: { money: MoneyVM }) {
  return (
    <section className="mt-8">
      <span className="eyebrow block">Round winners</span>
      <div className="mt-4 space-y-3">
        {money.rounds.map((r) => (
          <RoundCard key={r.roundNumber} r={r} />
        ))}
      </div>
    </section>
  )
}

function RoundCard({ r }: { r: RoundMoneyVM }) {
  const abandoned = r.status === 'abandoned'
  return (
    <div className={`rounded-lg border border-hair bg-ground-2 p-4 ${abandoned ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-xl text-paper">
          Round {r.roundNumber} · {r.courseName}
        </span>
        {r.frozen ? (
          <span className="text-[0.72rem] uppercase tracking-[0.14em] text-paper-faint">Frozen</span>
        ) : null}
      </div>

      {abandoned ? (
        <p className="mt-2 text-[0.85rem] text-paper-dim">Abandoned — no round winner paid.</p>
      ) : (
        <div className="mt-3 flex items-baseline justify-between gap-3 text-[0.9rem]">
          <span className="text-paper-dim">
            Round winner
            {r.roundWinner ? (
              <span className="ml-2 text-paper">{r.roundWinner.names.join(' & ')}</span>
            ) : (
              <span className="ml-2 text-paper-faint">not decided yet</span>
            )}
          </span>
          <span className="tnum text-paper">{formatMoney(r.roundPurseCents)}</span>
        </div>
      )}
    </div>
  )
}

function Ledger({ money }: { money: MoneyVM }) {
  return (
    <section className="mt-8">
      <span className="eyebrow block">Per player</span>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[0.85rem]">
          <thead>
            <tr className="text-left text-[0.72rem] uppercase tracking-[0.1em] text-paper-faint">
              <th className="py-2 pr-3 font-normal">Player</th>
              <th className="py-2 px-2 text-right font-normal">In</th>
              <th className="py-2 px-2 text-right font-normal">Won</th>
              <th className="py-2 pl-2 text-right font-normal">Net</th>
            </tr>
          </thead>
          <tbody>
            {money.players.map((p) => (
              <tr key={p.playerId} className="border-t border-hair">
                <td className="py-2 pr-3 text-paper">{p.name}</td>
                <td className="py-2 px-2 text-right tnum text-paper-dim">{formatMoney(p.buyInCents)}</td>
                <td className="py-2 px-2 text-right tnum text-paper">{formatMoney(p.winningsCents)}</td>
                <td
                  className={`py-2 pl-2 text-right tnum ${
                    p.netCents > 0 ? 'text-gold' : p.netCents < 0 ? 'text-paper-dim' : 'text-paper'
                  }`}
                >
                  {formatMoneySigned(p.netCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Settlement({ money }: { money: MoneyVM }) {
  const nameById = new Map(money.players.map((p) => [p.playerId, p.name]))

  return (
    <section className="mt-8">
      <span className="eyebrow block">Settle up</span>
      {!money.settleable ? (
        <p className="mt-3 text-[0.85rem] text-paper-dim">
          Available once every round is final — a round is still in play.
        </p>
      ) : !money.reconciliation.balanced ? (
        <p className="mt-3 text-[0.85rem] text-gold-bright">
          Payouts don’t reconcile to the buy-ins — fix the amounts in Admin before settling.
        </p>
      ) : money.transfers.length === 0 ? (
        <p className="mt-3 text-[0.85rem] text-paper-dim">Nobody owes anybody — it’s even.</p>
      ) : (
        <>
          <p className="mt-2 text-[0.8rem] text-paper-faint">
            Settled down to {money.transfers.length} payment{money.transfers.length === 1 ? '' : 's'} or fewer.
          </p>
          <ul className="mt-3 space-y-2">
            {money.transfers.map((t, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 border-b border-hair py-2 first:border-t first:border-t-hair-strong"
              >
                <span className="text-paper">
                  {nameById.get(t.from) ?? 'Player'} <span className="text-paper-faint">→</span>{' '}
                  {nameById.get(t.to) ?? 'Player'}
                </span>
                <span className="tnum font-semibold text-gold">{formatMoney(t.cents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Footnotes() {
  return (
    <section className="mt-10 space-y-1 border-t border-hair pt-4 text-[0.75rem] text-paper-faint">
      <p>
        Ties pool the tied places and split evenly; the remainder cent goes to the player higher in
        the standings. Closest-to-pin is tracked for bragging rights only — it pays nothing.
      </p>
    </section>
  )
}
