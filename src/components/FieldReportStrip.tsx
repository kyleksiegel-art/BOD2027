import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WireEvent, WireVM } from '@/lib/data/wire'

const ROTATE_MS = 4500
const FEED_MAX = 8 // how many recent events the ticker rolls through

/** One item in the rolling feed: an event plus which hole and clock it came from. */
interface FeedItem {
  holeNumber: number
  timeLabel: string | null
  ev: WireEvent
}

/**
 * The one-line wire under the Standings status line — a rolling ticker of the most recent events
 * ACROSS holes (Kyle 2026-09-07: "it's not rotating" — the old version only cycled the newest
 * hole's events, so a quiet hole with one collapsed "No movement" line sat dead; the fix is a
 * genuine feed). Newest first, capped at FEED_MAX, one every ROTATE_MS. Tapping opens the full
 * Field Report. Two lines max: the news is in the second clause, so it must never be ellipsed.
 *
 * Reduced motion suppresses the fade (the `.wire-swap` keyframes are gated on the media query in
 * index.css), NOT the advance — the changing line is information, not decoration, so it keeps
 * moving. That is the whole point of a ticker.
 */
export function FieldReportStrip({ vm }: { vm: WireVM }) {
  const feed = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = []
    for (const h of vm.holes) {
      for (const ev of h.events) {
        out.push({ holeNumber: h.holeNumber, timeLabel: h.timeLabel, ev })
        if (out.length >= FEED_MAX) return out
      }
    }
    return out
  }, [vm.holes])

  const [i, setI] = useState(0)

  // Always restart at the freshest item when the feed changes (a new hole, a new save).
  const feedKey = feed.map((f) => f.ev.key).join('|')
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
    item.timeLabel,
    vm.live ? 'live' : `round ${vm.roundNumber} final`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link
      to="/standings/wire"
      className="tap mt-3.5 grid min-h-[44px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded border border-hair-strong bg-ground-2 px-3 py-2.5 text-left no-underline"
      aria-label={`Field Report, hole ${item.holeNumber}: ${item.ev.segs.map((x) => x.text).join('')}`}
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
          <span key={item.ev.key} className="wire-swap flex min-w-0 items-baseline gap-2">
            <span className="tnum fx-serif-sm flex-none font-display text-[0.8rem] font-semibold text-paper-faint">
              H{item.holeNumber}
            </span>
            <span className="line-clamp-2 text-[0.9rem] leading-[1.3] text-paper">
              {item.ev.segs.map((seg, j) =>
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
