import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { usePlayers } from '@/lib/data/selectors'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export default function Players() {
  const players = usePlayers()

  return (
    <Page>
      <PageHeader eyebrow="The Field" title="Players" />

      {!players ? (
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      ) : (
        <>
          <ul className="mt-4">
            {players.map(({ player, courseHandicaps }) => (
              <li
                key={player.id}
                className="border-b border-hair py-4 first:border-t first:border-t-hair-strong"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-[0.9rem] font-semibold text-gold">
                    {player.photo_url ? (
                      <img
                        src={player.photo_url}
                        alt={player.name}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      initials(player.name)
                    )}
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="text-[1.05rem] text-paper">{player.name}</span>
                    {player.title && (
                      <span className="text-[0.76rem] text-paper-faint">{player.title}</span>
                    )}
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="tnum font-display text-[1.15rem] font-semibold text-paper">
                      {player.handicap_index.toFixed(1)}
                    </span>
                    <span className="text-[0.62rem] uppercase tracking-[0.12em] text-paper-faint">
                      Index
                    </span>
                  </span>
                </div>

                {courseHandicaps.length > 0 && (
                  <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 pl-[3.75rem]">
                    {courseHandicaps.map((ch) => (
                      <div key={ch.roundNumber} className="flex items-baseline gap-1.5">
                        <dt className="text-[0.7rem] text-paper-faint">{ch.courseName}</dt>
                        <dd className="tnum text-[0.82rem] font-semibold text-paper-dim">
                          {ch.didNotPlay
                            ? 'DNP'
                            : ch.playingHandicap !== null
                              ? ch.playingHandicap
                              : '—'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[0.72rem] text-paper-faint">
            Numbers under each name are that player’s course handicap at each course.
          </p>
        </>
      )}
    </Page>
  )
}
