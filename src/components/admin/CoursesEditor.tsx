import { useState } from 'react'
import { publishCourse, saveHoleCard, saveTee } from '@/lib/data/admin'
import type { AdminCourseVM } from '@/lib/data/compute'
import type { TeeRow } from '@/lib/data/types'
import { Button, Field, Report, Section, inputClass, num, useAdminAction } from './kit'

/**
 * The course-card editor — in practice, the Bone Valley editor.
 *
 * Round 4 is hard-blocked until this card is complete and validated, so the screen's job
 * is to make "what is still missing" impossible to misread and then to let one person fill
 * it in on hotel wifi on the Saturday night. Entry is per hole rather than one giant grid:
 * a phone can hold one hole's line at a time, and a save that covers one hole is a save
 * you can abandon halfway.
 */

function TeeCard({ tee, disabled }: { tee: TeeRow; disabled: boolean }) {
  const { busy, report, run } = useAdminAction()
  const [rating, setRating] = useState(tee.rating === null ? '' : String(tee.rating))
  const [slope, setSlope] = useState(tee.slope === null ? '' : String(tee.slope))
  const [par, setPar] = useState(String(tee.par))
  const [total, setTotal] = useState(tee.total_yardage === null ? '' : String(tee.total_yardage))

  return (
    <div className="mt-3 rounded-md border border-hair p-3">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-paper">{tee.name}</span>
        {tee.rating === null || tee.slope === null ? (
          <span className="text-[0.75rem] text-gold-bright">No rating / slope</span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Course rating">
          <input className={inputClass} inputMode="decimal" value={rating}
            onChange={(e) => setRating(e.target.value)} disabled={disabled} />
        </Field>
        <Field label="Slope">
          <input className={inputClass} inputMode="numeric" value={slope}
            onChange={(e) => setSlope(e.target.value)} disabled={disabled} />
        </Field>
        <Field label="Par">
          <input className={inputClass} inputMode="numeric" value={par}
            onChange={(e) => setPar(e.target.value)} disabled={disabled} />
        </Field>
        <Field label="Total yardage">
          <input className={inputClass} inputMode="numeric" value={total}
            onChange={(e) => setTotal(e.target.value)} disabled={disabled} />
        </Field>
      </div>
      <div className="mt-3">
        <Button
          disabled={disabled || busy || num(par) === null}
          onClick={() =>
            void run(`${tee.name} saved.`, () =>
              saveTee({
                id: tee.id,
                courseId: tee.course_id,
                name: tee.name,
                rating: num(rating),
                slope: num(slope),
                par: num(par)!,
                totalYardage: num(total),
              }),
            )
          }
        >
          {busy ? 'Saving…' : `Save ${tee.name}`}
        </Button>
      </div>
      <Report report={report} />
    </div>
  )
}

function HoleRowEditor({
  vm,
  holeNumber,
  disabled,
}: {
  vm: AdminCourseVM
  holeNumber: number
  disabled: boolean
}) {
  const entry = vm.holes[holeNumber - 1]
  const row = entry.row
  const { busy, report, run } = useAdminAction()
  const [par, setPar] = useState(row?.par === null || row === null ? '' : String(row.par))
  const [si, setSi] = useState(
    row?.stroke_index === null || row === null ? '' : String(row.stroke_index),
  )
  const [yards, setYards] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      vm.tees.map((t) => {
        const y = row === null ? null : (vm.yardages[`${row.id}|${t.id}`] ?? null)
        return [t.id, y === null ? '' : String(y)]
      }),
    ),
  )

  const complete = par !== '' && si !== '' && vm.tees.every((t) => yards[t.id] !== '')

  return (
    <div className="border-t border-hair py-3">
      <div className="flex items-center justify-between">
        <span className="font-display text-lg text-paper tnum">Hole {holeNumber}</span>
        <span className={`text-[0.72rem] ${complete ? 'text-paper-faint' : 'text-gold-bright'}`}>
          {complete ? 'Complete' : 'Incomplete'}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3">
        <Field label="Par">
          <input className={inputClass} inputMode="numeric" value={par}
            onChange={(e) => setPar(e.target.value)} disabled={disabled} />
        </Field>
        <Field label="Stroke index">
          <input className={inputClass} inputMode="numeric" value={si}
            onChange={(e) => setSi(e.target.value)} disabled={disabled} />
        </Field>
        {vm.tees.map((t) => (
          <Field key={t.id} label={`${t.name} yards`}>
            <input
              className={inputClass}
              inputMode="numeric"
              value={yards[t.id] ?? ''}
              onChange={(e) => setYards((y) => ({ ...y, [t.id]: e.target.value }))}
              disabled={disabled}
            />
          </Field>
        ))}
      </div>

      <div className="mt-3">
        <Button
          disabled={disabled || busy}
          onClick={() =>
            void run(`Hole ${holeNumber} saved.`, () =>
              saveHoleCard(
                vm.course.id,
                holeNumber,
                num(par),
                num(si),
                vm.tees.map((t) => ({ teeId: t.id, yardage: num(yards[t.id] ?? '') })),
              ),
            )
          }
        >
          {busy ? 'Saving…' : `Save hole ${holeNumber}`}
        </Button>
      </div>
      <Report report={report} />
    </div>
  )
}

function CoursePanel({ vm, disabled }: { vm: AdminCourseVM; disabled: boolean }) {
  const { busy, report, run } = useAdminAction()
  const [holesOpen, setHolesOpen] = useState(vm.course.data_is_placeholder)

  return (
    <>
      <Section
        title={vm.course.name}
        meta={vm.course.data_is_placeholder ? 'Placeholder — not scoreable' : 'Published'}
      >
        {vm.issues.length > 0 ? (
          <>
            <p className="mt-3 text-[0.88rem] text-paper-dim">Still missing:</p>
            <ul className="mt-1 space-y-1 text-[0.88rem] text-gold-bright">
              {vm.issues.map((i) => (
                <li key={i}>· {i}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-[0.88rem] text-paper-dim">
            The card is complete.
            {vm.course.data_is_placeholder ? ' Publish it to allow scoring.' : ''}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            tone="primary"
            disabled={disabled || busy}
            onClick={() => void run('Published — this course can now be scored.', () => publishCourse(vm.course.id))}
          >
            {busy ? 'Checking…' : 'Validate & publish'}
          </Button>
          <Button onClick={() => setHolesOpen((o) => !o)} disabled={disabled}>
            {holesOpen ? 'Hide holes' : 'Edit 18 holes'}
          </Button>
        </div>
        <Report report={report} />

        {/* Stated up front, because it is surprising the first time and it stops scoring. */}
        <p className="mt-4 border-t border-hair pt-3 text-[0.78rem] leading-relaxed text-paper-faint">
          Editing any hole un-publishes the card until you validate it again — a card whose
          par just changed is no longer a validated card.
        </p>
      </Section>

      <Section title={`${vm.course.name} — tees`}>
        {vm.tees.length === 0 ? (
          <p className="mt-3 text-[0.88rem] text-gold-bright">This course has no tees.</p>
        ) : (
          vm.tees.map((t) => <TeeCard key={t.id} tee={t} disabled={disabled} />)
        )}
      </Section>

      {holesOpen ? (
        <Section title={`${vm.course.name} — holes`}>
          {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
            <HoleRowEditor key={`${vm.course.id}-${n}`} vm={vm} holeNumber={n} disabled={disabled} />
          ))}
        </Section>
      ) : null}
    </>
  )
}

export function CoursesEditor({ courses, disabled }: { courses: AdminCourseVM[]; disabled: boolean }) {
  const [selected, setSelected] = useState(
    () => courses.find((c) => c.course.data_is_placeholder)?.course.id ?? courses[0]?.course.id,
  )
  const vm = courses.find((c) => c.course.id === selected) ?? courses[0]
  if (!vm) return null

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {courses.map((c) => (
          <button
            key={c.course.id}
            type="button"
            onClick={() => setSelected(c.course.id)}
            className={`tap rounded-md border px-3 py-2 text-left text-[0.82rem] leading-tight ${
              c.course.id === vm.course.id
                ? 'border-gold bg-gold/15 text-paper'
                : 'border-hair text-paper-dim'
            }`}
          >
            <span className="block truncate font-semibold">{c.course.name}</span>
            <span className="block text-[0.72rem] text-paper-faint">
              {c.course.data_is_placeholder ? `${c.issues.length} to fix` : 'Published'}
            </span>
          </button>
        ))}
      </div>
      <CoursePanel key={vm.course.id} vm={vm} disabled={disabled} />
    </>
  )
}
