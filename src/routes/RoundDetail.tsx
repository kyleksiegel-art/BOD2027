import { useParams, Link } from 'react-router-dom'
import { Page } from '@/components/Page'
import { StatusBadge } from '@/components/StatusBadge'
import { Leaderboard } from '@/components/round/Leaderboard'
import { Scorecard } from '@/components/round/Scorecard'
import { HandicapWorksheet } from '@/components/round/HandicapWorksheet'
import { CtpEntry } from '@/components/round/CtpEntry'
import { useRoundCtp } from '@/lib/data/selectors'
import { courseSlug, formatDay, formatTeeTime } from '@/lib/format'

export default function RoundDetail() {
  const { roundNumber } = useParams()
  const n = Number(roundNumber)
  const { vm, ctpByHole, loading } = useRoundCtp(n)

  if (loading) {
    return (
      <Page>
        <BackLink />
        <p className="mt-8 animate-pulse text-paper-faint">Loading…</p>
      </Page>
    )
  }

  if (!vm) {
    return (
      <Page>
        <BackLink />
        <p className="mt-8 text-paper-dim">No round {roundNumber}.</p>
      </Page>
    )
  }

  const { round, course } = vm
  const notStarted = round.status === 'upcoming'
  const placeholder = course.data_is_placeholder

  return (
    <Page>
      <BackLink />

      <header className="round mt-4" data-course={courseSlug(course.name) ?? undefined}>
        <span className="eyebrow block">Round {round.round_number}</span>
        <h1 className="fx-head mt-2 flex items-center gap-3 font-display text-4xl font-semibold text-paper">
          <span className="round-swatch h-3 w-3 flex-none rounded-full" aria-hidden />
          {course.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusBadge status={round.status} />
          <span className="tnum text-[0.85rem] text-paper-dim">
            {formatDay(round.date)}
            {round.tee_time ? ` · ${formatTeeTime(round.tee_time)}` : ''}
          </span>
          {vm.isShortened && (
            <span className="text-[0.78rem] text-gold">
              Shortened — {vm.holesCounted} holes count
            </span>
          )}
        </div>
        <hr className="mt-5 border-hair" />
      </header>

      {placeholder ? (
        <div className="mt-8 rounded-lg border border-hair bg-ground-2/40 p-5">
          <p className="text-paper-dim">
            {course.name}’s scorecard isn’t published yet. Scoring unlocks once the card is entered
            and validated before Round {round.round_number}.
          </p>
        </div>
      ) : notStarted ? (
        <p className="mt-8 text-paper-dim">
          This round hasn’t started. Tee times and pairings show here; the scorecard fills in live
          once play begins.
        </p>
      ) : (
        <>
          <Leaderboard vm={vm} />
          <Scorecard vm={vm} />
          <CtpEntry vm={vm} ctpByHole={ctpByHole} />
          <HandicapWorksheet vm={vm} />
        </>
      )}
    </Page>
  )
}

function BackLink() {
  return (
    <Link
      to="/rounds"
      className="tap -ml-1 inline-flex items-center gap-1 text-[0.8rem] text-paper-faint"
    >
      <span aria-hidden>‹</span> All rounds
    </Link>
  )
}
