import { Link } from 'react-router-dom'
import type { RoundRecapVM, RecapAct } from '@/lib/data/compute'
import { courseSlug, formatDay, formatMoney } from '@/lib/format'

// Stable non-gold identity palette (gold is reserved for leader/winner status; red is the
// course rail). Indexed by RecapPlayer.colorIndex so a player keeps one colour all round.
const PLAYER_COLORS = ['var(--blue)', 'var(--gold-fill)', 'var(--olive)', 'var(--paper-faint)']

/**
 * The live round story: ONE card driven by round state. It opens as a live leaderboard, becomes
 * the round's story through the turn, tightens into late-round drama, and settles into the final
 * recap — all from buildRoundRecap, re-derived on every score change via the normal useLiveQuery
 * path (so it's live on every phone). The rest of /rounds/:n is untouched.
 */
export function RoundRecap({ vm }: { vm: RoundRecapVM }) {
  const slug = courseSlug(vm.course.name) ?? undefined
  const colorOf = new Map(vm.players.map((p) => [p.playerId, PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length]]))

  // Ribbon: leader per hole, and where the lead flipped.
  let prevLeader: string | null = null
  const cells = vm.holeLeaders.map((h) => {
    const leader = h.inPlay ? h.order[0] : null
    const flip = h.inPlay && prevLeader !== null && leader !== prevLeader
    if (h.inPlay) prevLeader = leader
    return { holeNumber: h.holeNumber, inPlay: h.inPlay, color: leader ? colorOf.get(leader) : undefined, flip }
  })
  const ribbonRight = ribbonCaption(vm.act, vm.leadChangeCount)

  return (
    <section
      className="round round-rail mt-6 overflow-hidden rounded-lg border border-hair bg-ground-2"
      data-course={slug}
    >
      {/* header */}
      <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
        <span className={`h-2 w-2 flex-none rounded-full ${vm.live ? 'recap-pulse' : 'round-swatch'}`} aria-hidden />
        <span className="eyebrow">{vm.live ? `Live · Round ${vm.round.round_number}` : 'Round Recap'}</span>
        <span
          className={`ml-auto rounded-sm border px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] tnum ${
            vm.official ? 'border-gold text-gold' : 'border-hair-strong text-paper-faint'
          }`}
        >
          {vm.official ? 'Official' : vm.live ? `Thru ${vm.roundThru}` : 'Final'}
        </span>
      </div>

      {/* hero: course, headline, narrative */}
      <div className="px-4 pb-3 pt-3">
        <p className="fx-serif-sm font-display text-[0.86rem] text-paper-dim">
          {vm.course.name} · {formatDay(vm.round.date)}
        </p>
        <h2 className="fx-head mt-0.5 font-display text-[1.75rem] font-semibold leading-none text-paper">
          {vm.headline.map((seg, i) => (
            <span key={i} className={seg.gold ? 'text-gold-bright' : undefined}>
              {seg.text}
            </span>
          ))}
        </h2>
        <p className="mt-2 text-[0.92rem] text-paper-dim">{vm.narrative}</p>
      </div>

      {/* leader ribbon */}
      <div className="px-4 pb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-paper-faint">
            How the lead moved
          </span>
          <span className="ml-auto text-[0.74rem] text-paper-dim">{ribbonRight}</span>
        </div>
        <div className="mt-1.5 flex gap-px">
          {cells.map((c) => (
            <span
              key={c.holeNumber}
              className="relative h-5 flex-1 rounded-[2px]"
              style={{ background: c.inPlay ? c.color : 'var(--hair)', opacity: c.inPlay ? 1 : 0.45 }}
            >
              {c.flip && (
                <span
                  className="absolute -top-[5px] left-[-1px] right-[-1px] h-[3px] rounded-[2px]"
                  style={{ background: 'var(--gold-fill)' }}
                  aria-hidden
                />
              )}
            </span>
          ))}
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

      {/* leaderboard */}
      <ol className="border-t border-hair">
        {vm.standing.map((p, i) => {
          const leader = i === 0
          return (
            <li
              key={p.playerId}
              className={`grid grid-cols-[1.2rem_1fr_auto] items-center gap-x-3 border-b border-hair px-4 py-2 last:border-b-0 ${
                leader ? 'leader-row' : ''
              }`}
            >
              <span className={`tnum fx-serif-sm font-display text-[0.95rem] font-semibold ${leader ? 'text-gold' : 'text-paper-faint'}`}>
                {i + 1}
              </span>
              <span className="flex flex-col">
                <span className="text-paper">{p.name}</span>
                {vm.live && (
                  <span className="tnum text-[0.7rem] text-paper-faint">
                    thru {p.thru}
                    {leader && p.projection !== null ? ` · proj ${p.projection}` : ''}
                    {!leader && p.gapToLeader > 0 ? ` · −${p.gapToLeader}` : ''}
                  </span>
                )}
              </span>
              <span className={`tnum fx-title text-right font-display text-[1.25rem] font-semibold ${leader ? 'text-gold-bright' : 'text-paper'}`}>
                {p.points}
                <span className="ml-0.5 text-[0.6rem] font-normal text-paper-faint">pts</span>
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

function ribbonCaption(act: RecapAct, changes: number): string {
  if (act === 'opening' && changes === 0) return 'wire to wire so far'
  if (changes === 0) return 'no change yet'
  return `${changes} lead change${changes === 1 ? '' : 's'}`
}

/** The facts row, chosen by act — nothing shows until it has signal. */
function ActFacts({ vm }: { vm: RoundRecapVM }) {
  const rows: { k: string; v: React.ReactNode }[] = []

  if (vm.act === 'moving') {
    if (vm.holesWonLeader)
      rows.push({ k: 'Holes won', v: `${vm.holesWonLeader.name} · ${vm.holesWonLeader.count} of ${vm.holesWonLeader.of}` })
    if (vm.shotOfTheDay)
      rows.push({
        k: 'Shot of the day',
        v: (
          <>
            {vm.shotOfTheDay.name} <Small>— {vm.shotOfTheDay.label}, {ordinal(vm.shotOfTheDay.holeNumber)}</Small>
          </>
        ),
      })
  } else if (vm.act === 'closing') {
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
    if (vm.biggestMove)
      rows.push({
        k: 'Biggest move',
        v: (
          <>
            <span className="text-olive">▲{vm.biggestMove.change}</span> {vm.biggestMove.name}{' '}
            <Small>
              {ordinal(vm.biggestMove.from)} → {ordinal(vm.biggestMove.to)} overall
            </Small>
          </>
        ),
      })
    else if (vm.holesWonLeader)
      rows.push({ k: 'Holes won', v: `${vm.holesWonLeader.name} · ${vm.holesWonLeader.count} of ${vm.holesWonLeader.of}` })
    if (vm.parThreeCount > 0) rows.push({ k: 'Closest to pin', v: <CtpChips vm={vm} /> })
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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

/**
 * Share the recap as text via the Web Share API where available (needs HTTPS — the deploy
 * preview qualifies). The shareable IMAGE export is a deliberate follow-up.
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
    if (vm.biggestMove) lines.push(`Biggest move: ${vm.biggestMove.name} ▲${vm.biggestMove.change}.`)
    if (vm.holesWonLeader) lines.push(`Holes won: ${vm.holesWonLeader.name} ${vm.holesWonLeader.count}.`)
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
