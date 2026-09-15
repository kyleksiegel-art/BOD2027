import type { FormCell, PlayerFormVM } from '@/lib/data/form'
import { courseShortName, courseSlug } from '@/lib/format'

/**
 * Form — what the stored scores say about a player: how far off the index, blanks against net
 * birdies, holes won outright, then each round hole by hole with its result. Expanded from a row
 * on the Players page; everything derives on-device, so it works offline like the rest.
 *
 * The legend is NOT here — it renders once for the whole page (`FormLegend`), under the list.
 */
export function PlayerForm({ vm }: { vm: PlayerFormVM }) {
  const vs = vm.vsIndex
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  const vsFigure = vs.lean === 'level' ? 'Level' : fmt(Math.abs(vs.perRound))
  const vsUnit = vs.lean === 'level' ? undefined : vs.lean
  const vsColor = vs.lean === 'over' ? 'text-red' : vs.lean === 'under' ? 'text-olive' : 'text-paper-faint'

  return (
    <div className="mt-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">Form</span>
        <span className="tnum ml-auto text-[0.72rem] text-paper-dim">{vm.throughLabel}</span>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <Tile
          label="Vs index"
          labelClass={vsColor}
          figure={vsFigure}
          unit={vsUnit}
          note={`${fmt(vs.pointsPerRound)} pts a round`}
        />
        <Tile
          label="Zeros · Birdies"
          labelClass="text-paper-faint"
          figure={String(vm.zeros)}
          figureTail={String(vm.netBirdies)}
          note="blanks · net birdies"
        />
        <Tile
          label="Holes won"
          labelClass="text-olive"
          figure={String(vm.holesWon)}
          unit={`of ${vm.holesPlayed}`}
          note="outright"
        />
      </div>

      <p className="tnum mt-2 text-[0.72rem] leading-snug text-paper-dim">
        <strong className="font-semibold text-paper">{vs.verdict}</strong> {vs.note}
      </p>

      {/* One strip per round played, newest first, each with its result, so two rounds of form
          read side by side without tapping. */}
      {vm.strips.map((st, i) => (
        <div key={st.roundNumber} className={`round ${i === 0 ? 'mt-3.5' : 'mt-3'}`} data-course={courseSlug(st.courseName) ?? undefined}>
          <div className="flex items-center gap-2">
            <span className="round-swatch inline-block h-[7px] w-[7px] flex-none rounded-full" aria-hidden />
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">
              Round {st.roundNumber} · {courseShortName(st.courseName)}
            </span>
            <span className="tnum ml-auto whitespace-nowrap text-[0.72rem] text-paper-dim">
              {st.points} pts{st.complete ? '' : ` thru ${st.thru}`}
              <span className="mx-1.5 text-hair-strong" aria-hidden>
                |
              </span>
              <strong className={`font-semibold ${st.result.won ? 'text-gold-bright' : 'text-paper'}`}>{st.result.label}</strong>
            </span>
          </div>
          <div
            className="mt-1.5 grid h-[22px] gap-[2px]"
            style={{ gridTemplateColumns: `repeat(${st.cells.length}, minmax(0, 1fr))` }}
            role="img"
            aria-label={`Round ${st.roundNumber} at ${st.courseName}, ${st.result.label} — ${stripLabel(st.cells)}`}
          >
            {st.cells.map((c) => (
              <Cell key={c.holeNumber} cell={c} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The strips' key, once per page. */
export function FormLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[0.66rem] text-paper-dim">
      <Key swatch={BANDS.zero} label="zero" />
      <Key swatch={BANDS.one} label="1 pt" />
      <Key swatch={BANDS.par} label="2 (par)" />
      <Key swatch={BANDS.good} label="3+" />
      <Key ring label="net eagle" />
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

/**
 * One hole, in three states: past a shortened round's cutoff (a hairline, no box — the hole is
 * not part of this round), counted but not yet in (an outline), or played (its points band, plus
 * a gold ring on a net eagle).
 */
function Cell({ cell }: { cell: FormCell }) {
  if (!cell.counted) {
    return (
      <span className="flex items-center">
        <span className="h-[3px] w-full rounded-full bg-hair" />
      </span>
    )
  }
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

/** The strips are decoration for sighted users; screen readers get the numbers. */
function stripLabel(cells: FormCell[]): string {
  const played = cells.filter((c) => c.played)
  const parts = played.map((c) => `hole ${c.holeNumber}: ${c.pickedUp ? 'picked up' : `${c.points} points`}`)
  return parts.length === 0 ? 'No holes in yet' : `Hole by hole — ${parts.join(', ')}`
}
