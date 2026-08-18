import { useState } from 'react'
import type { RoundDetailVM, PlayerRoundVM } from '@/lib/data/compute'

/**
 * Collapsible audit trail for each player's strokes. Every line is the real WHS
 * derivation recomputed from the stored snapshot inputs (index / allowance / cap + tee
 * rating-slope-par) — proof the handicaps verify by hand, and the place the cap and any
 * manual override are made explicit.
 */
export function HandicapWorksheet({ vm }: { vm: RoundDetailVM }) {
  const [open, setOpen] = useState(false)
  const players = vm.players.filter((p) => p.worksheet)
  if (players.length === 0) return null

  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="tap flex w-full items-center justify-between border-b border-hair py-2 text-left"
      >
        <span className="eyebrow">Handicap worksheet</span>
        <span className="text-paper-faint" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          {players.map((p) => (
            <PlayerWorksheet key={p.playerId} player={p} />
          ))}
          <p className="text-[0.72rem] leading-relaxed text-paper-faint">
            Course Handicap = Index × (Slope ÷ 113) + (Rating − Par), carried unrounded. Playing
            Handicap rounds once (half away from zero) after the allowance; the cap of 18 is applied
            last.
          </p>
        </div>
      )}
    </section>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="text-[0.8rem] text-paper-dim">{label}</span>
      <span className={`tnum text-[0.85rem] ${strong ? 'font-semibold text-paper' : 'text-paper'}`}>
        {value}
      </span>
    </div>
  )
}

const n1 = (x: number) => x.toFixed(1)
const n2 = (x: number) => x.toFixed(2)

function PlayerWorksheet({ player }: { player: PlayerRoundVM }) {
  const w = player.worksheet!
  const r = w.result
  return (
    <div className="rounded-lg border border-hair p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-display text-[1.05rem] font-semibold text-paper">{player.name}</span>
        <span className="text-[0.72rem] uppercase tracking-[0.12em] text-paper-faint">
          {player.teeName} tee
        </span>
      </div>
      <Line label="Handicap index" value={n1(r.index)} />
      <Line label={`Index × (${r.slopeUsed} ÷ 113)`} value={n2(r.indexTimesSlope)} />
      <Line label={`Rating − Par (${n1(r.ratingUsed ?? r.par)} − ${r.par})`} value={n1(r.ratingMinusPar)} />
      <Line label="Course handicap" value={n2(r.courseHandicapUnrounded)} strong />
      {r.allowancePct !== 1 && (
        <Line label={`× Allowance (${Math.round(r.allowancePct * 100)}%)`} value={n2(r.afterAllowance)} />
      )}
      <Line label="Playing handicap" value={String(r.playingHandicap)} />
      {r.capApplied && (
        <div className="flex items-baseline justify-between gap-4 py-0.5">
          <span className="text-[0.8rem] text-paper-dim">Cap</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded-full border border-gold px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-gold-bright">
              capped 18
            </span>
          </span>
        </div>
      )}
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-hair pt-2">
        <span className="text-[0.8rem] font-semibold text-paper">Strokes received</span>
        <span className="tnum font-display text-[1.1rem] font-semibold text-gold-bright">
          {w.strokesReceivedFinal}
        </span>
      </div>
      {w.overrideApplied && (
        <p className="mt-2 text-[0.72rem] text-gold">
          Manual override — computed value was {r.strokesReceived}.
        </p>
      )}
    </div>
  )
}
