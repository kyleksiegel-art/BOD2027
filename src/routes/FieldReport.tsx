import { Link } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useFieldReport } from '@/lib/data/selectors'
import type { WireEvent } from '@/lib/data/wire'
import { formatDay } from '@/lib/format'

// The recap ribbon's identity palette (gold is status-only; players never wear it as identity
// except via the shared slot order). Kept in step with RoundRecap.PLAYER_COLORS.
const PLAYER_COLORS = ['var(--blue)', 'var(--gold-fill)', 'var(--olive)', 'var(--paper-faint)']

/**
 * The Field Report — the live round as a wire of plain-English events, grouped by hole, newest
 * first. Every line is generated from saved scores by buildFieldReport; nothing is typed.
 */
export default function FieldReport() {
  const vm = useFieldReport()

  if (vm === undefined) {
    return (
      <Page>
        <BackLink />
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      </Page>
    )
  }

  return (
    <Page>
      <BackLink />
      <div className="mt-4">
        <PageHeader
          eyebrow="The Wire"
          title="Field Report"
          meta={vm ? `Round ${vm.roundNumber} · ${vm.courseName} · ${formatDay(vm.dateIso)}` : undefined}
        />
      </div>

      {!vm ? (
        <p className="mt-8 text-paper-dim">Nothing on the wire yet. Events appear as holes are saved.</p>
      ) : (
        <>
          <div
            className={`mt-3 inline-flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] ${
              vm.live ? 'text-gold' : 'text-paper-faint'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${vm.live ? 'live-dot' : 'bg-paper-faint'}`} aria-hidden />
            {vm.live ? `Live · thru ${vm.roundThru} · written from saved holes` : `Round ${vm.roundNumber} final`}
          </div>

          {vm.holes.map((h) => (
            <section key={h.holeNumber} className="mt-6">
              <div className="flex items-baseline gap-2.5">
                <span className="tnum fx-title font-display text-[1.35rem] font-semibold text-paper">Hole {h.holeNumber}</span>
                {h.par !== null && (
                  <span className="tnum text-[0.72rem] text-paper-faint">
                    Par {h.par}
                    {h.strokeIndex !== null ? ` · SI ${h.strokeIndex}` : ''}
                  </span>
                )}
                {h.timeLabel && <span className="tnum ml-auto text-[0.72rem] text-paper-faint">{h.timeLabel}</span>}
              </div>
              <ol className="mt-2.5 border-t border-hair-strong">
                {h.events.map((e) => (
                  <EventRow key={e.key} e={e} />
                ))}
              </ol>
            </section>
          ))}

          <p className="mt-6 text-[0.72rem] leading-relaxed text-paper-faint">
            Every line is written by the app from the scores saved on the Enter screen. Nothing here is typed.
          </p>
        </>
      )}
    </Page>
  )
}

function EventRow({ e }: { e: WireEvent }) {
  const color = e.colorIndex === null ? 'var(--paper-faint)' : PLAYER_COLORS[e.colorIndex % PLAYER_COLORS.length]
  return (
    <li
      className={`grid grid-cols-[auto_1fr] items-start gap-x-3 border-b border-hair py-3 ${
        e.emphasis ? 'leader-row' : 'pl-[0.9rem]'
      }`}
    >
      <span className="mt-1.5 inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} aria-hidden />
      <span className="flex flex-col gap-0.5">
        <span className="text-[1rem] leading-[1.35] text-paper">
          {e.segs.map((seg, i) =>
            seg.strong ? (
              <strong key={i} className="font-semibold">
                {seg.text}
              </strong>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </span>
        <span className="tnum text-[0.7rem] text-paper-faint">{e.meta}</span>
      </span>
    </li>
  )
}

function BackLink() {
  return (
    <Link to="/standings" className="tap -ml-1 inline-flex items-center gap-1 text-[0.8rem] text-paper-faint">
      <span aria-hidden>‹</span> Standings
    </Link>
  )
}
