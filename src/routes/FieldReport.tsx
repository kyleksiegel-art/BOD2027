import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useFieldStory, useRadioCall } from '@/lib/data/selectors'
import type { StoryEntry } from '@/lib/data/fieldStory'
import { speakLines, speechAvailable, stopSpeaking } from '@/lib/speech/speak'
import { formatDay } from '@/lib/format'

/**
 * The Field Report: the live round as a short story, newest first (buildFieldStory). One or two
 * sentences per hole about what changed; quiet holes folded together; the score at the turn and
 * the finish. Kyle picked it over the old line-per-player wire, which is gone (2026-10-02).
 */
export default function FieldReport() {
  const vm = useFieldStory()
  const secretTap = useSecretCall()

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
      <div className="mt-4 select-none [touch-action:manipulation]" onClick={secretTap}>
        <PageHeader
          eyebrow="The Wire"
          title="Field Report"
          meta={vm ? `Round ${vm.roundNumber} · ${vm.courseName} · ${formatDay(vm.dateIso)}` : undefined}
        />
      </div>

      {!vm ? (
        <p className="mt-8 text-paper-dim">Nothing yet. The story starts once the first hole is saved.</p>
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

          <ol className="mt-4 border-t border-hair-strong">
            {vm.entries.map((e) => (
              <StoryRow key={e.key} e={e} />
            ))}
          </ol>
        </>
      )}
    </Page>
  )
}

/**
 * The radio call's secret trigger (Kyle 2026-10-11, "bust this out without them knowing"): a
 * triple tap on the page title starts the call; another triple tap stops it. No button, no hint.
 * iOS only starts speech inside a tap, which the third tap is. Stops when the page unmounts.
 */
function useSecretCall() {
  const call = useRadioCall()
  const taps = useRef<number[]>([])
  const playing = useRef(false)
  useEffect(() => stopSpeaking, [])
  return () => {
    const now = Date.now()
    taps.current = [...taps.current.filter((t) => now - t < 700), now]
    if (taps.current.length < 3) return
    taps.current = []
    if (playing.current) {
      playing.current = false
      stopSpeaking()
      return
    }
    if (!call || !speechAvailable()) return
    playing.current = true
    speakLines(call.script(), () => {
      playing.current = false
    })
  }
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

/** Back to wherever it was opened from: Home's live "Field report" button passes
 *  `state.from = 'home'`; the Standings ticker, a shared link or a cold start go to Standings. */
function BackLink() {
  const fromHome = (useLocation().state as { from?: string } | null)?.from === 'home'
  return (
    <Link
      to={fromHome ? '/' : '/standings'}
      className="tap -ml-1 inline-flex items-center gap-1 text-[0.8rem] text-paper-faint"
    >
      <span aria-hidden>‹</span> {fromHome ? 'Home' : 'Standings'}
    </Link>
  )
}
