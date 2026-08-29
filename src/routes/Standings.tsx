import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Movement } from '@/components/Movement'
import { useStandings } from '@/lib/data/selectors'
import { formatGap } from '@/lib/format'

function formatCounting(nums: number[]): string {
  if (nums.length === 1) return `Round ${nums[0]}`
  return `Rounds ${nums.join(', ').replace(/, (\d+)$/, ' & $1')}`
}

export default function Standings() {
  const standings = useStandings()

  if (!standings) return <LoadingStandings />

  const { rows, roundColumns, countingRoundNumbers, liveRoundNumbers, hasCountingRound } = standings
  const live = liveRoundNumbers.length > 0
  const hasUpcoming = roundColumns.some((c) => c.status === 'upcoming')
  const liveNote = live
    ? ` — Round${liveRoundNumbers.length > 1 ? 's' : ''} ${liveRoundNumbers.join(' & ')} live`
    : ''

  return (
    <Page>
      <PageHeader
        eyebrow="The Championship"
        title="Standings"
        meta={
          hasCountingRound ? (
            <>
              Net Stableford, cumulative{live ? ' and live' : ''}. Counting{' '}
              {formatCounting(countingRoundNumbers)}
              {liveNote}.
            </>
          ) : (
            'Net Stableford, cumulative across all four rounds.'
          )
        }
      />

      {!hasCountingRound ? (
        <p className="mt-8 text-paper-dim">
          No round has started yet. Standings appear the moment the first round is underway.
        </p>
      ) : (
        <>
          <ol className="mt-6">
            {rows.map((r) => {
              const isLeader = r.position === 1
              return (
                <li
                  key={r.playerId}
                  className={`grid grid-cols-[1.6rem_1.5rem_1fr_auto] items-center gap-x-3 border-b border-hair py-4 first:border-t first:border-t-hair-strong ${
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
                  <span className="text-center text-[0.85rem]">
                    <Movement change={r.positionChange} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[1.05rem] text-paper">{r.name}</span>
                    <span className="tnum text-[0.72rem] text-paper-faint">
                      {r.gapToLeader === 0 ? 'Leader' : `${formatGap(r.gapToLeader)} pts`}
                    </span>
                  </span>
                  <span
                    className={`tnum fx-title text-right font-display text-[1.6rem] font-semibold ${
                      isLeader ? 'text-gold-bright' : 'text-paper'
                    }`}
                  >
                    {r.total}
                  </span>
                </li>
              )
            })}
          </ol>

          {live && (
            <p className="mt-4 text-[0.76rem] text-gold">
              Totals include the live round as it currently stands.
            </p>
          )}

          <section className="mt-10">
            <span className="eyebrow block">Round by round</span>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[22rem] border-collapse text-[0.9rem]">
                <thead>
                  <tr className="text-paper-faint">
                    <th className="py-2 pr-3 text-left font-medium">Player</th>
                    {roundColumns.map((c) => (
                      <th
                        key={c.roundNumber}
                        className={`px-2 py-2 text-right font-medium ${c.counts ? 'text-paper-dim' : ''}`}
                      >
                        R{c.roundNumber}
                        {c.status === 'in_progress' && (
                          <span className="ml-0.5 align-super text-[0.6rem] text-gold-bright">•</span>
                        )}
                        {c.status === 'upcoming' && (
                          <span className="ml-0.5 align-super text-[0.6rem] text-paper-faint">·</span>
                        )}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-semibold text-paper-dim">Tot</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.playerId} className="border-t border-hair">
                      <td className="py-2 pr-3 text-paper">{r.name}</td>
                      {r.byRound.map((e) => (
                        <td
                          key={e.roundNumber}
                          className={`tnum px-2 py-2 text-right ${
                            e.counts ? 'text-paper' : 'text-paper-faint italic'
                          }`}
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
                    <span className="text-gold-bright">•</span> live — counted as it currently stands.
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
