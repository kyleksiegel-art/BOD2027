import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useSetting } from '@/lib/data/selectors'
import { formatMoney } from '@/lib/format'
import { DEFAULT_POINTS_TABLE } from '@/lib/scoring'
import type { PointsTable } from '@/lib/scoring'

interface PurseAmounts {
  buy_in_per_player_cents?: number
  champ_first_cents?: number
  champ_second_cents?: number
  round_winner_cents?: number
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-[1.3rem] font-semibold text-paper">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.95rem] leading-relaxed text-paper-dim">{children}</div>
    </section>
  )
}

export default function Rules() {
  const table = useSetting<PointsTable>('points_table') ?? DEFAULT_POINTS_TABLE
  const allowance = useSetting<number>('allowance') ?? 1
  const cap = useSetting<number>('handicap_cap') ?? 18
  const purse = useSetting<PurseAmounts>('purse_amounts')
  const amt = (cents: number | undefined) =>
    cents && cents > 0 ? ` (${formatMoney(cents)})` : ''

  const rows: [string, number][] = [
    ['Net 3 under par or better', table.threeOrMoreUnder],
    ['Net 2 under (eagle)', table.twoUnder],
    ['Net 1 under (birdie)', table.oneUnder],
    ['Net par', table.level],
    ['Net 1 over (bogey)', table.oneOver],
    ['Net 2 over or worse', table.twoOrMoreOver],
  ]

  return (
    <Page>
      <PageHeader eyebrow="How It Works" title="Rules" />

      <Section title="Format">
        <p>
          Four players, four rounds — one course a day, Thursday through Sunday. Every round is{' '}
          <strong className="font-semibold text-paper">net Stableford</strong>: you earn points per
          hole against your net score, and higher is better. Championship standings are the{' '}
          <strong className="font-semibold text-paper">cumulative</strong> total across every round
          that counts.
        </p>
      </Section>

      <Section title="Points per hole">
        <ul className="divide-y divide-hair rounded-lg border border-hair">
          {rows.map(([label, pts]) => (
            <li key={label} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-paper-dim">{label}</span>
              <span className="tnum font-display text-[1.05rem] font-semibold text-paper">{pts}</span>
            </li>
          ))}
        </ul>
        <p className="text-[0.82rem] text-paper-faint">
          A hole you pick up scores 0 but still counts as played.
        </p>
      </Section>

      <Section title="Handicaps">
        <p>
          Course Handicap = Index × (Slope ÷ 113) + (Course Rating − Par), played at{' '}
          <strong className="font-semibold text-paper">{Math.round(allowance * 100)}% allowance</strong>
          . No playing handicap exceeds{' '}
          <strong className="font-semibold text-paper">{cap}</strong> — the cap is applied last.
          Strokes fall on holes by the course’s stroke index. Handicaps are locked in per round; a
          later index change doesn’t rewrite a round already played.
        </p>
        <p>
          We <strong className="font-semibold text-paper">play off the low handicap</strong>: in
          each round the lowest playing handicap in the group plays as scratch, and everyone else
          gets only the difference. If Adam is an 8 and Kyle a 12, Adam gets 0 strokes and Kyle gets
          4 — on the four hardest holes.
        </p>
      </Section>

      <Section title="The money">
        <p>
          Everyone puts in the same buy-in{amt(purse?.buy_in_per_player_cents)}. That single pot
          funds three payouts:
        </p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>
            <strong className="font-semibold text-paper">1st overall</strong>
            {amt(purse?.champ_first_cents)} — the best cumulative net Stableford across the counting
            rounds.
          </li>
          <li>
            <strong className="font-semibold text-paper">2nd overall</strong>
            {amt(purse?.champ_second_cents)} — the runner-up on the same cumulative total.
          </li>
          <li>
            <strong className="font-semibold text-paper">Round winner</strong>
            {amt(purse?.round_winner_cents)} — paid to the best net Stableford in each individual
            round.
          </li>
        </ul>
        <p>
          Closest to the pin is played and recorded on every par 3: the winner is closest to the pin
          on the green and must make par or better to claim it. It’s for bragging rights — there’s no
          money on it.
        </p>
      </Section>

      <Section title="Ties — Overall Championship">
        <p>
          A tie on total points is broken in this order:
        </p>
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            <strong className="font-semibold text-paper">Best single round</strong> — highest
            one-round total. If equal, second-best, then third.
          </li>
          <li>
            <strong className="font-semibold text-paper">Most holes won outright</strong> — the
            single lowest net score on a hole. A shared low, a pick-up, or an unplayed hole wins
            nothing.
          </li>
          <li>
            <strong className="font-semibold text-paper">Countback</strong> on the latest counting
            round — in the order Round 3, then 4, 2, 1 — summing Stableford points over holes 10–18,
            then 13–18, then 16–18, then the 18th. Higher points win each stage.
          </li>
        </ol>
        <p>
          Only a tie that survives all three is declared level — then those places pool their money
          and split it evenly (two tied for 1st share 1st and 2nd between them).
        </p>
        <p>
          A <strong className="font-semibold text-paper">round winner</strong> tie is broken by a
          countback on that round, then split. A round that’s abandoned is skipped; a round cut short
          counts only the holes everyone finished, and the countback falls back to the last holes
          played.
        </p>
      </Section>
    </Page>
  )
}
