import { Link, useParams } from 'react-router-dom'
import { Page } from '@/components/Page'
import { useCourseDetail } from '@/lib/data/selectors'

const dash = <span className="text-paper-faint">—</span>

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>()
  const { vm, loading } = useCourseDetail(courseId)

  if (loading) {
    return (
      <Page>
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      </Page>
    )
  }

  if (!vm) {
    return (
      <Page>
        <p className="mt-8 text-paper-faint">Course not found.</p>
        <Link to="/info/courses" className="mt-4 inline-block text-[0.85rem] text-gold">
          ← All courses
        </Link>
      </Page>
    )
  }

  const { course, tees, holes } = vm

  return (
    <Page>
      <Link
        to="/info/courses"
        className="text-[0.75rem] uppercase tracking-[0.12em] text-paper-faint hover:text-paper-dim"
      >
        ← Courses
      </Link>

      <header className="mt-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-paper">
          {course.name}
        </h1>
        <div className="mt-2 text-[0.9rem] text-paper-dim">
          {course.architect} · {course.year_opened}
        </div>
        {(vm.roundNumber !== null || vm.dayLabel) && (
          <div className="mt-1 text-[0.82rem] text-paper-faint">
            {vm.roundNumber !== null ? `Round ${vm.roundNumber}` : null}
            {vm.dayLabel ? ` · ${vm.dayLabel}` : ''}
            {vm.teeTime ? ` · ${vm.teeTime}` : ''}
          </div>
        )}
        <hr className="mt-5 border-hair" />
      </header>

      {course.description && (
        <p className="mt-5 text-[0.95rem] leading-relaxed text-paper-dim">{course.description}</p>
      )}

      {vm.isPlaceholder && (
        <p className="mt-5 rounded-lg border border-gold/30 bg-gold/10 px-4 py-3 text-[0.85rem] text-gold">
          The scorecard for this course hasn’t been published yet.
        </p>
      )}

      {/* Tees */}
      {tees.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-[1.2rem] font-semibold text-paper">Tees</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-[0.85rem]">
              <thead>
                <tr className="border-b border-hair-strong text-left text-[0.68rem] uppercase tracking-[0.1em] text-paper-faint">
                  <th className="py-2 pr-3 font-semibold">Tee</th>
                  <th className="py-2 pr-3 text-right font-semibold">Rating</th>
                  <th className="py-2 pr-3 text-right font-semibold">Slope</th>
                  <th className="py-2 pr-3 text-right font-semibold">Par</th>
                  <th className="py-2 text-right font-semibold">Yards</th>
                </tr>
              </thead>
              <tbody>
                {tees.map((t) => (
                  <tr key={t.id} className="border-b border-hair">
                    <td className="py-2 pr-3 text-paper">{t.name}</td>
                    <td className="tnum py-2 pr-3 text-right text-paper-dim">
                      {t.rating ?? dash}
                    </td>
                    <td className="tnum py-2 pr-3 text-right text-paper-dim">{t.slope ?? dash}</td>
                    <td className="tnum py-2 pr-3 text-right text-paper-dim">{t.par}</td>
                    <td className="tnum py-2 text-right text-paper">
                      {t.totalYardage !== null ? t.totalYardage.toLocaleString() : dash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Scorecard */}
      <section className="mt-8">
        <h2 className="font-display text-[1.2rem] font-semibold text-paper">Scorecard</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[0.82rem]">
            <thead>
              <tr className="border-b border-hair-strong text-[0.68rem] uppercase tracking-[0.1em] text-paper-faint">
                <th className="py-2 pr-2 text-left font-semibold">Hole</th>
                <th className="py-2 pr-2 text-right font-semibold">Par</th>
                <th className="py-2 pr-2 text-right font-semibold">SI</th>
                {tees.map((t) => (
                  <th key={t.id} className="py-2 pl-2 text-right font-semibold">
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holes.map((h) => (
                <tr key={h.holeNumber} className="border-b border-hair">
                  <td className="tnum py-1.5 pr-2 text-left text-paper-dim">{h.holeNumber}</td>
                  <td className="tnum py-1.5 pr-2 text-right text-paper">{h.par ?? dash}</td>
                  <td className="tnum py-1.5 pr-2 text-right text-paper-faint">
                    {h.strokeIndex ?? dash}
                  </td>
                  {tees.map((t) => (
                    <td key={t.id} className="tnum py-1.5 pl-2 text-right text-paper-dim">
                      {h.yardageByTee[t.id] ?? dash}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-hair-strong text-[0.78rem] font-semibold text-paper">
                <td className="py-2 pr-2 text-left">Total</td>
                <td className="tnum py-2 pr-2 text-right">
                  {tees[0] ? tees[0].par : dash}
                </td>
                <td className="py-2 pr-2" />
                {tees.map((t) => (
                  <td key={t.id} className="tnum py-2 pl-2 text-right">
                    {t.totalYardage !== null ? t.totalYardage.toLocaleString() : dash}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </Page>
  )
}
