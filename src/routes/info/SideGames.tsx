import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'

/**
 * Side games — the cash games that run alongside the championship. Static reference copy only:
 * nothing here is scored, tracked, or settled by the app (Kyle 2026-08-24). It is kept on paper
 * and paid in cash. Written to match the Rules page voice; edit the constants below to change it.
 */

interface Game {
  name: string
  stake: string
  /** How it's played. Plain English. */
  detail: string
  /** Set when a rule still needs confirming, rendered as a muted note. */
  tbd?: string
}

interface Day {
  day: string
  course: string
  games: Game[]
  order?: string
}

const DAYS: Day[] = [
  {
    day: 'Thursday',
    course: 'Streamsong Red',
    games: [
      {
        name: 'Wolf',
        stake: '$2 / hole',
        detail:
          'One player is the Wolf each hole and, after watching the tee shots, either picks a partner or goes it alone against the other three. The hammer (double the stake) stays live until the final ball is on the green.',
      },
    ],
    order: 'Wolf order is oldest to youngest.',
  },
  {
    day: 'Friday',
    course: 'Streamsong Black',
    games: [
      {
        name: '6-6-6 Best Ball',
        stake: '$5 / hole',
        detail:
          'The round splits into three six-hole matches. Each side plays its best ball on the hole; low best ball wins the hole.',
      },
    ],
    order: 'Partners / order set by tee flips.',
  },
  {
    day: 'Saturday',
    course: 'Streamsong Blue',
    games: [
      {
        name: 'Vegas (L/R)',
        stake: '$1 / point',
        detail:
          "Two-man teams. Each side's two scores combine into a two-digit number (low score first); the point spread between the teams is the payout.",
      },
    ],
  },
  {
    day: 'Sunday',
    course: 'Bone Valley',
    games: [
      {
        name: '6-6-6 Scotch',
        stake: '$1 / point',
        detail:
          'Two-man teams over three six-hole matches. Five points on offer each hole — sweep all five and they double.',
      },
    ],
    order: 'Partners / order set by tee flips.',
  },
]

/** The five Scotch points, Sunday. */
const SCOTCH_POINTS: [string, string][] = [
  ['Greens in regulation', 'Two GIRs beat one'],
  ['Low man', 'Lowest individual score'],
  ['Low team', 'Lowest combined score'],
  ['Birdie', 'A birdie on the hole'],
  ['Total team putts', 'Fewest putts as a team'],
]

/** $1 junk that pays every round. */
const JUNK: [string, string][] = [
  ['Sandy', 'Par or better after being in a bunker'],
  ['Barky', 'Par or better after hitting a tree'],
  ['FIRGIR', 'Fairway and green in regulation — and you must make the par'],
  ['CTP', 'Closest to the pin on a par 3 — must make par (same as the round rule)'],
  ['Flaggy', 'A putt made from farther out than the flagstick is long'],
]

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow block">{children}</span>
}

function GameRow({ game }: { game: Game }) {
  return (
    <div className="border-t border-hair py-3.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-display text-[1.14rem] font-semibold text-paper">{game.name}</span>
        <span className="tnum text-[0.9rem] font-semibold text-gold">{game.stake}</span>
      </div>
      <p className="mt-1 text-[0.9rem] leading-relaxed text-paper-dim">{game.detail}</p>
      {game.tbd ? (
        <p className="mt-1 text-[0.78rem] font-semibold uppercase tracking-[0.1em] text-gold-bright">
          {game.tbd}
        </p>
      ) : null}
    </div>
  )
}

export default function SideGames() {
  return (
    <Page>
      <PageHeader eyebrow="On the Side" title="Side Games" />

      <p className="mt-4 text-[0.95rem] leading-relaxed text-paper-dim">
        The cash games that run alongside the championship. These are kept on paper and settled in
        cash — <strong className="font-semibold text-paper">none of it is scored in the app</strong>.
      </p>

      {DAYS.map((d) => (
        <section key={d.day} className="mt-9">
          <Eyebrow>
            {d.day} · <span className="text-paper-dim">{d.course}</span>
          </Eyebrow>
          <div className="mt-3">
            {d.games.map((g) => (
              <GameRow key={g.name} game={g} />
            ))}
          </div>

          {d.day === 'Sunday' ? (
            <div className="mt-3 rounded-lg border border-hair bg-ground-2 p-4">
              <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-paper-faint">
                The five points
              </span>
              <dl className="mt-2 space-y-1.5">
                {SCOTCH_POINTS.map(([name, note]) => (
                  <div key={name} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[0.92rem] text-paper">{name}</dt>
                    <dd className="text-right text-[0.82rem] text-paper-faint">{note}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2.5 border-t border-hair pt-2.5 text-[0.85rem] text-paper-dim">
                Win all five and they double — <span className="tnum text-gold">10 points</span> on
                the hole.
              </p>
            </div>
          ) : null}

          {d.order ? (
            <p className="mt-3 text-[0.82rem] text-paper-faint">{d.order}</p>
          ) : null}
        </section>
      ))}

      {/* Junk — pays every round */}
      <section className="mt-10">
        <Eyebrow>The Shits — $1 each, every round</Eyebrow>
        <dl className="mt-4">
          {JUNK.map(([name, note]) => (
            <div
              key={name}
              className="grid grid-cols-[6.5rem_1fr] items-baseline gap-x-3 border-b border-hair py-3 first:border-t first:border-t-hair-strong"
            >
              <dt className="font-display text-[1rem] font-semibold text-paper">{name}</dt>
              <dd className="text-[0.88rem] leading-relaxed text-paper-dim">{note}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Hole in one */}
      <section className="mt-8">
        <div className="rounded-lg border border-gold/40 bg-gold/10 p-5 text-center">
          <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-gold">
            Ace
          </span>
          <p className="mt-2 font-display text-[1.5rem] font-semibold text-paper">Hole in One</p>
          <p className="mt-1 text-[0.95rem] text-paper-dim">
            <span className="tnum font-semibold text-gold">$100</span> per player to the man who
            makes it.
          </p>
        </div>
      </section>

      <footer className="mt-10 border-t border-hair pt-6 text-center text-[0.7rem] uppercase tracking-[0.14em] text-paper-faint">
        Paid in cash · Not tracked in the app
      </footer>
    </Page>
  )
}
