import { useRef, useState, type ReactNode } from 'react'
import { useRadioPlayer } from '@/hooks/useRadioPlayer'
import { formatCallTime } from '@/lib/format'

const REVEAL = 88 // px — the Delete button behind a row

/**
 * Swipe a row left to remove it (Kyle 2026-10-22, for misfires and takes he didn't like), the
 * iOS Mail way: a short swipe opens a Delete button, a swipe past half the row deletes outright.
 * `touch-action: pan-y` keeps vertical scrolling the page's; a horizontal drag is ours.
 */
function SwipeToDelete({ label, onDelete, children }: { label: string; onDelete: () => void; children: ReactNode }) {
  const [x, setXState] = useState(0)
  const xRef = useRef(0) // the release can land before the last move's render
  const setX = (v: number) => {
    xRef.current = v
    setXState(v)
  }
  const [dragging, setDragging] = useState(false)
  const g = useRef<{ id: number; x0: number; y0: number; base: number; dir: 'h' | 'v' | null; moved: boolean } | null>(null)
  const row = useRef<HTMLDivElement>(null)

  const remove = () => {
    setX(-(row.current?.offsetWidth ?? 400))
    window.setTimeout(onDelete, 180)
  }

  return (
    <div ref={row} className="relative overflow-hidden">
      <button
        type="button"
        onClick={remove}
        aria-label={`Delete ${label}`}
        tabIndex={x < 0 ? 0 : -1}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-[var(--red)] text-[0.85rem] font-semibold text-ground-2"
        style={{ width: Math.max(REVEAL, -x) }}
      >
        Delete
      </button>
      <div
        className="relative bg-ground"
        style={{ transform: `translateX(${x}px)`, transition: dragging ? 'none' : 'transform 180ms ease-out', touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: xRef.current, dir: null, moved: false }
        }}
        onPointerMove={(e) => {
          const s = g.current
          if (!s || s.id !== e.pointerId) return
          const dx = e.clientX - s.x0
          const dy = e.clientY - s.y0
          if (!s.dir) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
            s.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
            if (s.dir === 'h') {
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                // A pointer the browser no longer tracks; the drag still works without capture.
              }
              setDragging(true)
            }
          }
          if (s.dir !== 'h') return
          s.moved = true
          const width = row.current?.offsetWidth ?? 400
          setX(Math.min(0, Math.max(-width, s.base + dx)))
        }}
        onPointerUp={() => {
          const s = g.current
          if (!s || s.dir !== 'h') return
          setDragging(false)
          const width = row.current?.offsetWidth ?? 400
          const at = xRef.current
          if (at < -width / 2) remove()
          else setX(at < -REVEAL / 2 ? -REVEAL : 0)
        }}
        onPointerCancel={() => {
          g.current = null
          setDragging(false)
          setX(xRef.current < -REVEAL / 2 ? -REVEAL : 0)
        }}
        onClickCapture={(e) => {
          // The click that ends a drag, or a tap on an open row, only closes it — never replays.
          if (g.current?.moved || xRef.current !== 0) {
            e.preventDefault()
            e.stopPropagation()
            if (!g.current?.moved) setX(0)
          }
          g.current = null
        }}
      >
        {children}
      </div>
    </div>
  )
}

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

      {(player.calls.length > 0 || player.removed) && (
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
          {player.removed && (
            <div className="flex items-center justify-between gap-3 border-t border-hair bg-ground-2 py-1 pl-3 pr-1" role="status">
              <span className="min-w-0 truncate text-[0.8rem] text-paper-dim">
                Deleted {formatCallTime(player.removed.at)} · {player.removed.label}
              </span>
              <button type="button" onClick={player.undoRemove} className="tap shrink-0 px-3 text-[0.9rem] font-semibold text-gold">
                Undo
              </button>
            </div>
          )}
          {showEarlier && (
            <>
              <p className="px-3 pb-2 pt-1 text-[0.75rem] text-paper-faint">Swipe a call left to delete it.</p>
              <ol>
                {player.calls.map((c) => {
                  const on = player.playing === c.at
                  return (
                    <li key={c.at} className="border-t border-hair">
                      <SwipeToDelete label={`the ${c.label} call from ${formatCallTime(c.at)}`} onDelete={() => player.remove(c)}>
                        <div className="flex items-center justify-between gap-3 px-3 py-2">
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
                        </div>
                      </SwipeToDelete>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  )
}
