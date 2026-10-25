import { roundStatusLabel } from '@/lib/format'
import type { RoundStatusRow } from '@/lib/data/types'

const STYLES: Record<RoundStatusRow, string> = {
  final: 'border-hair-strong text-paper-dim',
  in_progress: 'border-gold text-gold-bright',
  upcoming: 'border-hair text-paper-faint',
  abandoned: 'border-hair text-paper-faint line-through',
}

/**
 * Small round-status pill: Upcoming → Live → Scores in → Final. Live glows gold; "Scores in"
 * (every score entered, not yet finalized) drops the pulse; everything else is quiet.
 */
export function StatusBadge({ status, scoresIn = false }: { status: RoundStatusRow; scoresIn?: boolean }) {
  const live = status === 'in_progress' && !scoresIn
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] ${STYLES[status]}`}
    >
      {live && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gold-bright" />}
      {status === 'in_progress' && scoresIn ? 'Scores in' : roundStatusLabel(status)}
    </span>
  )
}
