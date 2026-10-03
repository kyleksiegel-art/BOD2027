import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { StoryEntry, StoryVM } from '@/lib/data/fieldStory'

const ROTATE_MS = 4500
const FEED_MAX = 8 // how many recent story entries the ticker rolls through

/**
 * The one-line wire under the Standings status line — a rolling ticker of the most recent events
 * ACROSS holes (Kyle 2026-09-07: "it's not rotating" — the old version only cycled the newest
 * hole's events, so a quiet hole with one collapsed "No movement" line sat dead; the fix is a
 * genuine feed). Newest first, capped at FEED_MAX, one every ROTATE_MS. Tapping opens the full
 * Field Report. Two lines max: the news is in the second clause, so it must never be ellipsed.
 *
 * Since 2026-10-02 it rolls the Field Report STORY entries (Kyle: "story only"), skipping the
 * scoreline-only turn entry; the marker is the entry's own label ("18th", "3rd–5th").
 *
 * Reduced motion suppresses the fade (the `.wire-swap` keyframes are gated on the media query in
 * index.css), NOT the advance — the changing line is information, not decoration, so it keeps
 * moving. That is the whole point of a ticker.
 */
export function FieldReportStrip({ vm }: { vm: StoryVM }) {
  const feed = useMemo<StoryEntry[]>(() => vm.entries.filter((e) => e.segs.length > 0).slice(0, FEED_MAX), [vm.entries])

  const [i, setI] = useState(0)

  // Always restart at the freshest item when the feed changes (a new hole, a new save).
  const feedKey = feed.map((f) => f.key).join('|')
  useEffect(() => setI(0), [feedKey])

  useEffect(() => {
    if (feed.length < 2) return
    const id = window.setInterval(() => setI((n) => (n + 1) % feed.length), ROTATE_MS)
    return () => window.clearInterval(id)
  }, [feed.length, feedKey])

  if (feed.length === 0) return null
  const idx = i % feed.length
  const item = feed[idx]
  const sub = [
    feed.length > 1 ? `${idx + 1} of ${feed.length}` : null,
    vm.live ? (vm.complete ? 'scores in' : 'live') : `round ${vm.roundNumber} final`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link
      to="/standings/wire"
      className="tap mt-3.5 grid min-h-[44px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded border border-hair-strong bg-ground-2 px-3 py-2.5 text-left no-underline"
      aria-label={`Field Report, ${item.label}: ${item.segs.map((x) => x.text).join('')}`}
      aria-live="off"
    >
      <span className="flex flex-col gap-px border-r border-hair pr-2.5 text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-gold">
        <span>Field</span>
        <span>Report</span>
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="flex min-w-0 items-baseline gap-2">
          {/* Keyed on the item so a swap re-mounts the row: the hole marker AND the line change
              together (feed items come from different holes), and the fade-in runs once. */}
          <span key={item.key} className="wire-swap flex min-w-0 items-baseline gap-2">
            <span className="tnum fx-serif-sm flex-none font-display text-[0.8rem] font-semibold text-paper-faint">
              {item.label}
            </span>
            <span className="line-clamp-2 text-[0.9rem] leading-[1.3] text-paper">
              {item.segs.map((seg, j) =>
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
        </span>
        <span className="tnum text-[0.66rem] text-paper-faint">{sub}</span>
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-paper-faint" aria-hidden>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  )
}
