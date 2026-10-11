import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useFieldStory } from '@/lib/data/selectors'
import type { StoryEntry, StoryVM } from '@/lib/data/fieldStory'
import { radioScript } from '@/lib/speech/radioCall'
import { speakLines, speechAvailable, stopSpeaking } from '@/lib/speech/speak'
import { formatDay } from '@/lib/format'

/**
 * The Field Report: the live round as a short story, newest first (buildFieldStory). One or two
 * sentences per hole about what changed; quiet holes folded together; the score at the turn and
 * the finish. Kyle picked it over the old line-per-player wire, which is gone (2026-10-02).
 */
export default function FieldReport() {
  const vm = useFieldStory()

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

          <RadioCall vm={vm} />

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
 * The radio call: the story read out loud by the phone's built-in voice, oldest hole first.
 * Works offline. iOS only starts speech from a tap, and stops it when the phone locks or the
 * app goes to the background — so it's a button, never automatic.
 */
function RadioCall({ vm }: { vm: StoryVM }) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => stopSpeaking, [])
  if (!speechAvailable()) return null

  const toggle = () => {
    if (playing) {
      stopSpeaking()
      setPlaying(false)
      return
    }
    setPlaying(true)
    speakLines(radioScript(vm), () => setPlaying(false))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={playing}
      className="tap mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-hair-strong bg-ground-2 text-[0.95rem] font-semibold text-paper"
    >
      {playing ? (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <rect x="2" y="2" width="10" height="10" rx="1" fill="currentColor" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M3 1.5v11l9.5-5.5z" fill="currentColor" />
        </svg>
      )}
      {playing ? 'Stop the call' : 'Play the call'}
    </button>
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
