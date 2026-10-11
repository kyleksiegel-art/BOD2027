import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { playerColor } from '@/components/WinOdds'
import { useOddsHistory } from '@/lib/data/selectors'
import type { OddsHistoryVM, OddsPoint, OddsSeries } from '@/lib/data/winProb'
import { courseShortName, formatOdds } from '@/lib/format'

/**
 * How the odds moved: each player's chance to win the week after every saved hole, for the round
 * in focus (the live one, else the last final one) or the whole week, plus the three holes that
 * swung it most. Everything comes from buildOddsHistory; this only draws it.
 */
export default function Odds() {
  const vm = useOddsHistory()
  const [view, setView] = useState<'round' | 'week'>('round')

  return (
    <Page>
      <Link to="/standings" className="tap -ml-1 inline-flex items-center gap-1 text-[0.8rem] text-paper-faint">
        <span aria-hidden>‹</span> Standings
      </Link>
      <div className="mt-4">
        <PageHeader eyebrow="The Odds" title="How the odds moved" meta="Chance to win the week, after every saved hole" />
      </div>

      {vm === undefined ? (
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      ) : vm === null ? (
        <p className="mt-8 text-paper-dim">The odds start once the first round is underway.</p>
      ) : (
        <OddsBody vm={vm} view={vm.round ? view : 'week'} setView={setView} />
      )}
    </Page>
  )
}

function OddsBody({
  vm,
  view,
  setView,
}: {
  vm: OddsHistoryVM
  view: 'round' | 'week'
  setView: (v: 'round' | 'week') => void
}) {
  const series: OddsSeries = view === 'round' && vm.round ? vm.round : vm.week
  const breaks =
    view === 'week' ? vm.week.roundBreaks.map((b) => ({ index: b.index, label: courseShortName(b.courseName) })) : []

  return (
    <>
      {vm.round && (
        <div className="mt-5 grid grid-cols-2 gap-1 rounded-md border border-hair p-1" role="tablist">
          {(['round', 'week'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`min-h-[44px] rounded text-[0.9rem] font-semibold ${
                view === v ? 'bg-ground-2 text-paper shadow-sm' : 'text-paper-faint'
              }`}
            >
              {v === 'round' ? `Round ${vm.round!.roundNumber} · ${courseShortName(vm.round!.courseName)}` : 'Whole week'}
            </button>
          ))}
        </div>
      )}

      <Chart vm={vm} points={series.points} breaks={breaks} roundLabels={view === 'round'} />

      <ul className="mt-3 grid grid-cols-4 gap-2">
        {vm.players
          .slice()
          .sort((a, b) => b.pct - a.pct)
          .map((p) => (
            <li key={p.playerId} className="flex flex-col">
              <span className="mb-1 h-1 w-6 rounded-sm" style={{ background: playerColor(p.colorIndex) }} aria-hidden />
              <span className="text-[0.85rem] text-paper-dim">{p.name}</span>
              <span className="tnum fx-title font-display text-[1.3rem] font-semibold text-paper">
                {formatOdds(p.pct, false)}
              </span>
            </li>
          ))}
      </ul>

      {series.swings.length > 0 && (
        <section className="mt-8">
          <span className="eyebrow block">Biggest swings</span>
          <ol className="mt-3 border-t border-hair-strong">
            {series.swings.map((s) => {
              const slot = vm.players.find((p) => p.playerId === s.playerId)?.colorIndex ?? 0
              return (
                <li key={s.key} className="grid min-h-[52px] grid-cols-[4.6rem_1fr_auto] items-center gap-x-3 border-b border-hair py-2">
                  <span className="tnum fx-serif-sm font-display text-[0.98rem] font-semibold text-paper">{s.label}</span>
                  <span className="text-[0.95rem] leading-snug text-paper">{s.text}</span>
                  <span
                    className="tnum rounded-sm px-2 py-0.5 text-[0.85rem] font-semibold"
                    style={{ color: playerColor(slot), border: `1.5px solid ${playerColor(slot)}` }}
                  >
                    {s.move > 0 ? '+' : '−'}
                    {Math.abs(s.move)}
                  </span>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </>
  )
}

const W = 340
const H = 210
const L = 30 // left gutter for the % labels
const T = 12
const B = 182 // baseline (0%)

function Chart({
  vm,
  points,
  breaks,
  roundLabels,
}: {
  vm: OddsHistoryVM
  points: OddsPoint[]
  breaks: { index: number; label: string }[]
  roundLabels: boolean
}) {
  if (points.length < 2) return <p className="mt-6 text-paper-dim">The chart starts after the first saved hole.</p>
  const peak = Math.max(...points.flatMap((p) => Object.values(p.pct)))
  const top = peak > 75 ? 100 : peak > 50 ? 75 : 50
  const x = (i: number) => L + ((W - L - 6) * i) / (points.length - 1)
  const y = (v: number) => B - ((B - T) * v) / top
  const grid = [0, top / 2, top]
  const ticks = roundLabels
    ? points.map((p, i) => ({ i, text: p.hole === 0 ? 'Start' : String(p.hole) })).filter((t) => t.i === 0 || t.i === points.length - 1 || points[t.i].hole % 3 === 0)
    : []
  // Draw the favourite last, so the line that matters sits on top.
  const order = vm.players.slice().sort((a, b) => a.pct - b.pct)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-5 block w-full"
      role="img"
      aria-label={`Chance to win the week across ${points.length - 1} holes. Now: ${vm.players
        .map((p) => `${p.name} ${formatOdds(p.pct, false)}`)
        .join(', ')}.`}
    >
      {grid.map((g) => (
        <g key={g}>
          <line x1={L} x2={W - 6} y1={y(g)} y2={y(g)} stroke={g === 0 ? 'var(--hair-strong)' : 'var(--hair)'} />
          <text x={L - 5} y={y(g) + 4} textAnchor="end" fontSize="10" fill="var(--paper-faint)">
            {g === 0 ? '0' : `${g}%`}
          </text>
        </g>
      ))}
      {breaks.map((b) => (
        <g key={b.index}>
          {b.index > 0 && <line x1={x(b.index)} x2={x(b.index)} y1={T} y2={B} stroke="var(--hair-strong)" strokeDasharray="3 3" />}
          <text x={x(b.index) + 4} y={B + 16} fontSize="10" fill="var(--paper-faint)">
            {b.label}
          </text>
        </g>
      ))}
      {ticks.map((t) => (
        <text key={t.i} x={x(t.i)} y={B + 16} textAnchor="middle" fontSize="10" fill="var(--paper-faint)">
          {t.text}
        </text>
      ))}
      {order.map((p) => (
        <polyline
          key={p.playerId}
          fill="none"
          stroke={playerColor(p.colorIndex)}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points.map((pt, i) => `${x(i).toFixed(1)},${y(pt.pct[p.playerId] ?? 0).toFixed(1)}`).join(' ')}
        />
      ))}
    </svg>
  )
}
