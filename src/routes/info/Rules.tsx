import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useSetting } from '@/lib/data/selectors'
import { DEFAULT_POINTS_TABLE } from '@/lib/scoring'
import type { PointsTable } from '@/lib/scoring'

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
        <p>The pot splits three ways:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>
            <strong className="font-semibold text-paper">Championship</strong> — the best cumulative
            total over the counting rounds.
          </li>
          <li>
            <strong className="font-semibold text-paper">Round winners</strong> — the best net
            Stableford in each individual round.
          </li>
          <li>
            <strong className="font-semibold text-paper">Closest to the pin</strong> — a per-round
            pot, sized to how many par 3s that course has.
          </li>
        </ul>
      </Section>

      <Section title="Ties">
        <p>
          A tied championship is broken by holes won, then by a countback over the closing holes. A
          round that’s abandoned doesn’t count; a round cut short counts only the holes everyone
          finished.
        </p>
      </Section>
    </Page>
  )
}
