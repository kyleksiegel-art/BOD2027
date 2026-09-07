import type { FormCell, PlayerFormVM } from '@/lib/data/form'

/**
 * Form — what the stored scores say about a player: the longest run of scoring holes, the worst
 * three-hole stretch, the front/back split, and the latest round hole by hole. Expanded from a
 * row on the Players page; everything derives on-device, so it works offline like the rest.
 */
export function PlayerForm({ vm }: { vm: PlayerFormVM }) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline gap-2">
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">Form</span>
        <span className="tnum ml-auto text-[0.72rem] text-paper-dim">{vm.throughLabel}</span>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <Tile
          label="Best run"
          labelClass="text-olive"
          figure={vm.bestRun ? String(vm.bestRun.holes) : '—'}
          unit={vm.bestRun ? (vm.bestRun.holes === 1 ? 'hole' : 'holes') : undefined}
          note={
            vm.bestRun
              ? `R${vm.bestRun.roundNumber} · H${vm.bestRun.from}–${vm.bestRun.to} · ${vm.bestRun.points} pts`
              : 'no scoring holes yet'
          }
        />
        <Tile
          label="Worst 3"
          labelClass="text-red"
          figure={vm.worstStretch ? String(vm.worstStretch.points) : '—'}
          unit={vm.worstStretch ? (vm.worstStretch.points === 1 ? 'pt' : 'pts') : undefined}
          note={
            vm.worstStretch
              ? `R${vm.worstStretch.roundNumber} · H${vm.worstStretch.from}–${vm.worstStretch.from + 2}`
              : 'fewer than three holes in'
          }
        />
        <Tile
          label="Front · Back"
          labelClass="text-paper-faint"
          figure={`${vm.front.points}`}
          figureTail={`${vm.back.points}`}
          note={`${vm.front.holes} · ${vm.back.holes} holes`}
        />
      </div>

      {/* The verdict gets a full-width line: it quotes a per-hole rate, which needs the room. */}
      {vm.splitNote && (
        <p className="tnum mt-2 text-[0.72rem] leading-snug text-paper-dim">
          {vm.splitLean === 'front' || vm.splitLean === 'back' ? (
            <>
              <strong className="font-semibold text-paper">
                Stronger on the {vm.splitLean}.
              </strong>{' '}
              {vm.splitNote}
            </>
          ) : (
            vm.splitNote
          )}
        </p>
      )}

      {vm.strip && (
        <>
          <div className="mt-3.5 flex items-baseline gap-2">
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">
              Round {vm.strip.roundNumber} · {vm.strip.courseName}
            </span>
            <span className="tnum ml-auto text-[0.72rem] text-paper-dim">
              {vm.strip.points} pts thru {vm.strip.thru}
            </span>
          </div>
          <div
            className="mt-1.5 grid h-[22px] gap-[2px]"
            style={{ gridTemplateColumns: `repeat(${vm.strip.cells.length}, minmax(0, 1fr))` }}
            role="img"
            aria-label={stripLabel(vm.strip.cells)}
          >
            {vm.strip.cells.map((c) => (
              <Cell key={c.holeNumber} cell={c} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.66rem] text-paper-dim">
            <Key swatch={BANDS.zero} label="zero" />
            <Key swatch={BANDS.one} label="1 pt" />
            <Key swatch={BANDS.par} label="2 (par)" />
            <Key swatch={BANDS.good} label="3+" />
            <Key ring label="net eagle" />
          </div>
        </>
      )}
    </div>
  )
}

function Tile({
  label,
  labelClass,
  figure,
  figureTail,
  unit,
  note,
}: {
  label: string
  labelClass: string
  figure: string
  figureTail?: string
  unit?: string
  note: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-hair bg-ground px-2.5 pb-2 pt-2.5">
      <span
        className={`min-h-[2.5em] text-[0.58rem] font-semibold uppercase leading-tight tracking-[0.14em] ${labelClass}`}
      >
        {label}
      </span>
      <span className="tnum fx-title font-display text-[1.6rem] font-semibold leading-none text-paper">
        {figure}
        {figureTail !== undefined && <span className="mx-[3px] text-[0.9rem] font-normal text-paper-faint">·</span>}
        {figureTail}
        {unit && <span className="text-[0.7rem] font-normal text-paper-faint"> {unit}</span>}
      </span>
      <span className="tnum text-[0.66rem] leading-snug text-paper-dim">{note}</span>
    </div>
  )
}

/**
 * Points bands, low to high. Net Stableford spends most of its life on 1 and 2 points, so those
 * get their own steps — one shared grey made every strip look flat and told the reader nothing.
 */
const BANDS = {
  zero: 'var(--red)',
  one: 'rgba(27, 30, 28, 0.34)',
  par: 'rgba(111, 117, 17, 0.34)',
  good: 'var(--olive)',
} as const

function bandFor(points: number): string {
  if (points === 0) return BANDS.zero
  if (points === 1) return BANDS.one
  if (points === 2) return BANDS.par
  return BANDS.good
}

/** One hole. Colour is the points band; a net eagle keeps the band and adds a gold ring. */
function Cell({ cell }: { cell: FormCell }) {
  if (!cell.played) {
    return <span className="rounded-[2px] border border-hair-strong" />
  }
  return (
    <span
      className="rounded-[2px]"
      style={{
        background: bandFor(cell.points ?? 0),
        boxShadow: cell.eagle ? 'inset 0 0 0 1px var(--gold-fill)' : undefined,
      }}
    />
  )
}

function Key({ swatch, ring, label }: { swatch?: string; ring?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        className="inline-block h-[9px] w-[9px] rounded-[2px]"
        style={ring ? { boxShadow: 'inset 0 0 0 1px var(--gold-fill)' } : { background: swatch }}
        aria-hidden
      />
      {label}
    </span>
  )
}

/** The strip is decoration for sighted users; screen readers get the numbers. */
function stripLabel(cells: FormCell[]): string {
  const played = cells.filter((c) => c.played)
  const parts = played.map((c) => `hole ${c.holeNumber}: ${c.pickedUp ? 'picked up' : `${c.points} points`}`)
  return parts.length === 0 ? 'No holes in yet' : `Hole by hole — ${parts.join(', ')}`
}
