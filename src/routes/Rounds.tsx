import { Link } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { useRoundsList } from '@/lib/data/selectors'
import { courseSlug, formatDay, formatTeeTime } from '@/lib/format'

export default function Rounds() {
  const rounds = useRoundsList()

  return (
    <Page>
      <PageHeader eyebrow="Four Rounds, Four Days" title="Rounds" />

      {!rounds ? (
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      ) : (
        <ul className="mt-4">
          {rounds.map(({ round, course, leaderName, playerCount }) => (
            <li
              key={round.id}
              className="round"
              data-course={courseSlug(course.name) ?? undefined}
            >
              <Link
                to={`/rounds/${round.round_number}`}
                className="round-rail tap grid grid-cols-[2rem_1fr_auto] items-center gap-x-4 border-b border-hair py-4 pl-3 first:border-t first:border-t-hair-strong"
              >
                <span className="font-display text-[0.8rem] uppercase tracking-[0.15em] text-paper-faint">
                  R{round.round_number}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="fx-serif-sm font-display text-[1.2rem] font-semibold text-paper">
                    {course.name}
                  </span>
                  <span className="tnum text-[0.78rem] text-paper-faint">
                    {formatDay(round.date)}
                    {round.tee_time ? ` · ${formatTeeTime(round.tee_time)}` : ''}
                  </span>
                  <span className="mt-0.5">
                    <StatusBadge status={round.status} />
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1 text-right">
                  {leaderName ? (
                    <>
                      <span className="text-[0.62rem] uppercase tracking-[0.14em] text-paper-faint">
                        {round.status === 'final' ? 'Winner' : 'Leader'}
                      </span>
                      <span className="text-[0.95rem] text-gold-bright">{leaderName}</span>
                    </>
                  ) : (
                    <span className="tnum text-[0.78rem] text-paper-faint">
                      {playerCount ? `${playerCount} playing` : '—'}
                    </span>
                  )}
                  <span aria-hidden className="text-paper-faint">
                    ›
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
