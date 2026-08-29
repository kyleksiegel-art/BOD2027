import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Page } from '@/components/Page'
import { useCourseDetail } from '@/lib/data/selectors'
import { courseSlug } from '@/lib/format'
import { COURSE_EDITORIAL } from '@/config/courseEditorial'

const dash = <span className="text-paper-faint">—</span>

/**
 * Full-bleed course hero. When a local photo exists (public/assets/courses/<img>/hero.*)
 * it renders a responsive <picture> with the same AVIF→WebP→JPG fallback chain and
 * fetch-failure recovery as the Home masthead (Home.tsx §HeroPhoto). When no photo has
 * been supplied yet it renders a graceful typographic panel in the course's accent color
 * instead — no broken <img>, no stock photo. Course identity is overlaid near the bottom
 * over a scrim (Option A), no card.
 */
function CourseHero({
  img,
  alt,
  slug,
  courseName,
  eyebrow,
  architect,
  yearOpened,
}: {
  img?: string
  alt?: string
  slug: ReturnType<typeof courseSlug>
  courseName: string
  eyebrow: string | null
  architect: string
  yearOpened: number
}) {
  const [sourcesFailed, setSourcesFailed] = useState(false)
  const hasPhoto = Boolean(img)

  return (
    <header
      className="round relative flex aspect-[16/9] max-h-[68vh] min-h-[300px] w-full flex-col justify-end overflow-hidden sm:aspect-[2/1]"
      data-course={slug ?? undefined}
    >
      {hasPhoto ? (
        <picture>
          {!sourcesFailed && (
            <>
              <source
                type="image/avif"
                srcSet={`/assets/courses/${img}/hero-640.avif 640w, /assets/courses/${img}/hero-1080.avif 1080w, /assets/courses/${img}/hero-1600.avif 1600w`}
                sizes="100vw"
              />
              <source
                type="image/webp"
                srcSet={`/assets/courses/${img}/hero-640.webp 640w, /assets/courses/${img}/hero-1080.webp 1080w, /assets/courses/${img}/hero-1600.webp 1600w`}
                sizes="100vw"
              />
            </>
          )}
          <img
            src={`/assets/courses/${img}/hero.jpg`}
            alt={alt ?? courseName}
            className="absolute inset-0 h-full w-full object-cover"
            decoding="async"
            onError={() => setSourcesFailed(true)}
          />
        </picture>
      ) : (
        // Graceful fallback — an accent color plate in the course's identity color. The
        // overlaid name below carries the identity, so the plate stays clean (no duplicate
        // title). Swap in a photo by dropping public/assets/courses/<slug>/hero.jpg and
        // setting heroImage in courseEditorial.ts.
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(150deg, color-mix(in srgb, var(--course, var(--paper-dim)) 90%, black) 0%, color-mix(in srgb, var(--course, var(--paper-dim)) 58%, black) 100%)',
          }}
        />
      )}

      {/* Scrim — darkens the base for the overlaid identity, dissolves into the page ground. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(16,14,10,0.30) 0%, rgba(16,14,10,0.05) 34%, rgba(16,14,10,0.10) 55%, rgba(16,14,10,0.78) 88%, var(--ground) 100%)',
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-[720px] px-5 pb-7">
        {eyebrow && (
          <span
            className="block text-[0.68rem] font-semibold uppercase tracking-[0.22em]"
            style={{ color: '#e6a442' }}
          >
            {eyebrow}
          </span>
        )}
        <h1 className="fx-head mt-2 font-display text-[clamp(2.1rem,9vw,3.6rem)] font-semibold leading-[0.96] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.5)]">
          {courseName}
        </h1>
        <p className="mt-2 text-[0.9rem] text-[#f0e9db] [text-shadow:0_1px_10px_rgba(0,0,0,0.5)]">
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
    <div className="mt-8 flex flex-wrap gap-y-4 border-y border-hair py-4">
      {items.map((f, i) => (
        <div
          key={f.label}
          className={`flex min-w-[33%] flex-col px-4 sm:min-w-0 sm:flex-1 ${
            i === 0 ? 'pl-0' : 'border-l border-hair'
          }`}
        >
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-paper-faint">
            {f.label}
          </span>
          <span className="fx-serif-sm tnum mt-1 font-display text-[1.15rem] text-paper">
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

  // Overlay eyebrow: ROUND 1 · THU, FEB 4 · 1:10 PM  (built from existing VM fields only).
  const eyebrowParts = [
    vm.roundNumber !== null ? `Round ${vm.roundNumber}` : null,
    vm.dayLabel,
    vm.teeTime?.replace(/ ET$/, ''),
  ].filter(Boolean) as string[]
  const eyebrow = eyebrowParts.length > 0 ? eyebrowParts.join(' · ').toUpperCase() : null

  // Quick facts — real course/tee/round data, longest (reference) tee for the card numbers.
  const refTee = tees[0]
  const facts: { label: string; value: string }[] = []
  if (refTee?.par != null) facts.push({ label: 'Par', value: String(refTee.par) })
  if (refTee?.totalYardage != null)
    facts.push({ label: `${refTee.name} yds`, value: refTee.totalYardage.toLocaleString() })
  if (refTee?.rating != null && refTee?.slope != null)
    facts.push({ label: 'Rating / Slope', value: `${refTee.rating} / ${refTee.slope}` })
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

      <div className="mt-3">
        <CourseHero
          img={editorial?.heroImage}
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
          <p className="fx-title mt-7 font-display text-[clamp(1.25rem,5.2vw,1.7rem)] font-medium leading-snug text-paper">
            {editorial.tagline}
          </p>
        )}

        {/* DB description — only if it adds detail beyond the tagline (setting vs strategy). */}
        {course.description && (
          <p className="mt-5 text-[0.95rem] leading-relaxed text-paper-dim">{course.description}</p>
        )}

        {editorial?.summary && (
          <p className="mt-4 text-[0.95rem] leading-relaxed text-paper-dim">{editorial.summary}</p>
        )}

        {vm.isPlaceholder && (
          <p className="mt-5 border-l-2 border-gold/40 pl-4 text-[0.85rem] text-gold">
            The scorecard for this course hasn’t been published yet.
          </p>
        )}

        <QuickFacts items={facts} />

        {/* Holes to Know */}
        <section className="mt-12">
          <h2 className="eyebrow">Holes to Know</h2>
          {editorial && editorial.holesToKnow.length > 0 ? (
            <div className="mt-5">
              {editorial.holesToKnow.map((h, i) => (
                <article
                  key={h.hole}
                  className={`grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 py-6 ${
                    i > 0 ? 'border-t border-hair' : ''
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-paper-faint">
                      Hole
                    </span>
                    <span className="fx-display tnum font-display text-[2.6rem] font-semibold leading-none text-paper">
                      {h.hole}
                    </span>
                  </div>
                  <div>
                    <h3 className="fx-serif-sm font-display text-[1.2rem] font-semibold leading-tight text-paper">
                      {h.title}
                    </h3>
                    <p className="mt-2 text-[0.92rem] leading-relaxed text-paper-dim">
                      {h.description}
                    </p>
                  </div>
                  {h.image && editorial.heroImage && (
                    <img
                      src={`/assets/courses/${editorial.heroImage}/${h.image}.jpg`}
                      alt={h.imageAlt ?? `Streamsong ${course.name}, hole ${h.hole}`}
                      className="col-span-2 mt-2 aspect-[16/9] w-full rounded-sm object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-[0.92rem] leading-relaxed text-paper-dim">
              Still under wraps. We’ll add our targets once the full course guide is published.
            </p>
          )}
        </section>

        {/* ── Transition into the official scorecard half ── */}
        <hr className="mt-12 border-hair" />

        {/* Tees */}
        {tees.length > 0 && (
          <section className="mt-10">
            <h2 className="eyebrow">Tees</h2>
            <div className="mt-4 overflow-x-auto">
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
        <section className="mt-10">
          <h2 className="eyebrow">Scorecard</h2>
          <div className="mt-4 overflow-x-auto">
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
                  <td className="tnum py-2 pr-2 text-right">{tees[0] ? tees[0].par : dash}</td>
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
      </div>
    </div>
  )
}
