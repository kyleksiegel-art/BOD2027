import { Link } from 'react-router-dom'
import type { RoundRecapVM } from '@/lib/data/compute'
import { courseSlug, formatDay, formatMoney } from '@/lib/format'

// Non-gold identity palette (gold is reserved for leader/winner status — see index.css).
const PLAYER_COLORS = ['var(--blue)', 'var(--olive)', 'var(--red)', 'var(--paper-faint)']

/**
 * Deterministic post-round report, rendered above the leaderboard once play has begun.
 * Every fact comes from buildRoundRecap — no scoring math here, no network. The same view
 * model will drive the shareable image; this is the in-context card.
 */
export function RoundRecap({ vm }: { vm: RoundRecapVM }) {
  const slug = courseSlug(vm.course.name) ?? undefined
  const colorOf = new Map(vm.players.map((p, i) => [p.playerId, PLAYER_COLORS[i % PLAYER_COLORS.length]]))

  const winnerNames = vm.winners.map((w) => w.name.split(/\s+/)[0]).join(' & ')
  const multi = vm.winners.length > 1
  const verb =
    vm.complete || vm.official ? (multi ? 'share' : 'takes') : multi ? 'lead' : 'leads'
  const winPoints = vm.winners[0]?.points ?? 0

  return (
    <section
      className="round round-rail mt-6 overflow-hidden rounded-lg border border-hair bg-ground-2"
      data-course={slug}
    >
      {/* header band */}
      <div className="border-b border-hair p-5">
        <div className="flex items-center gap-2">
          <span className="round-swatch h-2.5 w-2.5 flex-none rounded-full" aria-hidden />
          <span className="eyebrow">Round Recap</span>
          <span
            className={`ml-auto rounded-sm border px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${
              vm.official
                ? 'border-hair-strong text-paper-faint'
                : 'border-gold/40 text-gold'
            }`}
          >
            {vm.official ? 'Official' : 'Provisional'}
          </span>
        </div>
        <p className="fx-serif-sm mt-3 font-display text-[0.95rem] text-paper-dim">
          {vm.course.name} · {formatDay(vm.round.date)}
        </p>
        <h2 className="fx-head mt-1 font-display text-[1.9rem] font-semibold leading-none text-paper">
          <span className="text-gold-bright">{winnerNames}</span> {verb} it.
        </h2>
        <p className="mt-2 text-[0.92rem] text-paper-dim">
          <b className="font-semibold text-paper tnum">{winPoints} pts</b>
          {vm.margin > 0 ? (
            <>
              {' '}— a <b className="font-semibold text-paper tnum">{vm.margin}-point</b> margin
              {vm.runnerUp ? ` over ${vm.runnerUp.name.split(/\s+/)[0]}` : ''}.
            </>
          ) : vm.winners.length > 1 ? (
            <> — dead level at the top.</>
          ) : (
            <> so far.</>
          )}
        </p>
      </div>

      {/* fact grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <Fact label={`Round Winner${vm.roundWinnerCents ? ' · Pays' : ''}`}>
          <span className="tnum">
            {winnerNames}
            {vm.roundWinnerCents ? ` · ${formatMoney(vm.roundWinnerCents)}` : ''}
          </span>
          <Detail>
            {vm.standing
              .slice(0, 4)
              .map((s) => `${s.name.split(/\s+/)[0]} ${s.points}`)
              .join(' · ')}
          </Detail>
        </Fact>

        <Fact label="Biggest Move">
          {vm.biggestMove ? (
            <>
              <span>{vm.biggestMove.name}</span>
              <Detail>
                <span className="font-semibold text-olive">▲{vm.biggestMove.change}</span>{' '}
                {ordinal(vm.biggestMove.from)} → {ordinal(vm.biggestMove.to)} overall
              </Detail>
            </>
          ) : (
            <span className="text-paper-faint">—</span>
          )}
        </Fact>

        <Fact label="Best Closing Nine">
          {vm.bestClosingNine ? (
            <>
              <span className="tnum">
                {vm.bestClosingNine.name} · {vm.bestClosingNine.points}
              </span>
              <Detail>back-nine net points — round high</Detail>
            </>
          ) : (
            <span className="text-paper-faint">—</span>
          )}
        </Fact>

        <Fact label={`Closest to Pin · ${vm.parThreeCount} par 3s`}>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {vm.ctpWinners.map((c) => (
              <span
                key={c.holeNumber}
                className={`tnum rounded-full border px-2 py-0.5 text-[0.76rem] ${
                  c.name
                    ? 'border-hair bg-[var(--leader-tint)] text-paper'
                    : 'border-hair text-paper-faint'
                }`}
              >
                <b className="font-semibold">{c.holeNumber}</b> {c.name ? c.name.split(/\s+/)[0] : 'carry'}
              </span>
            ))}
            {vm.ctpWinners.length === 0 && <span className="text-paper-faint">—</span>}
          </div>
        </Fact>

        {/* lead-change strip spans the grid */}
        <div className="border-t border-hair p-4 sm:col-span-2">
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">
            Lead changed hands {vm.leadChangeCount} {vm.leadChangeCount === 1 ? 'time' : 'times'}
          </p>
          <div className="mt-2 flex h-11 items-end gap-px">
            {vm.holeLeaders.map((h) => (
              <div key={h.holeNumber} className="flex h-full flex-1 flex-col-reverse justify-start gap-0.5">
                {h.order.map((pid, idx) => (
                  <span
                    key={pid}
                    className="rounded-[1px]"
                    style={{
                      background: h.inPlay ? colorOf.get(pid) : 'var(--hair)',
                      flex: vm.players.length - idx,
                      opacity: h.inPlay ? (idx === 0 ? 1 : 0.28) : 0.5,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.74rem] text-paper-dim">
            {vm.players.map((p) => (
              <span key={p.playerId} className="inline-flex items-center gap-1.5">
                <i
                  className="inline-block h-2.5 w-2.5 rounded-[2px]"
                  style={{ background: colorOf.get(p.playerId) }}
                  aria-hidden
                />
                {p.short}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center gap-3 border-t border-hair bg-ground p-3">
        <span className="text-[0.74rem] text-paper-faint">
          {vm.official ? 'Final · ' : 'Live · '}derived on-device
        </span>
        <Link
          to="/standings"
          className="tap ml-auto inline-flex items-center rounded border border-hair-strong px-3 text-[0.85rem] font-semibold text-paper"
        >
          Standings
        </Link>
        <ShareButton vm={vm} winnerNames={winnerNames} verb={verb} />
      </div>
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-hair p-4 sm:[&:nth-child(odd)]:border-r sm:[&:nth-child(odd)]:border-r-hair">
      <p className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">{label}</p>
      <div className="fx-serif-sm mt-1.5 font-display text-[1.1rem] font-semibold leading-tight text-paper">
        {children}
      </div>
    </div>
  )
}

function Detail({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 font-sans text-[0.8rem] font-normal text-paper-dim">{children}</p>
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

/**
 * Share the recap as text via the Web Share API where available (needs HTTPS — the deploy
 * preview qualifies). The shareable IMAGE export is a deliberate follow-up; this ships the
 * group-text hand-off now without the canvas-rasterisation work.
 */
function ShareButton({
  vm,
  winnerNames,
  verb,
}: {
  vm: RoundRecapVM
  winnerNames: string
  verb: string
}) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  if (!canShare) return null

  const onShare = () => {
    const lines = [
      `${vm.course.name} — ${winnerNames} ${verb} it (${vm.winners[0]?.points ?? 0} pts${
        vm.margin > 0 ? `, by ${vm.margin}` : ''
      }).`,
    ]
    if (vm.biggestMove) lines.push(`Biggest move: ${vm.biggestMove.name} ▲${vm.biggestMove.change}.`)
    if (vm.bestClosingNine) lines.push(`Best back nine: ${vm.bestClosingNine.name} (${vm.bestClosingNine.points}).`)
    const ctp = vm.ctpWinners.filter((c) => c.name).map((c) => c.name!.split(/\s+/)[0])
    if (ctp.length) lines.push(`CTP: ${ctp.join(', ')}.`)
    void navigator.share({ title: `${vm.course.name} recap`, text: lines.join('\n') }).catch(() => {})
  }

  return (
    <button
      type="button"
      onClick={onShare}
      className="tap inline-flex items-center gap-1 rounded border border-gold-bright bg-gold-fill px-3 text-[0.85rem] font-semibold text-paper"
    >
      Share ↗
    </button>
  )
}
