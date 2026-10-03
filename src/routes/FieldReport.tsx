import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useFieldReport, useFieldStory } from '@/lib/data/selectors'
import type { StoryEntry } from '@/lib/data/fieldStory'
import type { WireEvent } from '@/lib/data/wire'
import { formatDay } from '@/lib/format'

// The recap ribbon's identity palette (gold is status-only; players never wear it as identity
// except via the shared slot order). Kept in step with RoundRecap.PLAYER_COLORS.
const PLAYER_COLORS = ['var(--blue)', 'var(--gold-fill)', 'var(--olive)', 'var(--paper-faint)']

/**
 * The Field Report: the live round, newest first, in two views. "Story" (default, buildFieldStory)
 * is one or two sentences per hole about what changed; "Every hole" (buildFieldReport) is the
 * original line-per-player wire. Both are generated from saved scores.
 */
export default function FieldReport() {
  const vm = useFieldReport()
  const story = useFieldStory()
  const [view, setView] = useState<'story' | 'holes'>('story')

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
            {!vm.live
              ? `Round ${vm.roundNumber} final`
              : vm.complete
                ? 'Scores in · awaiting sign-off'
                : `Live · thru ${vm.roundThru}`}
          </div>

          <div className="mt-4">
            <ViewToggle view={view} setView={setView} />
          </div>

          {view === 'story' && story ? (
            <ol className="mt-4 border-t border-hair-strong">
              {story.entries.map((e) => (
                <StoryRow key={e.key} e={e} />
              ))}
            </ol>
          ) : (
          vm.holes.map((h) => (
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
          ))
          )}
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

function ViewToggle({ view, setView }: { view: 'story' | 'holes'; setView: (v: 'story' | 'holes') => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-hair-strong text-[0.68rem]" role="group" aria-label="Field Report view">
      {(['story', 'holes'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => setView(v)}
          className={`min-h-[44px] px-4 font-semibold uppercase tracking-[0.1em] ${
            view === v ? 'bg-gold/20 text-gold-bright' : 'text-paper-faint'
          }`}
        >
          {v === 'story' ? 'Story' : 'Every hole'}
        </button>
      ))}
    </div>
  )
}

function StoryRow({ e }: { e: StoryEntry }) {
  return (
    <li
      className={`grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 border-b border-hair py-3 ${
        e.emphasis ? 'leader-row' : 'pl-[0.9rem]'
      }`}
    >
      <span className="tnum fx-serif-sm font-display text-[1rem] font-semibold text-paper">{e.label}</span>
      <span className="flex flex-col gap-1">
        {e.segs.length > 0 && (
          <span className={`text-[1rem] leading-[1.4] ${e.kind === 'partial' ? 'text-paper-dim' : 'text-paper'}`}>
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
        )}
        {e.scoreline && <span className="tnum text-[0.85rem] italic text-paper-dim">{e.scoreline}</span>}
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
