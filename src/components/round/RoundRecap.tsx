import { Link } from 'react-router-dom'
import type { RoundRecapVM, RecapAct } from '@/lib/data/compute'
import { courseSlug, formatDay, formatMoney } from '@/lib/format'

// Stable non-gold identity palette (gold is reserved for leader/winner status; the course
// colour is the masthead). Indexed by RecapPlayer.colorIndex so a player keeps one colour.
const PLAYER_COLORS = ['var(--blue)', 'var(--gold-fill)', 'var(--olive)', 'var(--paper-faint)']

/**
 * The live round story, premium treatment: one card driven by round state. A sense-of-place
 * masthead, a hero figure, an editorial dispatch, the trip-race "Week" strip, the lead ribbon
 * and the live leaderboard — re-weighted opening → moving → closing → final. Everything comes
 * from buildRoundRecap and re-derives on every score change via the normal useLiveQuery path.
 */
export function RoundRecap({ vm }: { vm: RoundRecapVM }) {
  const slug = courseSlug(vm.course.name) ?? undefined
  const colorOf = new Map(vm.players.map((p) => [p.playerId, PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length]]))
  const leader = vm.standing[0]

  // Ribbon: leader per hole, and where the lead flipped.
  let prev: string | null = null
  const cells = vm.holeLeaders.map((h) => {
    const lead = h.inPlay ? h.order[0] : null
    const flip = h.inPlay && prev !== null && lead !== prev
    if (h.inPlay) prev = lead
    return { holeNumber: h.holeNumber, inPlay: h.inPlay, color: lead ? colorOf.get(lead) : undefined, flip }
  })
  const total = vm.holeLeaders.length
  const ribbonRight = ribbonCaption(vm.act, vm.leadChangeCount, vm.roundThru, total)

  const heroCaption = vm.live
    ? `pts · ${vm.margin > 0 ? `leads by ${vm.margin}` : 'tied'}${leader?.projection !== null ? ` · proj ${leader.projection}` : ''}`
    : `pts · ${vm.margin > 0 ? `won by ${vm.margin}` : 'shared'}`

  return (
    <section className="round recap-card mt-6 overflow-hidden rounded-lg" data-course={slug}>
      {/* masthead — sense of place */}
      <div className="recap-mast px-4 pb-3 pt-3.5">
        <Topo />
        <div className="relative flex items-center gap-2">
          <span className={`h-2 w-2 flex-none rounded-full ${vm.live ? 'recap-pulse' : 'round-swatch'}`} aria-hidden />
          <span className="text-[0.64rem] font-semibold uppercase tracking-[0.2em] text-gold">
            {vm.live ? 'Live' : 'Recap'} · Round {vm.round.round_number} of 4
          </span>
          <span
            className={`ml-auto rounded-sm border bg-ground-2 px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.14em] tnum ${
              vm.official ? 'border-gold text-gold' : 'border-hair-strong text-paper-faint'
            }`}
          >
            {vm.official ? 'Official' : vm.live ? `Thru ${vm.roundThru}` : 'Final'}
          </span>
        </div>
        <h2 className="fx-display relative mt-2 font-display text-[2rem] font-semibold leading-none text-paper">
          {vm.course.name}
        </h2>
        <p className="relative mt-1 text-[0.8rem] text-paper-dim">{formatDay(vm.round.date)}</p>
      </div>

      {/* hero — headline, big figure, dispatch */}
      <div className="px-4 pb-1 pt-3">
        <h3 className="fx-title font-display text-[1.5rem] font-semibold leading-tight text-paper">
          {vm.headline.map((seg, i) => (
            <span key={i} className={seg.gold ? 'text-gold-bright' : undefined}>
              {seg.text}
            </span>
          ))}
        </h3>
        <div className="mt-2 flex items-end gap-2.5">
          <span className="fx-display font-display text-[3.2rem] font-semibold leading-[0.8] tracking-tight text-paper tnum">
            {leader?.points ?? 0}
          </span>
          <span className="pb-1 text-[0.84rem] text-paper-dim">{heroCaption}</span>
        </div>
        <p className="recap-dispatch mt-3 pl-3 text-[0.98rem] leading-snug text-paper-dim">{vm.dispatch}</p>
      </div>

      {/* THE WEEK — championship context (round 2+) */}
      {vm.week && <TheWeek vm={vm} />}

      {/* leader ribbon */}
      <div className="px-4 pb-3 pt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">
            How the lead moved
          </span>
          <span className="ml-auto text-[0.74rem] text-paper-dim">{ribbonRight}</span>
        </div>
        <div className="mt-1.5 flex h-5 items-center gap-px">
          {cells.map((c) =>
            c.inPlay ? (
              <span key={c.holeNumber} className="relative h-full flex-1 rounded-[2px]" style={{ background: c.color }}>
                {c.flip && (
                  <span
                    className="absolute -top-[5px] left-[-1px] right-[-1px] h-[3px] rounded-[2px]"
                    style={{ background: 'var(--gold-fill)' }}
                    aria-hidden
                  />
                )}
              </span>
            ) : (
              <span key={c.holeNumber} className="flex h-full flex-1 items-center">
                <span className="h-[3px] w-full rounded-full bg-hair" />
              </span>
            ),
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.72rem] text-paper-dim">
          {vm.players.map((p) => (
            <span key={p.playerId} className="inline-flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: colorOf.get(p.playerId) }} aria-hidden />
              {p.short}
            </span>
          ))}
          <span className="text-gold-bright">▏ lead flip</span>
        </div>
      </div>

      {/* this round */}
      <p className="border-t border-hair px-4 pb-0.5 pt-2 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">
        This round
      </p>
      <ol>
        {vm.standing.map((p, i) => {
          const isLead = i === 0
          return (
            <li
              key={p.playerId}
              className={`grid grid-cols-[1.1rem_1fr_auto] items-center gap-x-3 border-b border-hair px-4 py-1.5 last:border-b-0 ${
                isLead ? 'leader-row' : ''
              }`}
            >
              <span className={`tnum fx-serif-sm font-display text-[0.9rem] font-semibold ${isLead ? 'text-gold' : 'text-paper-faint'}`}>
                {i + 1}
              </span>
              <span className="flex flex-col">
                <span className="text-paper">{p.name}</span>
                {vm.live && (
                  <span className="tnum text-[0.7rem] text-paper-faint">
                    thru {p.thru}
                    {isLead && p.projection !== null ? ` · proj ${p.projection}` : ''}
                    {!isLead && p.gapToLeader > 0 ? ` · −${p.gapToLeader}` : ''}
                  </span>
                )}
              </span>
              <span className={`tnum font-display text-[1.15rem] font-semibold ${isLead ? 'text-gold-bright' : 'text-paper'}`}>
                {p.points}
                <span className="ml-0.5 text-[0.58rem] font-normal text-paper-faint">pts</span>
              </span>
            </li>
          )
        })}
      </ol>

      {/* act-specific facts */}
      <ActFacts vm={vm} />

      {/* footer */}
      <div className="flex items-center gap-2.5 border-t border-hair bg-ground px-4 py-2.5">
        <span className="tnum text-[0.72rem] text-paper-faint">
          {vm.live ? `Live · thru ${vm.roundThru} · updating` : 'Final · derived on-device'}
        </span>
        <Link
          to="/standings"
          className="tap ml-auto inline-flex items-center rounded border border-hair-strong px-3 text-[0.82rem] font-semibold text-paper"
        >
          Standings
        </Link>
        {!vm.live && <ShareButton vm={vm} />}
      </div>
    </section>
  )
}

/** Topographic wash — a few smooth contours in the course colour, evoking Streamsong's land. */
function Topo() {
  return (
    <div className="recap-topo" aria-hidden>
      <svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M-20 120 C 60 90, 120 140, 200 108 S 340 70, 430 100" />
        <path d="M-20 100 C 70 74, 130 118, 210 88 S 350 52, 430 82" />
        <path d="M-20 80 C 80 58, 140 96, 220 70 S 360 38, 430 64" />
        <path d="M-20 60 C 90 44, 150 76, 230 54 S 360 26, 430 48" />
        <path d="M-20 40 C 100 30, 160 58, 240 40 S 360 16, 430 34" />
        <path d="M-20 138 C 60 112, 120 156, 210 126 S 350 92, 430 120" />
      </svg>
    </div>
  )
}

/** The trip race — overall standings and what this round is doing to them. */
function TheWeek({ vm }: { vm: RoundRecapVM }) {
  const week = vm.week!
  return (
    <div className="mx-4 mb-1 overflow-hidden rounded-md border border-hair recap-week-tint">
      <div className="flex items-baseline gap-2 px-3 pb-1 pt-2">
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-paper-faint">The Week</span>
        <span className="ml-auto text-[0.72rem] text-paper-dim">{week.throughLabel}</span>
      </div>
      <p className="fx-serif-sm px-3 pb-1.5 font-display text-[0.9rem] font-medium text-paper">
        <WeekLine line={week.line} leader={week.leaderName} />
      </p>
      {week.rows.map((r, i) => (
        <div
          key={r.playerId}
          className={`grid grid-cols-[1rem_1fr_auto_2.6rem] items-center gap-x-2.5 border-t border-hair px-3 py-1 text-[0.9rem] ${
            i === 0 ? 'bg-[var(--leader-tint)]' : ''
          }`}
        >
          <span className={`tnum fx-serif-sm font-display text-[0.85rem] font-semibold ${i === 0 ? 'text-gold' : 'text-paper-faint'}`}>
            {r.position}
          </span>
          <span className="text-paper">{r.name}</span>
          <span className={`tnum text-[0.74rem] font-semibold ${r.change > 0 ? 'text-olive' : r.change < 0 ? 'text-red' : 'text-paper-faint'}`}>
            {r.change > 0 ? `▲${r.change}` : r.change < 0 ? `▼${-r.change}` : '—'}
          </span>
          <span className="tnum text-right font-display text-[1rem] font-semibold text-paper">{r.overall}</span>
        </div>
      ))}
    </div>
  )
}

// The week line names the leader first — render that name in gold to tie it to the leader row.
function WeekLine({ line, leader }: { line: string; leader: string }) {
  const first = leader.split(/\s+/)[0]
  if (line.startsWith(first)) {
    return (
      <>
        <span className="text-gold-bright">{first}</span>
        {line.slice(first.length)}
      </>
    )
  }
  return <>{line}</>
}

function ribbonCaption(act: RecapAct, changes: number, thru: number, total: number): string {
  if (act === 'final') return `${changes} lead change${changes === 1 ? '' : 's'}`
  const moved = changes === 0 ? (act === 'opening' ? 'wire to wire' : 'no change') : `${changes} lead change${changes === 1 ? '' : 's'}`
  return `thru ${thru} of ${total} · ${moved}`
}

/**
 * The facts row. A ranked highlight picker fills the "interesting stat" slot(s) — whichever
 * point-native superlative has the most signal wins, so nothing shows a dead value. The
 * structural facts (winner · pays, to-play, CTP) are added per act around it.
 */
function ActFacts({ vm }: { vm: RoundRecapVM }) {
  const rows: { k: string; v: React.ReactNode }[] = []
  const hi = vm.highlights
  const highlightRow = (h: (typeof hi)[number]) => ({ k: h.label, v: <FactValue value={h.value} /> })

  if (vm.act === 'closing') {
    if (hi[0]) rows.push(highlightRow(hi[0]))
    rows.push({ k: 'To play', v: <ToPlay vm={vm} /> })
    if (vm.parThreeCount > 0) rows.push({ k: 'Closest to pin', v: <CtpChips vm={vm} /> })
  } else if (vm.act === 'final') {
    rows.push({
      k: vm.roundWinnerCents ? 'Winner · pays' : 'Winner',
      v: (
        <>
          {vm.winners.map((w) => w.name.split(/\s+/)[0]).join(' & ')}
          {vm.roundWinnerCents ? ` · ${formatMoney(vm.roundWinnerCents)}` : ''}{' '}
          <Small>
            {vm.winners[0]?.points} pts{vm.margin > 0 ? `, by ${vm.margin}` : ''}
          </Small>
        </>
      ),
    })
    hi.slice(0, 2).forEach((h) => rows.push(highlightRow(h)))
    if (vm.parThreeCount > 0) rows.push({ k: 'Closest to pin', v: <CtpChips vm={vm} /> })
  } else {
    // opening / moving — the highlights carry the card
    hi.slice(0, 2).forEach((h) => rows.push(highlightRow(h)))
  }

  if (rows.length === 0) return null

  return (
    <div className="border-t border-hair">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline gap-3 border-b border-hair px-4 py-2 last:border-b-0">
          <span className="w-[7rem] flex-none text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-paper-faint">
            {r.k}
          </span>
          <span className="fx-serif-sm font-display text-[0.98rem] font-semibold text-paper">{r.v}</span>
        </div>
      ))}
    </div>
  )
}

function ToPlay({ vm }: { vm: RoundRecapVM }) {
  const holes: number[] = []
  for (let h = vm.roundThru + 1; h <= vm.roundThru + vm.remaining; h++) holes.push(h)
  return (
    <span className="tnum">
      {holes.map((h, i) => (
        <span key={h}>
          {i > 0 ? ' · ' : ''}
          {h === vm.nextPar3 ? (
            <b>
              {h} <span className="font-sans text-[0.72rem] font-normal text-paper-dim">par 3</span>
            </b>
          ) : (
            h
          )}
        </span>
      ))}
    </span>
  )
}

function CtpChips({ vm }: { vm: RoundRecapVM }) {
  return (
    <span className="flex flex-wrap gap-1">
      {vm.ctpWinners.map((c) => (
        <span
          key={c.holeNumber}
          className={`tnum rounded-full border px-2 py-0.5 text-[0.74rem] ${
            c.name ? 'border-hair bg-[var(--leader-tint)] text-paper' : 'border-hair text-paper-faint'
          }`}
        >
          <b className="font-semibold">{c.holeNumber}</b> {c.name ? c.name.split(/\s+/)[0] : c.open ? 'open' : 'carry'}
        </span>
      ))}
    </span>
  )
}

function Small({ children }: { children: React.ReactNode }) {
  return <span className="font-sans text-[0.78rem] font-normal text-paper-dim">{children}</span>
}

/** A highlight value like "Kyle · 4" or "Kyle · net eagle, 7th": lead in serif, detail muted. */
function FactValue({ value }: { value: string }) {
  const i = value.indexOf(' · ')
  if (i === -1) return <>{value}</>
  return (
    <>
      {value.slice(0, i)} <Small>{value.slice(i + 3)}</Small>
    </>
  )
}

/**
 * Share the recap as text via the Web Share API where available. The image export is a
 * deliberate follow-up.
 */
function ShareButton({ vm }: { vm: RoundRecapVM }) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  if (!canShare) return null

  const onShare = () => {
    const winnerNames = vm.winners.map((w) => w.name.split(/\s+/)[0]).join(' & ')
    const lines = [
      `${vm.course.name} — ${winnerNames} ${vm.winners.length > 1 ? 'share it' : 'takes it'} (${
        vm.winners[0]?.points ?? 0
      } pts${vm.margin > 0 ? `, by ${vm.margin}` : ''}).`,
    ]
    if (vm.week) lines.push(vm.week.line)
    for (const h of vm.highlights.slice(0, 2)) lines.push(`${h.label}: ${h.value}.`)
    const ctp = vm.ctpWinners.filter((c) => c.name).map((c) => c.name!.split(/\s+/)[0])
    if (ctp.length) lines.push(`CTP: ${ctp.join(', ')}.`)
    void navigator.share({ title: `${vm.course.name} recap`, text: lines.join('\n') }).catch(() => {})
  }

  return (
    <button
      type="button"
      onClick={onShare}
      className="tap inline-flex items-center gap-1 rounded border border-gold-bright bg-gold-fill px-3 text-[0.82rem] font-semibold text-paper"
    >
      Share ↗
    </button>
  )
}
