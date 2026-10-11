import { Link } from 'react-router-dom'
import type { WinOddsVM } from '@/lib/data/winProb'

/** Same slots as the round recap, so a player is the same colour everywhere. */
export const PLAYER_COLORS = ['var(--blue)', 'var(--gold-fill)', 'var(--olive)', 'var(--paper-faint)']
export const playerColor = (slot: number) => PLAYER_COLORS[slot % PLAYER_COLORS.length]

function Delta({ d }: { d: number | null }) {
  if (d === null) return null
  if (d === 0) return <span className="text-paper-faint">·</span>
  return (
    <span style={{ color: d > 0 ? 'var(--olive)' : 'var(--red)' }}>
      {d > 0 ? '▲' : '▼'}
      {Math.abs(d)}
    </span>
  )
}

/** Standings panel: each player's chance to win the week, from simulating what's left. */
export function WinOdds({ vm }: { vm: WinOddsVM }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow block">Chance to win the week</span>
        {vm.sinceLabel && <span className="text-[0.72rem] text-paper-faint">change {vm.sinceLabel}</span>}
      </div>

      <div className="mt-3 flex h-3 overflow-hidden rounded-sm bg-hair" aria-hidden>
        {vm.rows.map((r) => (
          <div key={r.playerId} style={{ width: `${r.pct}%`, background: playerColor(r.colorIndex) }} />
        ))}
      </div>

      <ol className="mt-2">
        {vm.rows.map((r) => (
          <li
            key={r.playerId}
            className="grid min-h-[44px] grid-cols-[0.3rem_1fr_auto_2.6rem] items-center gap-x-3 border-b border-hair"
          >
            <span className="h-5 w-1 rounded-sm" style={{ background: playerColor(r.colorIndex) }} aria-hidden />
            <span className="truncate text-[1.02rem] text-paper">{r.name}</span>
            <span
              className={`tnum fx-title font-display text-[1.35rem] font-semibold leading-none ${
                r.out ? 'text-paper-faint' : 'text-paper'
              }`}
            >
              {r.label}
            </span>
            <span className="tnum text-right text-[0.75rem] font-semibold">
              <Delta d={r.delta} />
            </span>
          </li>
        ))}
      </ol>

      <Link to="/standings/odds" className="tap mt-1 flex items-center justify-between gap-3 py-2">
        <span className="text-[0.95rem] font-semibold text-paper">How the odds moved</span>
        <span className="text-[1.2rem] text-gold" aria-hidden>
          →
        </span>
      </Link>
      <p className="text-[0.72rem] leading-relaxed text-paper-faint">
        From thousands of simulated finishes of the {vm.holesLeft} holes left, each drawn from that
        player's own scoring this week. Moves every time a hole is saved.
      </p>
    </section>
  )
}
