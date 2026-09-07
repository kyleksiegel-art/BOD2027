import { useState } from 'react'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { PlayerForm } from '@/components/PlayerForm'
import { usePlayers } from '@/lib/data/selectors'
import { courseShortName } from '@/lib/format'
import type { PlayerCardVM } from '@/lib/data/selectors'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export default function Players() {
  const players = usePlayers()

  return (
    <Page>
      <PageHeader eyebrow="The Field" title="Players" />

      {!players ? (
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      ) : (
        <>
          <ul className="mt-4">
            {players.map((card) => (
              <PlayerRow key={card.player.id} card={card} />
            ))}
          </ul>
          <p className="mt-4 text-[0.72rem] leading-relaxed text-paper-faint">
            Numbers under each name are that player’s course handicap at each course. Tap a player for
            form — every figure derives from the saved scores, on-device.
          </p>
        </>
      )}
    </Page>
  )
}

/**
 * One player. The whole collapsed row is the tap target (Kyle 2026-09-07 — "feels weird": the
 * row was 161px tall with only the top 44px tappable, so most of the card was dead), and the
 * course handicaps are one compact line rather than a three-line ragged wrap. The Form panel
 * sits outside the button, so no panel is nested inside a control.
 */
function PlayerRow({ card }: { card: PlayerCardVM }) {
  const { player, courseHandicaps, form } = card
  const [open, setOpen] = useState(false)

  const collapsed = (
    <>
      <div className="flex items-center gap-4">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-[0.9rem] font-semibold text-gold">
          {player.photo_url ? (
            <img src={player.photo_url} alt={player.name} className="h-full w-full rounded-full object-cover" />
          ) : (
            initials(player.name)
          )}
        </span>
        <span className="flex flex-1 flex-col text-left">
          <span className="text-[1.05rem] text-paper">{player.name}</span>
          {player.title && <span className="text-[0.76rem] text-paper-faint">{player.title}</span>}
        </span>
        <span className="flex flex-col items-end">
          <span className="tnum font-display text-[1.15rem] font-semibold text-paper">
            {player.handicap_index.toFixed(1)}
          </span>
          <span className="text-[0.62rem] uppercase tracking-[0.12em] text-paper-faint">Index</span>
        </span>
        {form && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`ml-1 flex-none text-paper-faint transition-transform ${open ? '-rotate-180' : ''}`}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </div>

      {/* One line, full width: short course names, the number carrying the weight. */}
      {courseHandicaps.length > 0 && (
        <dl className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-left">
          {courseHandicaps.map((ch, i) => (
            <span key={ch.roundNumber} className="inline-flex items-baseline gap-1">
              {i > 0 && <span className="mr-0.5 text-[0.7rem] text-paper-faint" aria-hidden>·</span>}
              <dt className="text-[0.72rem] text-paper-faint">{courseShortName(ch.courseName)}</dt>
              <dd className="tnum text-[0.82rem] font-semibold text-paper-dim">
                {ch.didNotPlay ? 'DNP' : ch.playingHandicap !== null ? ch.playingHandicap : '—'}
              </dd>
            </span>
          ))}
        </dl>
      )}
    </>
  )

  return (
    <li className={`border-b border-hair first:border-t first:border-t-hair-strong ${open ? 'bg-ground-2' : ''}`}>
      {form ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`form-${player.id}`}
          className="block w-full py-4 text-left"
        >
          {collapsed}
        </button>
      ) : (
        <div className="py-4">{collapsed}</div>
      )}

      {form && open && (
        <div id={`form-${player.id}`} className="pb-4">
          <PlayerForm vm={form} />
        </div>
      )}
    </li>
  )
}
