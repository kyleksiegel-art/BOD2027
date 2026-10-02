import { useState } from 'react'
import type { RoundDetailVM, PlayerRoundVM } from '@/lib/data/compute'
import type { HoleResult, HoleInfo } from '@/lib/scoring'

/**
 * The scorecard grid, as two stacked tables — front nine over back nine — so all 18 holes
 * fit a phone without scrolling sideways (Kyle 2026-10-02). Rows are par / stroke-index /
 * one per player; the front carries OUT, the back IN and TOT. Both share one column layout
 * (the front's TOT column is left empty) so hole 3 sits above hole 12. Names are short
 * (`shortName`) — a full name can't fit beside nine columns at 375px.
 *
 * Two views: net Stableford POINTS (default — the game's currency, and the total that
 * matches the leaderboard) and raw GROSS. Cells carry golf-standard net-to-par shapes
 * (circle = net birdie/eagle, square = net bogey or worse), picked-up ("PU") marks, and
 * strokes-received pips. Holes beyond a shortened round's cutoff are struck through.
 */
export function Scorecard({ vm, pending }: { vm: RoundDetailVM; pending?: Set<string> }) {
  const [mode, setMode] = useState<'points' | 'gross'>('points')
  const pendingCells = pending ?? EMPTY_PENDING
  if (!vm.holes) return null
  const holesAll = vm.holes
  const front = holesAll.filter((h) => h.holeNumber <= 9)
  const back = holesAll.filter((h) => h.holeNumber >= 10)

  const resultsByPlayer = new Map<string, Map<number, HoleResult>>()
  for (const p of vm.players) {
    resultsByPlayer.set(p.playerId, new Map(p.holeResults.map((r) => [r.holeNumber, r])))
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <span className="eyebrow block">Scorecard</span>
        <ModeToggle mode={mode} setMode={setMode} />
      </div>

      {([['Out', front], ['In', back]] as const).map(([label, holes]) => (
        <table key={label} className="mt-4 w-full table-fixed border-collapse text-[0.82rem]">
          <colgroup>
            <col className="w-[3.5rem]" />
            {holes.map((h) => (
              <col key={h.holeNumber} />
            ))}
            <col className="w-8" />
            <col className="w-8" />
          </colgroup>
          <thead>
            <HeaderRow holes={holes} label={label} />
            <ParRow holes={holes} label={label} totalPar={sum(holesAll, (h) => h.par)} />
            <SiRow holes={holes} />
          </thead>
          <tbody>
            {vm.players.map((p) => (
              <PlayerRow
                key={p.playerId}
                player={p}
                holes={holes}
                label={label}
                results={resultsByPlayer.get(p.playerId)!}
                cutoff={vm.holesCounted}
                mode={mode}
                pending={pendingCells}
              />
            ))}
          </tbody>
        </table>
      ))}

      <Legend />
    </section>
  )
}

const EMPTY_PENDING: Set<string> = new Set()
const CELL = 'px-0 py-1.5 text-center tnum'
const LABEL = 'pr-1 text-left whitespace-nowrap overflow-hidden text-ellipsis'
const SUB = 'px-0 py-1.5 text-center tnum text-paper-faint bg-ground-2/40'

type Nine = 'Out' | 'In'
// What the group calls each other (Kyle 2026-10-02): first names, except these two go by
// last name. Keyed on the full player name; anyone not listed gets their first name.
const GOES_BY: Record<string, string> = { 'Adam Hersh': 'Hersh', 'Chris Denove': 'Denove' }
const shortName = (name: string) => GOES_BY[name] ?? (name.split(/\s+/)[0] || name)

function ModeToggle({
  mode,
  setMode,
}: {
  mode: 'points' | 'gross'
  setMode: (m: 'points' | 'gross') => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-hair-strong text-[0.68rem]">
      {(['points', 'gross'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={`px-3 py-1.5 font-semibold uppercase tracking-[0.1em] ${
            mode === m ? 'bg-gold/20 text-gold-bright' : 'text-paper-faint'
          }`}
        >
          {m === 'points' ? 'Points' : 'Gross'}
        </button>
      ))}
    </div>
  )
}

function HeaderRow({ holes, label }: { holes: HoleInfo[]; label: Nine }) {
  return (
    <tr className="text-[0.62rem] uppercase tracking-[0.08em] text-paper-faint">
      <th className={`${LABEL} py-1.5 font-medium`}>Hole</th>
      {holes.map((h) => (
        <th key={h.holeNumber} className={`${CELL} font-medium`}>
          {h.holeNumber}
        </th>
      ))}
      <th className={`${SUB} font-semibold`}>{label}</th>
      <th className={`${SUB} font-semibold text-paper-dim`}>{label === 'In' ? 'Tot' : ''}</th>
    </tr>
  )
}

const sum = (hs: HoleInfo[], f: (h: HoleInfo) => number) => hs.reduce((s, h) => s + f(h), 0)

function ParRow({ holes, label, totalPar }: { holes: HoleInfo[]; label: Nine; totalPar: number }) {
  return (
    <tr className="border-b border-hair text-paper-dim">
      <th className={`${LABEL} py-1.5 text-[0.62rem] font-medium uppercase tracking-[0.08em]`}>Par</th>
      {holes.map((h) => (
        <td key={h.holeNumber} className={CELL}>
          {h.par}
        </td>
      ))}
      <td className={`${SUB} text-paper-dim`}>{sum(holes, (h) => h.par)}</td>
      <td className={`${SUB} text-paper-dim`}>{label === 'In' ? totalPar : ''}</td>
    </tr>
  )
}

function SiRow({ holes }: { holes: HoleInfo[] }) {
  return (
    <tr className="border-b border-hair-strong text-[0.68rem] text-paper-faint">
      <th className={`${LABEL} py-1.5 text-[0.62rem] font-medium uppercase tracking-[0.08em]`}>
        S.I.
      </th>
      {holes.map((h) => (
        <td key={h.holeNumber} className={CELL}>
          {h.strokeIndex}
        </td>
      ))}
      <td className={SUB} />
      <td className={SUB} />
    </tr>
  )
}

function PlayerRow({
  player,
  holes,
  label,
  results,
  cutoff,
  mode,
  pending,
}: {
  player: PlayerRoundVM
  holes: HoleInfo[]
  label: Nine
  results: Map<number, HoleResult>
  cutoff: number
  mode: 'points' | 'gross'
  pending: Set<string>
}) {
  const name = shortName(player.name)
  if (player.status === 'did_not_play') {
    return (
      <tr className="border-b border-hair">
        <th className={`${LABEL} py-2.5 font-medium text-paper-dim`}>{name}</th>
        <td colSpan={holes.length + 2} className="py-2.5 pl-2 text-left text-[0.78rem] text-paper-faint">
          Did not play
        </td>
      </tr>
    )
  }

  const nineVal = holes.reduce((s, h) => {
    const r = results.get(h.holeNumber)
    return s + ((mode === 'points' ? r?.points : r?.grossStrokes) ?? 0)
  }, 0)
  const grossTotal = [...results.values()].reduce((s, r) => s + (r.grossStrokes ?? 0), 0)
  const totVal = label === 'Out' ? '' : mode === 'points' ? player.totalPoints : grossTotal

  return (
    <tr className="border-b border-hair">
      <th className={`${LABEL} py-2.5 font-medium text-paper`}>{name}</th>
      {holes.map((h) => (
        <ScoreCell
          key={h.holeNumber}
          hole={h}
          result={results.get(h.holeNumber)}
          cutoff={cutoff}
          mode={mode}
          unsynced={pending.has(`${player.playerId}|${h.holeNumber}`)}
        />
      ))}
      <td className={`${SUB} font-semibold text-paper-dim`}>{nineVal}</td>
      <td className={`${SUB} font-display text-[0.95rem] font-semibold text-gold-bright`}>{totVal}</td>
    </tr>
  )
}

/** net-to-par → golf-standard mark. Circle = under, square = over. */
function shapeClass(netToPar: number | null): string {
  if (netToPar === null) return ''
  if (netToPar <= -2) return 'rounded-full border-2 border-olive outline outline-1 outline-offset-1 outline-olive'
  if (netToPar === -1) return 'rounded-full border-2 border-olive'
  if (netToPar === 0) return ''
  if (netToPar === 1) return 'border-2 border-gold'
  return 'border-2 border-gold outline outline-1 outline-offset-1 outline-gold'
}

function ScoreCell({
  hole,
  result,
  cutoff,
  mode,
  unsynced,
}: {
  hole: HoleInfo
  result: HoleResult | undefined
  cutoff: number
  mode: 'points' | 'gross'
  unsynced: boolean
}) {
  // A subtle amber underdot: this cell is entered on this phone but not yet on the server.
  const syncMark = unsynced ? (
    <span
      className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-gold-fill"
      aria-label="not yet synced"
    />
  ) : null

  const excluded = hole.holeNumber > cutoff
  if (excluded) {
    return (
      <td className={`${CELL} text-paper-faint`}>
        <span className="line-through decoration-paper-faint/60">–</span>
      </td>
    )
  }
  if (!result || !result.completed) {
    return <td className={`${CELL} text-paper-faint`}>·</td>
  }
  if (result.pickedUp) {
    return (
      <td className={CELL}>
        <span className="relative inline-flex items-center justify-center">
          <span className="text-[0.62rem] font-semibold uppercase tracking-wide text-paper-faint">PU</span>
          {syncMark}
        </span>
      </td>
    )
  }

  const value = mode === 'points' ? result.points : result.grossStrokes
  const pips = result.strokesReceived
  return (
    <td className={CELL}>
      <span className="relative inline-flex items-center justify-center">
        {pips > 0 && (
          <span className="absolute -top-1.5 right-0 leading-none text-[0.5rem] text-gold" aria-hidden>
            {pips >= 2 ? '••' : '•'}
          </span>
        )}
        <span
          className={`inline-flex h-[1.35rem] w-[1.35rem] items-center justify-center text-[0.82rem] text-paper ${shapeClass(result.netToPar)}`}
        >
          {value}
        </span>
        {syncMark}
      </span>
    </td>
  )
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.68rem] text-paper-faint">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-4 w-4 rounded-full border-2 border-olive" /> net birdie+
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-4 w-4 border-2 border-gold" /> net bogey+
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-gold">•</span> strokes received
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-semibold uppercase">PU</span> picked up (0 pts, counts as played)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="line-through">–</span> excluded (past the counted cutoff)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-fill" /> on this phone, awaiting sync
      </span>
    </div>
  )
}
