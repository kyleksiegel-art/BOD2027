import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { usePlayers, useSetting } from '@/lib/data/selectors'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

export default function Players() {
  const players = usePlayers()
  const footnote = useSetting<string>('assigned_index_footnote')

  const anyUnassigned = players?.some((p) => !p.player.index_is_assigned) ?? false

  return (
    <Page>
      <PageHeader eyebrow="The Field" title="Players" />

      {!players ? (
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      ) : (
        <>
          <ul className="mt-4">
            {players.map(({ player }) => (
              <li
                key={player.id}
                className="flex items-center gap-4 border-b border-hair py-4 first:border-t first:border-t-hair-strong"
              >
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-hair-strong bg-ground-2 font-display text-[0.9rem] font-semibold text-paper-dim">
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
                    {!player.index_is_assigned && <span className="text-gold">*</span>}
                  </span>
                  <span className="text-[0.62rem] uppercase tracking-[0.12em] text-paper-faint">
                    Index
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {anyUnassigned && footnote && (
            <p className="mt-5 text-[0.76rem] leading-relaxed text-paper-faint">
              <span className="text-gold">*</span> {footnote}
            </p>
          )}
        </>
      )}
    </Page>
  )
}
