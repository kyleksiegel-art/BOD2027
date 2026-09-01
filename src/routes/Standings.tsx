import { Link } from 'react-router-dom'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Movement } from '@/components/Movement'
import { useStandings } from '@/lib/data/selectors'
import type { StandingsLiveRound } from '@/lib/data/compute'
import { formatBack, formatLiveLine } from '@/lib/format'

/**
 * The live-round status line ("● ROUND 3 LIVE · SCORES THROUGH HOLE 12"). Renders only while
 * a round is in progress; nothing when the trip is between rounds. When the field spreads more
 * than a hole apart we show an honest range instead of one inaccurate number.
 */
function LiveStatus({ live }: { live: StandingsLiveRound }) {
  if (live.allComplete) {
    return (
      <div className="mt-3 inline-flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-paper-faint">
        <span className="h-2 w-2 rounded-full bg-paper-faint" aria-hidden />
        Round {live.roundNumber} complete · scores in
      </div>
    )
  }

  let where: string
  if (!live.started) {
    where = 'awaiting first scores'
  } else if (live.thruMax - live.thruMin <= 1) {
    where = `scores through hole ${live.thruMax}`
  } else {
    where = `scores thru ${live.thruMin}–${live.thruMax}`
  }

  return (
    <div className="mt-3 inline-flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-gold">
      <span className="live-dot h-2 w-2 rounded-full" aria-hidden />
      Round {live.roundNumber} live · {where}
    </div>
  )
}

export default function Standings() {
  const standings = useStandings()

  if (!standings) return <LoadingStandings />

  const { rows, roundColumns, liveRound, hasCountingRound } = standings
  const live = liveRound !== null
  const hasUpcoming = roundColumns.some((c) => c.status === 'upcoming')

  return (
    <Page>
      <PageHeader
        eyebrow="The Championship"
        title="Standings"
        meta="Net Stableford · Cumulative Championship"
      />

      {live && <LiveStatus live={liveRound} />}

      {!hasCountingRound ? (
        <p className="mt-8 text-paper-dim">
          No round has started yet. Standings appear the moment the first round is underway.
        </p>
      ) : (
        <>
          <ol className="mt-6">
            {rows.map((r) => {
              const isLeader = r.position === 1
              const liveLine = r.live ? formatLiveLine(r.live) : null
              return (
                <li
                  key={r.playerId}
                  className={`grid grid-cols-[1.5rem_1.6rem_1fr_auto] items-center gap-x-3 border-b border-hair py-4 first:border-t first:border-t-hair-strong ${
                    isLeader ? 'leader-row' : ''
                  }`}
                >
                  <span
                    className={`tnum fx-title font-display text-[1.35rem] font-semibold ${
                      isLeader ? 'text-gold' : 'text-paper-faint'
                    }`}
                  >
                    {r.position}
                  </span>
                  <span className="text-center text-[0.78rem]">
                    <Movement change={r.positionChange} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[1.05rem] text-paper">{r.name}</span>
                    {liveLine && (
                      <span
                        className={`tnum text-[0.72rem] text-paper-faint ${
                          r.live?.thru === 0 || r.live?.status === 'did_not_play' ? 'italic' : ''
                        }`}
                      >
                        {liveLine}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col items-end gap-0.5 text-right">
                    <span
                      className={`tnum fx-title font-display text-[1.6rem] font-semibold leading-none ${
                        isLeader ? 'text-gold-bright' : 'text-paper'
                      }`}
                    >
                      {r.total}
                    </span>
                    <span
                      className={`tnum text-[0.66rem] font-semibold uppercase tracking-[0.08em] ${
                        isLeader ? 'text-gold' : 'text-paper-faint'
                      }`}
                    >
                      {formatBack(r.gapToLeader)}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>

          <section className="mt-10">
            <span className="eyebrow block">Round by round</span>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[22rem] border-collapse text-[0.9rem]">
                <thead>
                  <tr className="text-paper-faint">
                    <th className="py-2 pr-3 text-left font-medium">Player</th>
                    {roundColumns.map((c) => {
                      const isLive = c.status === 'in_progress'
                      return (
                        <th
                          key={c.roundNumber}
                          className={`px-2 py-2 text-right align-bottom font-medium ${
                            isLive ? 'live-col text-gold' : c.counts ? 'text-paper-dim' : ''
                          }`}
                        >
                          {/* The round header is the drill-down into that round's card. Kept
                              near-invisible (no underline, inherits the header colour) so the
                              table stays quiet; a hairline appears only on hover/focus. */}
                          <Link
                            to={`/rounds/${c.roundNumber}`}
                            className="inline-flex flex-col items-end rounded-sm outline-none hover:text-gold focus-visible:ring-2 focus-visible:ring-gold-fill/60"
                            aria-label={`Round ${c.roundNumber}${isLive ? ', live' : ''}`}
                          >
                            <span>
                              R{c.roundNumber}
                              {isLive && (
                                <span className="ml-0.5 text-[0.6rem] text-gold-bright">●</span>
                              )}
                              {c.status === 'upcoming' && (
                                <span className="ml-0.5 align-super text-[0.6rem] text-paper-faint">·</span>
                              )}
                            </span>
                            {isLive && (
                              <span className="block text-[0.55rem] font-semibold tracking-[0.14em] text-gold">
                                LIVE
                              </span>
                            )}
                          </Link>
                        </th>
                      )
                    })}
                    <th className="px-2 py-2 text-right font-semibold uppercase tracking-[0.04em] text-paper-dim">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.playerId} className="border-t border-hair">
                      <td className="whitespace-nowrap py-2 pr-3 text-paper">{r.name}</td>
                      {r.byRound.map((e) => (
                        <td
                          key={e.roundNumber}
                          className={`tnum px-2 py-2 text-right ${
                            e.status === 'in_progress' ? 'live-col ' : ''
                          }${e.counts ? 'text-paper' : 'text-paper-faint italic'}`}
                        >
                          {e.status === 'upcoming' ? '—' : e.points}
                        </td>
                      ))}
                      <td className="tnum px-2 py-2 text-right font-semibold text-paper">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(live || hasUpcoming) && (
              <p className="mt-3 text-[0.72rem] leading-relaxed text-paper-faint">
                {live && (
                  <>
                    <span className="text-gold-bright">●</span> live — counted as it currently stands.
                  </>
                )}
                {live && hasUpcoming ? ' ' : ''}
                {hasUpcoming && (
                  <>
                    <span className="text-paper-faint">·</span> upcoming — not yet played.
                  </>
                )}
              </p>
            )}
          </section>
        </>
      )}
    </Page>
  )
}

function LoadingStandings() {
  return (
    <Page>
      <PageHeader eyebrow="The Championship" title="Standings" />
      <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
    </Page>
  )
}
