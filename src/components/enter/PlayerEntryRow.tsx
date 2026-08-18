import type { EnterPlayerVM } from '@/lib/data/compute'

/**
 * One player's row on the Enter screen: big number, big steppers, picked-up button.
 *
 * The par default is DISPLAY ONLY. `gross === null && !pickedUp` renders the par in a
 * muted treatment; paging through 18 holes must never silently record four pars a hole.
 * Nothing here writes anything at all — a tap edits a local draft, and the hole reaches
 * the database only when the scorer taps Save.
 */
export function PlayerEntryRow({
  player,
  par,
  unsaved,
  onStep,
  onTogglePickedUp,
}: {
  player: EnterPlayerVM
  par: number
  /** This player's value on this hole has been edited but not yet saved. */
  unsaved: boolean
  /** Relative, not absolute: the parent owns the current value so a burst of taps adds up. */
  onStep: (delta: number) => void
  onTogglePickedUp: () => void
}) {
  const entered = player.gross !== null || player.pickedUp
  const dnp = player.status === 'did_not_play'

  // The first tap on a blank row starts from par, which is what the display already
  // shows — so "+" reads as 5 on a par 4, not as 1.
  const shown = player.gross ?? par

  const strokes = player.strokesOnHole

  return (
    <div
      className={`border-t border-hair py-3 ${dnp ? 'opacity-40' : entered ? '' : 'opacity-60'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-paper">{player.name}</div>
          <div className="mt-0.5 text-[0.78rem] text-paper-faint tnum">
            {dnp ? (
              'Did not play'
            ) : (
              <>
                {strokes > 0
                  ? `${'•'.repeat(Math.min(strokes, 3))} ${strokes} stroke${strokes === 1 ? '' : 's'}`
                  : strokes < 0
                    ? `${strokes} stroke`
                    : 'no stroke'}
                {' · thru '}
                {player.thru} · {player.roundPoints} pts
              </>
            )}
          </div>
        </div>

        {!dnp && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label={`One fewer stroke for ${player.name}`}
              disabled={player.pickedUp}
              onClick={() => onStep(-1)}
              className="tap rounded-md border border-hair-strong px-4 text-xl text-paper disabled:opacity-30"
            >
              −
            </button>

            <div className="w-14 text-center">
              {player.pickedUp ? (
                <span className="font-display text-3xl text-paper-faint">—</span>
              ) : (
                <span
                  className={`font-display text-3xl tnum ${
                    entered ? 'text-paper' : 'text-paper-faint'
                  }`}
                >
                  {shown}
                </span>
              )}
              <div
                className={`text-[0.7rem] tnum ${unsaved ? 'text-gold-bright' : 'text-paper-faint'}`}
              >
                {unsaved ? '• ' : ''}
                {player.points === null ? '—' : `${player.points} pt`}
              </div>
            </div>

            <button
              type="button"
              aria-label={`One more stroke for ${player.name}`}
              disabled={player.pickedUp}
              onClick={() => onStep(1)}
              className="tap rounded-md border border-hair-strong px-4 text-xl text-paper disabled:opacity-30"
            >
              +
            </button>

            <button
              type="button"
              onClick={onTogglePickedUp}
              aria-pressed={player.pickedUp}
              className={`tap rounded-md border px-3 text-[0.8rem] font-semibold disabled:opacity-30 ${
                player.pickedUp
                  ? 'border-gold bg-gold text-ground'
                  : 'border-hair-strong text-paper-dim'
              }`}
            >
              PU
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
