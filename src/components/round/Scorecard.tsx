import { useState } from 'react'
import type { RoundDetailVM, PlayerRoundVM } from '@/lib/data/compute'
import type { HoleResult, HoleInfo } from '@/lib/scoring'

/**
 * The scorecard grid. Rows are par / stroke-index / one per player; columns are the 18
 * holes with OUT / IN / TOT subtotals. Horizontally scrolls (a scorecard is wide by
 * nature); the label column is sticky so names stay visible.
 *
 * Two views: net Stableford POINTS (default — the game's currency, and the total that
 * matches the leaderboard) and raw GROSS. Cells carry golf-standard net-to-par shapes
 * (circle = net birdie/eagle, square = net bogey or worse), picked-up ("PU") marks, and
 * strokes-received pips. Holes beyond a shortened round's cutoff are struck through.
 */
export function Scorecard({ vm }: { vm: RoundDetailVM }) {
  const [mode, setMode] = useState<'points' | 'gross'>('points')
  if (!vm.holes) return null
  const holes = vm.holes
  const front = holes.filter((h) => h.holeNumber <= 9)
  const back = holes.filter((h) => h.holeNumber >= 10)

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

      <div className="mt-4 overflow-x-auto">
        <table className="border-collapse text-[0.82rem]">
          <thead>
            <HeaderRow front={front} back={back} />
            <ParRow front={front} back={back} />
            <SiRow front={front} back={back} />
          </thead>
          <tbody>
            {vm.players.map((p) => (
              <PlayerRow
                key={p.playerId}
                player={p}
                front={front}
                back={back}
                results={resultsByPlayer.get(p.playerId)!}
                cutoff={vm.holesCounted}
                mode={mode}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Legend />
    </section>
  )
}

const CELL = 'w-8 min-w-8 px-0 py-1.5 text-center tnum'
const LABEL = 'sticky left-0 z-10 bg-ground pr-3 text-left whitespace-nowrap'
const SUB = 'w-9 min-w-9 px-0 py-1.5 text-center tnum text-paper-faint bg-ground-2/40'

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

function HeaderRow({ front, back }: { front: HoleInfo[]; back: HoleInfo[] }) {
  return (
    <tr className="text-[0.62rem] uppercase tracking-[0.08em] text-paper-faint">
      <th className={`${LABEL} py-1.5 font-medium`}>Hole</th>
      {front.map((h) => (
        <th key={h.holeNumber} className={`${CELL} font-medium`}>
          {h.holeNumber}
        </th>
      ))}
      <th className={`${SUB} font-semibold`}>Out</th>
      {back.map((h) => (
        <th key={h.holeNumber} className={`${CELL} font-medium`}>
          {h.holeNumber}
        </th>
      ))}
      <th className={`${SUB} font-semibold`}>In</th>
      <th className={`${SUB} font-semibold text-paper-dim`}>Tot</th>
    </tr>
  )
}

const sum = (hs: HoleInfo[], f: (h: HoleInfo) => number) => hs.reduce((s, h) => s + f(h), 0)

function ParRow({ front, back }: { front: HoleInfo[]; back: HoleInfo[] }) {
  return (
    <tr className="border-b border-hair text-paper-dim">
      <th className={`${LABEL} py-1.5 text-[0.62rem] font-medium uppercase tracking-[0.08em]`}>Par</th>
      {front.map((h) => (
        <td key={h.holeNumber} className={CELL}>
          {h.par}
        </td>
      ))}
      <td className={`${SUB} text-paper-dim`}>{sum(front, (h) => h.par)}</td>
      {back.map((h) => (
        <td key={h.holeNumber} className={CELL}>
          {h.par}
        </td>
      ))}
      <td className={`${SUB} text-paper-dim`}>{sum(back, (h) => h.par)}</td>
      <td className={`${SUB} text-paper-dim`}>{sum([...front, ...back], (h) => h.par)}</td>
    </tr>
  )
}

function SiRow({ front, back }: { front: HoleInfo[]; back: HoleInfo[] }) {
  return (
    <tr className="border-b border-hair-strong text-[0.68rem] text-paper-faint">
      <th className={`${LABEL} py-1.5 text-[0.62rem] font-medium uppercase tracking-[0.08em]`}>
        S.I.
      </th>
      {front.map((h) => (
        <td key={h.holeNumber} className={CELL}>
          {h.strokeIndex}
        </td>
      ))}
      <td className={SUB} />
      {back.map((h) => (
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
  front,
  back,
  results,
  cutoff,
  mode,
}: {
  player: PlayerRoundVM
  front: HoleInfo[]
  back: HoleInfo[]
  results: Map<number, HoleResult>
  cutoff: number
  mode: 'points' | 'gross'
}) {
  if (player.status === 'did_not_play') {
    return (
      <tr className="border-b border-hair">
        <th className={`${LABEL} py-2.5 font-medium text-paper-dim`}>{player.name}</th>
        <td colSpan={front.length + back.length + 3} className="py-2.5 pl-2 text-left text-[0.78rem] text-paper-faint">
          Did not play
        </td>
      </tr>
    )
  }

  const ninePoints = (hs: HoleInfo[]) =>
    hs.reduce((s, h) => {
      const r = results.get(h.holeNumber)
      return s + (r?.points ?? 0)
    }, 0)
  const nineGross = (hs: HoleInfo[]) =>
    hs.reduce((s, h) => {
      const r = results.get(h.holeNumber)
      return s + (r?.grossStrokes ?? 0)
    }, 0)

  const outVal = mode === 'points' ? ninePoints(front) : nineGross(front)
  const inVal = mode === 'points' ? ninePoints(back) : nineGross(back)
  const totVal = mode === 'points' ? player.totalPoints : nineGross(front) + nineGross(back)

  return (
    <tr className="border-b border-hair">
      <th className={`${LABEL} py-2.5 font-medium text-paper`}>{player.name}</th>
      {front.map((h) => (
        <ScoreCell key={h.holeNumber} hole={h} result={results.get(h.holeNumber)} cutoff={cutoff} mode={mode} />
      ))}
      <td className={`${SUB} font-semibold text-paper-dim`}>{outVal}</td>
      {back.map((h) => (
        <ScoreCell key={h.holeNumber} hole={h} result={results.get(h.holeNumber)} cutoff={cutoff} mode={mode} />
      ))}
      <td className={`${SUB} font-semibold text-paper-dim`}>{inVal}</td>
      <td className={`${SUB} font-display text-[0.95rem] font-semibold text-gold-bright`}>{totVal}</td>
    </tr>
  )
}

/** net-to-par → golf-standard mark. Circle = under, square = over. */
function shapeClass(netToPar: number | null): string {
  if (netToPar === null) return ''
  if (netToPar <= -2) return 'rounded-full border-2 border-olive outline outline-2 outline-offset-2 outline-olive'
  if (netToPar === -1) return 'rounded-full border-2 border-olive'
  if (netToPar === 0) return ''
  if (netToPar === 1) return 'border-2 border-gold'
  return 'border-2 border-gold outline outline-2 outline-offset-2 outline-gold'
}

function ScoreCell({
  hole,
  result,
  cutoff,
  mode,
}: {
  hole: HoleInfo
  result: HoleResult | undefined
  cutoff: number
  mode: 'points' | 'gross'
}) {
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
      <td className={`${CELL}`}>
        <span className="text-[0.62rem] font-semibold uppercase tracking-wide text-paper-faint">PU</span>
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
          className={`inline-flex h-6 w-6 items-center justify-center text-[0.82rem] text-paper ${shapeClass(result.netToPar)}`}
        >
          {value}
        </span>
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
    </div>
  )
}
