import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useMoney } from '@/lib/data/selectors'
import { formatMoney, formatMoneySigned } from '@/lib/format'
import type { MoneyVM, RoundMoneyVM, CtpHoleVM } from '@/lib/data/money'

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

  const modeLabel = money.mode === 'buyin' ? 'Buy-in' : 'Fixed pots'

  return (
    <Page>
      <PageHeader eyebrow="The Purse" title="Money" meta={`${modeLabel} · all figures derive from the current purse settings`} />

      {!money.hasMoney ? (
        <div className="mt-8 rounded-lg border border-hair bg-ground-2/40 p-5">
          <p className="text-paper-dim">
            No money is on the trip yet. Set the purse — buy-in or fixed pots — in Admin, and the
            full breakdown appears here.
          </p>
        </div>
      ) : (
        <>
          <PotSummary money={money} />
          {money.reconciliation ? <Reconciliation money={money} /> : null}
          <PerRound money={money} />
          <Ledger money={money} />
          <Settlement money={money} />
          <Footnotes money={money} />
        </>
      )}
    </Page>
  )
}

function PotSummary({ money }: { money: MoneyVM }) {
  const champ = money.championSet
  return (
    <section className="mt-8">
      <div className="rounded-lg border border-hair-strong bg-black/20 p-5">
        <span className="eyebrow block">Total purse</span>
        <div className="mt-1 font-display text-4xl font-semibold tnum text-gold">
          {formatMoney(money.totalPotCents)}
        </div>
        <dl className="mt-4 space-y-2">
          <PotLine
            label="Overall championship"
            value={money.championshipTotalCents}
            note={champ ? `${champ.names.join(' & ')} leading` : undefined}
          />
          <PotLine label="Round winners" value={money.roundWinnersTotalCents} note="split across counting rounds" />
          <PotLine label="Closest to pin" value={money.ctpTotalCents} note="by par-3 count per round" />
        </dl>
      </div>
    </section>
  )
}

function PotLine({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-hair pt-2">
      <span className="text-paper">
        {label}
        {note ? <span className="ml-2 text-[0.75rem] text-paper-faint">{note}</span> : null}
      </span>
      <span className="tnum text-paper">{formatMoney(value)}</span>
    </div>
  )
}

function Reconciliation({ money }: { money: MoneyVM }) {
  const r = money.reconciliation!
  const balanced = r.balanced
  return (
    <section className="mt-6">
      <div
        className={`rounded-lg border p-4 ${
          balanced ? 'border-hair bg-black/20' : 'border-gold bg-gold/10'
        }`}
      >
        <span className="eyebrow block">Buy-in reconciliation</span>
        <dl className="mt-3 space-y-1.5 text-[0.9rem]">
          <Row label="Collected (buy-ins)" value={formatMoney(r.totalInCents)} />
          <Row label="Awarded so far" value={formatMoney(r.awardedCents)} />
          <Row label="Still to be decided" value={formatMoney(r.pendingCents)} muted />
        </dl>
        {!balanced ? (
          <p className="mt-3 text-[0.85rem] font-semibold text-gold-bright">
            ⚠ Payouts don’t reconcile to the buy-ins. Check the purse settings.
          </p>
        ) : r.pendingCents > 0 ? (
          <p className="mt-3 text-[0.8rem] text-paper-faint">
            Reconciles to the cent — {formatMoney(r.pendingCents)} is reserved for rounds and pins
            not yet decided.
          </p>
        ) : (
          <p className="mt-3 text-[0.8rem] text-paper-faint">Reconciles to the cent.</p>
        )}
      </div>
    </section>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={muted ? 'text-paper-dim' : 'text-paper'}>{label}</span>
      <span className={`tnum ${muted ? 'text-paper-dim' : 'text-paper'}`}>{value}</span>
    </div>
  )
}

function PerRound({ money }: { money: MoneyVM }) {
  return (
    <section className="mt-8">
      <span className="eyebrow block">By round</span>
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
    <div className={`rounded-lg border border-hair bg-black/20 p-4 ${abandoned ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-xl text-paper">
          Round {r.roundNumber} · {r.courseName}
        </span>
        {r.frozen ? <span className="text-[0.72rem] uppercase tracking-[0.14em] text-paper-faint">Frozen</span> : null}
      </div>

      {abandoned ? (
        <p className="mt-2 text-[0.85rem] text-paper-dim">Abandoned — its share redistributed to the other rounds.</p>
      ) : (
        <>
          <dl className="mt-3 space-y-1.5 text-[0.9rem]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-paper-dim">Championship share</span>
              <span className="tnum text-paper">{formatMoney(r.championshipShareCents)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-paper-dim">
                Round winner
                {r.roundWinner ? <span className="ml-2 text-paper">{r.roundWinner.names.join(' & ')}</span> : null}
              </span>
              <span className="tnum text-paper">{formatMoney(r.roundPurseCents)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-paper-dim">Closest to pin ({r.par3Count} par 3{r.par3Count === 1 ? '' : 's'})</span>
              <span className="tnum text-paper">{formatMoney(r.ctpPotCents)}</span>
            </div>
          </dl>

          {r.ctpPerHole.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-hair pt-3">
              {r.ctpPerHole.map((h) => (
                <CtpLine key={h.holeNumber} h={h} />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  )
}

function CtpLine({ h }: { h: CtpHoleVM }) {
  const label =
    h.status === 'won'
      ? h.winnerName
      : h.status === 'carry'
        ? 'Carried on'
        : h.status === 'void'
          ? 'No winner — returned'
          : 'Not entered'
  const tone =
    h.status === 'won' ? 'text-paper' : h.status === 'pending' ? 'text-paper-faint' : 'text-paper-dim'
  return (
    <li className="flex items-baseline justify-between gap-3 text-[0.82rem]">
      <span className="text-paper-faint tnum">Hole {h.holeNumber}</span>
      <span className={`flex-1 px-2 ${tone}`}>
        {label}
        {h.status === 'won' && h.distanceFeet !== null ? (
          <span className="ml-1 text-paper-faint tnum">· {h.distanceFeet} ft</span>
        ) : null}
      </span>
      <span className="tnum text-paper-dim">{formatMoney(h.potCents)}</span>
    </li>
  )
}

function Ledger({ money }: { money: MoneyVM }) {
  const buyin = money.mode === 'buyin'
  return (
    <section className="mt-8">
      <span className="eyebrow block">Per player</span>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[0.85rem]">
          <thead>
            <tr className="text-left text-[0.72rem] uppercase tracking-[0.1em] text-paper-faint">
              <th className="py-2 pr-3 font-normal">Player</th>
              {buyin ? <th className="py-2 px-2 text-right font-normal">In</th> : null}
              <th className="py-2 px-2 text-right font-normal">Won</th>
              <th className="py-2 pl-2 text-right font-normal">{buyin ? 'Net' : 'Total'}</th>
            </tr>
          </thead>
          <tbody>
            {money.players.map((p) => (
              <tr key={p.playerId} className="border-t border-hair">
                <td className="py-2 pr-3 text-paper">{p.name}</td>
                {buyin ? <td className="py-2 px-2 text-right tnum text-paper-dim">{formatMoney(p.buyInCents)}</td> : null}
                <td className="py-2 px-2 text-right tnum text-paper">{formatMoney(p.winningsCents)}</td>
                <td
                  className={`py-2 pl-2 text-right tnum ${
                    buyin ? (p.netCents > 0 ? 'text-gold' : p.netCents < 0 ? 'text-paper-dim' : 'text-paper') : 'text-paper'
                  }`}
                >
                  {buyin ? formatMoneySigned(p.netCents) : formatMoney(p.winningsCents)}
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
  if (money.mode !== 'buyin') return null
  const nameById = new Map(money.players.map((p) => [p.playerId, p.name]))

  return (
    <section className="mt-8">
      <span className="eyebrow block">Settle up</span>
      {!money.settleable ? (
        <p className="mt-3 text-[0.85rem] text-paper-dim">
          Available once every round is final — the last round is still in play.
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

function Footnotes({ money }: { money: MoneyVM }) {
  return (
    <section className="mt-10 space-y-1 border-t border-hair pt-4 text-[0.75rem] text-paper-faint">
      <p>
        Remainder cents go to the last par 3 of a round (closest to pin) or to the player higher in
        the standings (payouts).
      </p>
      <p>
        Closest-to-pin pots{' '}
        {money.carryMode === 'carry' ? 'carry within a round' : 'are returned when a hole has no winner'}; an
        unclaimed pot at a round’s last par 3 returns to the contributors.
      </p>
    </section>
  )
}
