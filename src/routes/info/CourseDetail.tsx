import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Page } from '@/components/Page'
import { useCourseDetail } from '@/lib/data/selectors'
import { courseSlug } from '@/lib/format'
import { COURSE_EDITORIAL } from '@/config/courseEditorial'

const dash = <span className="text-paper-faint">—</span>

/** Accent-color plate used whenever a photo is absent or fails to load — same look for the
 *  hero and the hole bands so a photoless course reads as intentional, not broken. */
function AccentPlate() {
  return (
    <div
      className="absolute inset-0"
      style={{
        background:
          'linear-gradient(150deg, color-mix(in srgb, var(--course, var(--paper-dim)) 90%, black) 0%, color-mix(in srgb, var(--course, var(--paper-dim)) 58%, black) 100%)',
      }}
    />
  )
}

/**
 * Responsive <picture> for a local course photo, with the same AVIF→WebP→JPG fallback chain
 * and fetch-failure recovery as the Home masthead (Home.tsx §HeroPhoto): on the <img>'s
 * onError we drop the <source>s and fall through to the JPG; if that fails too we show the
 * AccentPlate. `base` is '<folder>/<name>' under /assets/courses/. Returns the AccentPlate
 * outright when no photo has been supplied (base undefined) — no 404, no broken image.
 */
function CoursePhoto({
  base,
  alt,
  sizes,
  className = 'absolute inset-0 h-full w-full object-cover',
}: {
  base?: string
  alt: string
  sizes: string
  className?: string
}) {
  const [sourcesFailed, setSourcesFailed] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)

  if (!base || imgFailed) return <AccentPlate />

  const p = `/assets/courses/${base}`
  return (
    <picture>
      {!sourcesFailed && (
        <>
          <source
            type="image/avif"
            srcSet={`${p}-640.avif 640w, ${p}-1080.avif 1080w, ${p}-1600.avif 1600w`}
            sizes={sizes}
          />
          <source
            type="image/webp"
            srcSet={`${p}-640.webp 640w, ${p}-1080.webp 1080w, ${p}-1600.webp 1600w`}
            sizes={sizes}
          />
        </>
      )}
      <img
        src={`${p}.jpg`}
        alt={alt}
        className={className}
        decoding="async"
        loading="lazy"
        onError={() => (sourcesFailed ? setImgFailed(true) : setSourcesFailed(true))}
      />
    </picture>
  )
}

/** Full-bleed course hero with round identity overlaid near the bottom (no card). */
function CourseHero({
  heroBase,
  alt,
  slug,
  courseName,
  eyebrow,
  architect,
  yearOpened,
}: {
  heroBase?: string
  alt?: string
  slug: ReturnType<typeof courseSlug>
  courseName: string
  eyebrow: string | null
  architect: string
  yearOpened: number
}) {
  return (
    <header
      className="round relative flex aspect-[16/9] max-h-[62vh] min-h-[280px] w-full flex-col justify-end overflow-hidden sm:aspect-[5/2]"
      data-course={slug ?? undefined}
    >
      <CoursePhoto base={heroBase} alt={alt ?? courseName} sizes="100vw" />

      {/* Scrim — darkens the base for the overlaid identity, dissolves into the page ground. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(16,14,10,0.30) 0%, rgba(16,14,10,0.05) 34%, rgba(16,14,10,0.10) 55%, rgba(16,14,10,0.78) 88%, var(--ground) 100%)',
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-[720px] px-5 pb-6">
        {eyebrow && (
          <span
            className="block text-[0.66rem] font-semibold uppercase tracking-[0.22em]"
            style={{ color: '#e6a442' }}
          >
            {eyebrow}
          </span>
        )}
        <h1 className="fx-head mt-1.5 font-display text-[clamp(2rem,8.5vw,3.4rem)] font-semibold leading-[0.96] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.5)]">
          {courseName}
        </h1>
        <p className="mt-1.5 text-[0.85rem] text-[#f0e9db] [text-shadow:0_1px_10px_rgba(0,0,0,0.5)]">
          {architect} · {yearOpened}
        </p>
      </div>
    </header>
  )
}

/** Compact editorial facts row — hairline-divided, never a card. Only renders facts
 *  that have real data behind them. */
function QuickFacts({ items }: { items: { label: string; value: string }[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-6 flex flex-wrap gap-y-3 border-y border-hair py-3.5">
      {items.map((f, i) => (
        <div
          key={f.label}
          className={`flex min-w-[33%] flex-col px-3.5 sm:min-w-0 sm:flex-1 ${
            i === 0 ? 'pl-0' : 'border-l border-hair'
          }`}
        >
          <span className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">
            {f.label}
          </span>
          <span className="fx-serif-sm tnum mt-0.5 font-display text-[1.1rem] text-paper">
            {f.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>()
  const { vm, loading } = useCourseDetail(courseId)

  // Hooks must run unconditionally — declared before the early returns. The selected
  // scorecard tee (mobile single-column view). Initialised lazily once the VM resolves.
  const [selectedTee, setSelectedTee] = useState<string | null>(null)

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
  const slug = courseSlug(course.name)
  const editorial = slug ? COURSE_EDITORIAL[slug] : null

  // Default scorecard column: the tee the group plays this round, else a middle tee
  // (tees are sorted longest-first), else the first tee. Never the championship back
  // tee by default — that's rarely what four members actually play.
  const fallbackTee = tees[Math.floor(tees.length / 2)]?.id ?? tees[0]?.id ?? null
  const activeTee = (selectedTee ?? vm.groupTeeId ?? fallbackTee) as string | null

  // Overlay eyebrow: ROUND 1 · THU, FEB 4 · 1:10 PM  (built from existing VM fields only).
  const eyebrowParts = [
    vm.roundNumber !== null ? `Round ${vm.roundNumber}` : null,
    vm.dayLabel,
    vm.teeTime?.replace(/ ET$/, ''),
  ].filter(Boolean) as string[]
  const eyebrow = eyebrowParts.length > 0 ? eyebrowParts.join(' · ').toUpperCase() : null

  // Quick facts — real course/tee/round data. Par/yardage/rating come from the tee the
  // group plays (activeTee) so the headline numbers match the default scorecard column.
  const factTee = tees.find((t) => t.id === activeTee) ?? tees[0]
  const facts: { label: string; value: string }[] = []
  if (factTee?.par != null) facts.push({ label: 'Par', value: String(factTee.par) })
  if (factTee?.totalYardage != null)
    facts.push({ label: `${factTee.name} yds`, value: factTee.totalYardage.toLocaleString() })
  if (factTee?.rating != null && factTee?.slope != null)
    facts.push({ label: 'Rating / Slope', value: `${factTee.rating} / ${factTee.slope}` })
  if (vm.roundNumber !== null) facts.push({ label: 'Round', value: String(vm.roundNumber) })
  if (vm.teeTime) facts.push({ label: 'Tee time', value: vm.teeTime.replace(/ ET$/, '') })

  return (
    <div>
      {/* Back link — above the photo, in the content column (not overlaid). */}
      <div className="mx-auto w-full max-w-[720px] px-5 pt-4">
        <Link
          to="/info/courses"
          className="text-[0.75rem] uppercase tracking-[0.12em] text-paper-faint hover:text-paper-dim"
        >
          ← Courses
        </Link>
      </div>

      <div className="mt-2.5">
        <CourseHero
          heroBase={editorial?.heroImage ? `${editorial.heroImage}/hero` : undefined}
          alt={editorial?.heroAlt}
          slug={slug}
          courseName={course.name}
          eyebrow={eyebrow}
          architect={course.architect}
          yearOpened={course.year_opened}
        />
      </div>

      {/* Editorial column */}
      <div className="mx-auto w-full max-w-[720px] px-5 pb-10">
        {/* Tagline — magazine intro copy, larger and looser than body. */}
        {editorial?.tagline && (
          <p className="fx-title mt-5 font-display text-[clamp(1.2rem,4.8vw,1.6rem)] font-medium leading-snug text-paper">
            {editorial.tagline}
          </p>
        )}

        {/* DB description — only if it adds detail beyond the tagline (setting vs strategy). */}
        {course.description && (
          <p className="mt-3.5 text-[0.92rem] leading-relaxed text-paper-dim">
            {course.description}
          </p>
        )}

        {editorial?.summary && (
          <p className="mt-3 text-[0.92rem] leading-relaxed text-paper-dim">{editorial.summary}</p>
        )}

        {vm.isPlaceholder && (
          <p className="mt-4 border-l-2 border-gold/40 pl-4 text-[0.85rem] text-gold">
            The scorecard for this course hasn’t been published yet.
          </p>
        )}

        <QuickFacts items={facts} />

        {/* Holes to Know */}
        <section className="mt-9">
          <h2 className="eyebrow">Holes to Know</h2>
          {editorial && editorial.holesToKnow.length > 0 ? (
            <div className="mt-3 grid gap-x-7 gap-y-5 sm:grid-cols-2">
              {editorial.holesToKnow.map((h) => (
                <article key={h.hole} className="grid grid-cols-[auto_1fr] gap-x-4">
                  {/* Large hole-number treatment — the editorial anchor, no photo. */}
                  <div className="flex flex-col">
                    <span className="text-[0.55rem] font-semibold uppercase tracking-[0.2em] text-paper-faint">
                      Hole
                    </span>
                    <span className="fx-display tnum font-display text-[2.4rem] font-semibold leading-[0.85] text-paper">
                      {h.hole}
                    </span>
                  </div>
                  <div>
                    <h3 className="fx-serif-sm font-display text-[1.08rem] font-semibold leading-tight text-paper">
                      {h.title}
                    </h3>
                    <p className="mt-1 text-[0.88rem] leading-relaxed text-paper-dim">
                      {h.description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[0.9rem] leading-relaxed text-paper-dim">
              Still under wraps. We’ll add our targets once the full course guide is published.
            </p>
          )}
        </section>

        {/* ── Transition into the official scorecard half ── */}
        <hr className="mt-9 border-hair" />

        {/* Tees */}
        {tees.length > 0 && (
          <section className="mt-8">
            <h2 className="eyebrow">Tees</h2>
            <p className="mt-1 text-[0.72rem] text-paper-faint sm:hidden">
              Tap a tee to set the scorecard yardages below.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[0.85rem]">
                <thead>
                  <tr className="border-b border-hair-strong text-left text-[0.66rem] uppercase tracking-[0.1em] text-paper-faint">
                    <th className="py-1.5 pr-3 font-semibold">Tee</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Rating</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Slope</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Par</th>
                    <th className="py-1.5 text-right font-semibold">Yards</th>
                  </tr>
                </thead>
                <tbody>
                  {tees.map((t) => {
                    const active = t.id === activeTee
                    // The Tees table IS the scorecard's tee picker — tap a row to switch the
                    // yardage column shown below (on phones) and highlight the tee. Active row
                    // gets a neutral raised-surface emphasis (never gold — gold is reserved for
                    // leader/winner status, CLAUDE.md §Conventions).
                    return (
                      <tr
                        key={t.id}
                        onClick={() => setSelectedTee(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedTee(t.id)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={active}
                        aria-label={`Show ${t.name} tee yardages on the scorecard`}
                        className={`cursor-pointer border-b border-hair transition-colors ${
                          active ? 'bg-ground-2' : 'hover:bg-ground-2/60'
                        }`}
                      >
                        <td className={`py-2.5 pr-3 text-paper ${active ? 'font-semibold' : ''}`}>
                          {t.name}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right text-paper-dim">
                          {t.rating ?? dash}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right text-paper-dim">
                          {t.slope ?? dash}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right text-paper-dim">{t.par}</td>
                        <td className="tnum py-2.5 text-right text-paper">
                          {t.totalYardage !== null ? t.totalYardage.toLocaleString() : dash}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Scorecard */}
        <section className="mt-8">
          <h2 className="eyebrow">Scorecard</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-[0.82rem]">
              <thead>
                <tr className="border-b border-hair-strong text-[0.66rem] uppercase tracking-[0.1em] text-paper-faint">
                  <th className="py-1.5 pr-2 text-left font-semibold">Hole</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Par</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">SI</th>
                  {tees.map((t) => (
                    <th
                      key={t.id}
                      className={`py-1.5 pl-2 text-right font-semibold ${
                        t.id === activeTee ? '' : 'hidden sm:table-cell'
                      }`}
                    >
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
                      <td
                        key={t.id}
                        className={`tnum py-1.5 pl-2 text-right text-paper-dim ${
                          t.id === activeTee ? '' : 'hidden sm:table-cell'
                        }`}
                      >
                        {h.yardageByTee[t.id] ?? dash}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-hair-strong text-[0.78rem] font-semibold text-paper">
                  <td className="py-1.5 pr-2 text-left">Total</td>
                  <td className="tnum py-1.5 pr-2 text-right">{tees[0] ? tees[0].par : dash}</td>
                  <td className="py-1.5 pr-2" />
                  {tees.map((t) => (
                    <td
                      key={t.id}
                      className={`tnum py-1.5 pl-2 text-right ${
                        t.id === activeTee ? '' : 'hidden sm:table-cell'
                      }`}
                    >
                      {t.totalYardage !== null ? t.totalYardage.toLocaleString() : dash}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
