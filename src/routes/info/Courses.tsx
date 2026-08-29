import { Link } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useCoursesIndex } from '@/lib/data/selectors'
import { courseSlug } from '@/lib/format'

export default function Courses() {
  const courses = useCoursesIndex()

  return (
    <Page>
      <PageHeader eyebrow="The Venue" title="Courses" />

      {!courses ? (
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="mt-8 text-paper-faint">No courses yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {courses.map((c) => (
            <li key={c.id}>
              <Link
                to={c.id}
                data-course={courseSlug(c.name) ?? undefined}
                className="round round-rail tap block rounded-xl border border-hair bg-ground-2 px-4 py-4 transition-colors hover:border-hair-strong"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-[1.2rem] font-semibold text-paper">
                    {c.name}
                  </span>
                  {c.roundNumber !== null && (
                    <span className="flex-none text-[0.72rem] uppercase tracking-[0.12em] text-paper-faint">
                      Round {c.roundNumber}
                      {c.dayLabel ? ` · ${c.dayLabel}` : ''}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[0.85rem] text-paper-dim">{c.architect}</div>
                <div className="mt-2 flex items-center gap-4 text-[0.78rem] text-paper-faint">
                  <span>{c.yearOpened}</span>
                  {c.par !== null && <span>Par {c.par}</span>}
                  {c.totalYardage !== null && (
                    <span className="tnum">{c.totalYardage.toLocaleString()} yds</span>
                  )}
                  {c.isPlaceholder && (
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-gold">
                      Card TBD
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
