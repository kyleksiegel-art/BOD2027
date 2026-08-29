import type { RoundDetailVM } from '@/lib/data/compute'

/**
 * The round's own leaderboard (this round's points only — distinct from the cumulative
 * championship on Standings). For a live round it shows "thru X" and the projected finish;
 * for a final round it just ranks the counted points.
 */
export function Leaderboard({ vm }: { vm: RoundDetailVM }) {
  const live = vm.round.status === 'in_progress'
  const board = vm.leaderboard

  if (board.length === 0) return null

  // Standard competition ranking (ties share a place).
  let lastPoints: number | null = null
  let lastRank = 0

  return (
    <section className="mt-8">
      <span className="eyebrow block">
        {vm.round.status === 'final' ? 'Result' : live ? 'Live leaderboard' : 'Leaderboard'}
      </span>
      <ol className="mt-4">
        {board.map((p, i) => {
          const rank = lastPoints !== null && p.totalPoints === lastPoints ? lastRank : i + 1
          lastPoints = p.totalPoints
          lastRank = rank
          return (
            <li
              key={p.playerId}
              className="grid grid-cols-[1.4rem_1fr_auto] items-center gap-x-3 border-b border-hair py-3 first:border-t first:border-t-hair-strong"
            >
              <span className="tnum font-display text-[1.1rem] font-semibold text-gold">{rank}</span>
              <span className="flex flex-col">
                <span className="text-paper">{p.name}</span>
                {live && (
                  <span className="tnum text-[0.72rem] text-paper-faint">
                    thru {p.thru}
                    {p.projection !== null ? ` · proj ${p.projection}` : ''}
                  </span>
                )}
              </span>
              <span className="tnum text-right font-display text-[1.35rem] font-semibold text-paper">
                {p.totalPoints}
                <span className="ml-1 text-[0.68rem] font-normal text-paper-faint">pts</span>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
