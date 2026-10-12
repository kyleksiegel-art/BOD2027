import { useState } from 'react'
import { useRadioPlayer } from '@/hooks/useRadioPlayer'
import { formatCallTime } from '@/lib/format'

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
      {playing ? <rect x="2" y="2" width="10" height="10" rx="1" fill="currentColor" /> : <path d="M3 1.5v11l9.5-5.5z" fill="currentColor" />}
    </svg>
  )
}

/**
 * Admin's radio call (Kyle 2026-10-11): the same call the Field Report's secret triple tap plays,
 * behind the PIN so it stays a surprise, plus the calls this phone has played, to hear again word
 * for word. The phone's own voice, so it works offline.
 */
export function RadioCallCard() {
  const player = useRadioPlayer()
  const [showEarlier, setShowEarlier] = useState(false)
  if (!player.call || !player.available) return null
  const nowPlaying = player.playing === 'now'

  return (
    <section className="mt-5 rounded-md border border-hair">
      <div className="flex items-center justify-between gap-3 p-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[0.95rem] font-semibold text-paper">Radio call</span>
          <span className="truncate text-[0.78rem] text-paper-faint">{player.call.label}</span>
        </span>
        <button
          type="button"
          onClick={() => (nowPlaying ? player.stop() : player.playNow())}
          aria-pressed={nowPlaying}
          className="tap inline-flex shrink-0 items-center gap-2 rounded-md border border-hair-strong bg-ground-2 px-4 text-[0.9rem] font-semibold text-paper"
        >
          <PlayIcon playing={nowPlaying} />
          {nowPlaying ? 'Stop' : 'Play'}
        </button>
      </div>

      {player.calls.length > 0 && (
        <div className="border-t border-hair">
          <button
            type="button"
            onClick={() => setShowEarlier((v) => !v)}
            aria-expanded={showEarlier}
            className="tap flex w-full items-center justify-between px-3 text-[0.85rem] text-paper-dim"
          >
            <span>Earlier calls ({player.calls.length})</span>
            <span aria-hidden>{showEarlier ? '▴' : '▾'}</span>
          </button>
          {showEarlier && (
            <ol>
              {player.calls.map((c) => {
                const on = player.playing === c.at
                return (
                  <li key={c.at} className="flex items-center justify-between gap-3 border-t border-hair px-3 py-2">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="tnum text-[0.85rem] text-paper">{formatCallTime(c.at)} · {c.label}</span>
                      <span className="truncate text-[0.75rem] text-paper-faint">{c.lines[0]}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => (on ? player.stop() : player.replay(c))}
                      aria-pressed={on}
                      aria-label={on ? 'Stop' : `Replay the ${c.label} call from ${formatCallTime(c.at)}`}
                      className="tap inline-flex shrink-0 items-center justify-center rounded-md border border-hair-strong text-paper"
                    >
                      <PlayIcon playing={on} />
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
