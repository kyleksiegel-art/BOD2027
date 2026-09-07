import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WireVM } from '@/lib/data/wire'

const ROTATE_MS = 4500

/**
 * The one-line wire under the Standings status line: the newest hole's events, rotating one at a
 * time (Kyle 2026-09-07), with the hole marker and clock fixed. Only the current hole rotates —
 * never older holes — so the strip can't surface stale news over the fresh line. Tapping opens
 * the full Field Report. Two lines max: the news is in the second clause, so it must never be
 * ellipsed away. Reduced-motion users get the static top event.
 */
export function FieldReportStrip({ vm }: { vm: WireVM }) {
  const newest = vm.holes[0]
  const events = newest?.events ?? []
  const [i, setI] = useState(0)
  const reduced = usePrefersReducedMotion()

  // Restart on a new hole (or a changed event count) so the freshest line shows first.
  useEffect(() => setI(0), [newest?.holeNumber, events.length])

  useEffect(() => {
    if (reduced || events.length < 2) return
    const id = window.setInterval(() => setI((n) => (n + 1) % events.length), ROTATE_MS)
    return () => window.clearInterval(id)
  }, [reduced, events.length, newest?.holeNumber])

  if (!newest || events.length === 0 || vm.latestHole === null) return null
  const ev = events[Math.min(i, events.length - 1)]
  const sub = [
    events.length > 1 ? `${Math.min(i, events.length - 1) + 1} of ${events.length}` : null,
    newest.timeLabel,
    vm.live ? 'live' : `round ${vm.roundNumber} final`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link
      to="/standings/wire"
      className="tap mt-3.5 grid min-h-[44px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded border border-hair-strong bg-ground-2 px-3 py-2.5 text-left no-underline"
      aria-label={`Field Report, hole ${vm.latestHole}: ${ev.segs.map((x) => x.text).join('')}`}
      aria-live="off"
    >
      <span className="flex flex-col gap-px border-r border-hair pr-2.5 text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-gold">
        <span>Field</span>
        <span>Report</span>
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="tnum fx-serif-sm flex-none font-display text-[0.8rem] font-semibold text-paper-faint">H{vm.latestHole}</span>
          {/* Keyed on the event so a swap re-mounts the span and runs the fade-in once. */}
          <span key={ev.key} className="wire-swap line-clamp-2 text-[0.9rem] leading-[1.3] text-paper">
            {ev.segs.map((seg, j) =>
              seg.strong ? (
                <strong key={j} className="font-semibold">
                  {seg.text}
                </strong>
              ) : (
                <span key={j}>{seg.text}</span>
              ),
            )}
          </span>
        </span>
        <span className="tnum text-[0.66rem] text-paper-faint">{sub}</span>
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-paper-faint" aria-hidden>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  )
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}
