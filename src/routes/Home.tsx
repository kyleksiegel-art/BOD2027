import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { COUNTDOWN_TARGET_ISO, TRIP, PLAYERS, ROUNDS } from '@/config/trip'
import { useRoundsList, useStandings, useRoundDetail } from '@/lib/data/selectors'

const TARGET = new Date(COUNTDOWN_TARGET_ISO).getTime()

interface Remaining {
  days: number
  hours: number
  minutes: number
  seconds: number
  done: boolean
}

function remainingFrom(now: number): Remaining {
  const diff = TARGET - now
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true }
  const t = Math.floor(diff / 1000)
  return {
    days: Math.floor(t / 86400),
    hours: Math.floor((t % 86400) / 3600),
    minutes: Math.floor((t % 3600) / 60),
    seconds: t % 60,
    done: false,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

function CountdownUnit({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex w-full flex-col items-center">
      <span className="tnum font-display text-[clamp(2.5rem,15vw,4.6rem)] font-semibold leading-none tracking-tight text-paper">
        {value}
      </span>
      <span className="mt-2 text-[0.6rem] font-semibold uppercase tracking-[0.24em] text-paper-faint">
        {label}
      </span>
    </div>
  )
}

function Countdown({ r }: { r: Remaining }) {
  return (
    <div className="py-8 text-center sm:py-10">
      <hr className="border-0 [background:linear-gradient(90deg,var(--gold)_0%,rgba(209,131,22,0.12)_100%)] [height:1.5px]" />
      <div
        className="mt-6 grid grid-cols-4 items-end justify-items-center gap-2 sm:gap-6"
        role="timer"
        aria-live="off"
      >
        <CountdownUnit value={String(r.days)} label="Days" />
        <CountdownUnit value={pad(r.hours)} label="Hours" />
        <CountdownUnit value={pad(r.minutes)} label="Minutes" />
        <CountdownUnit value={pad(r.seconds)} label="Seconds" />
      </div>
      <p className="mt-6 text-[0.9rem] text-paper-dim">
        First tee — <strong className="font-semibold text-gold-bright">Thu, Feb 4</strong>{' '}
        · <strong className="font-semibold text-gold-bright">1:10 PM ET</strong> ·
        Streamsong Red
      </p>
    </div>
  )
}

/** Small CTA that matches the annual-report treatment — gold hairline, plain copy. */
function LiveLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-[44px] items-center justify-center rounded-sm border border-hair-strong px-4 text-[0.82rem] font-semibold uppercase tracking-[0.1em] text-paper transition-colors hover:border-gold hover:text-gold-bright"
    >
      {children}
    </Link>
  )
}

/**
 * Once the trip is underway the countdown is dead weight — this replaces it with the one
 * thing worth glancing at from the lock screen: what's live, who leads it, and who leads the
 * championship, with one tap into the screen you actually need. Reads only from selectors,
 * so it is offline-identical to every other screen.
 */
function LivePanel() {
  const roundsList = useRoundsList()
  const standings = useStandings()

  // Pick the round in play, else the next one up. buildRoundDetail(0) returns null, so the
  // detail hook is always called (hook-order safe) and simply idles when nothing is live.
  const inProgress = roundsList?.find((r) => r.round.status === 'in_progress')
  const { vm: liveDetail } = useRoundDetail(inProgress?.round.round_number ?? 0)

  if (!roundsList || !standings) {
    return (
      <div className="py-8">
        <hr className="border-0 [background:linear-gradient(90deg,var(--gold)_0%,rgba(209,131,22,0.12)_100%)] [height:1.5px]" />
        <p className="mt-6 animate-pulse text-center text-paper-faint">Loading the board…</p>
      </div>
    )
  }

  const nextUp = roundsList.find((r) => r.round.status === 'upcoming')
  const allDone =
    roundsList.length > 0 &&
    roundsList.every((r) => r.round.status === 'final' || r.round.status === 'abandoned')

  const leaders = standings.hasCountingRound
    ? standings.rows.filter((r) => r.position === 1)
    : []
  const overall =
    leaders.length === 0
      ? null
      : leaders.length === 1
        ? { text: leaders[0].name, points: leaders[0].total, tied: false }
        : { text: leaders.map((l) => l.name).join(' & '), points: leaders[0].total, tied: true }

  return (
    <div className="py-8">
      <hr className="border-0 [background:linear-gradient(90deg,var(--gold)_0%,rgba(209,131,22,0.12)_100%)] [height:1.5px]" />

      {inProgress ? (
        <OnCourse
          course={inProgress.course.name}
          roundNo={inProgress.round.round_number}
          detail={liveDetail}
        />
      ) : allDone ? (
        <Complete overall={overall} />
      ) : nextUp ? (
        <BetweenRounds course={nextUp.course.name} roundNo={nextUp.round.round_number} />
      ) : (
        <p className="mt-6 text-center text-paper-dim">The trip is underway.</p>
      )}

      {/* Championship line — shown whenever a round has counted, in every live state. */}
      {overall && !allDone && (
        <p className="mt-6 text-center text-[0.9rem] text-paper-dim">
          {overall.tied ? 'Tied at the top' : 'Leading the championship'} —{' '}
          <strong className="font-semibold text-paper">{overall.text}</strong>{' '}
          <span className="tnum text-gold">{overall.points} pts</span>
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        {inProgress ? (
          <>
            <LiveLink to="/enter">Enter scores</LiveLink>
            <LiveLink to="/standings">Standings</LiveLink>
          </>
        ) : allDone ? (
          <>
            <LiveLink to="/standings">Final standings</LiveLink>
            <LiveLink to="/money">The money</LiveLink>
          </>
        ) : (
          <>
            <LiveLink to="/standings">Standings</LiveLink>
            <LiveLink to="/rounds">Rounds</LiveLink>
          </>
        )}
      </div>
    </div>
  )
}

function OnCourse({
  course,
  roundNo,
  detail,
}: {
  course: string
  roundNo: number
  detail: ReturnType<typeof useRoundDetail>['vm']
}) {
  const leader = detail?.leaderboard[0]
  const holesTotal = detail?.holes?.length ?? 18
  const leaderHasScore = leader && leader.totalPoints > 0 && leader.thru > 0

  return (
    <>
      <div className="mt-6 flex items-center justify-center gap-2">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-gold-bright" />
        <span className="eyebrow">On the course now</span>
      </div>
      <h2 className="mt-3 text-center font-display text-[clamp(2rem,10vw,3rem)] font-semibold leading-none tracking-tight text-paper">
        {course}
      </h2>
      <p className="mt-2 text-center text-[0.8rem] uppercase tracking-[0.12em] text-paper-dim">
        Round {roundNo} of 4
      </p>
      <p className="mt-4 text-center text-[0.95rem]">
        {leaderHasScore ? (
          <>
            <strong className="font-semibold text-paper">{leader!.name}</strong> leads{' '}
            <span className="tnum text-gold">{leader!.totalPoints} pts</span>
            <span className="text-paper-faint"> · thru {leader!.thru}/{holesTotal}</span>
          </>
        ) : (
          <span className="text-paper-dim">No scores in yet — tee it up.</span>
        )}
      </p>
    </>
  )
}

function BetweenRounds({ course, roundNo }: { course: string; roundNo: number }) {
  const card = ROUNDS.find((r) => r.no === roundNo)
  return (
    <>
      <div className="mt-6 text-center">
        <span className="eyebrow">Up next</span>
      </div>
      <h2 className="mt-3 text-center font-display text-[clamp(2rem,10vw,3rem)] font-semibold leading-none tracking-tight text-paper">
        {course}
      </h2>
      <p className="mt-2 text-center text-[0.8rem] uppercase tracking-[0.12em] text-paper-dim">
        Round {roundNo} of 4
        {card ? (
          <>
            {' · '}
            <span className="text-gold">{card.day}</span> · {card.tee}
          </>
        ) : null}
      </p>
    </>
  )
}

function Complete({
  overall,
}: {
  overall: { text: string; points: number; tied: boolean } | null
}) {
  return (
    <>
      <div className="mt-6 text-center">
        <span className="eyebrow">The Championship</span>
      </div>
      {overall ? (
        <>
          <p className="mt-3 text-center text-[0.8rem] uppercase tracking-[0.12em] text-paper-dim">
            {overall.tied ? 'Shared title' : 'Champion'}
          </p>
          <h2 className="mt-2 text-center font-display text-[clamp(2rem,10vw,3rem)] font-semibold leading-none tracking-tight text-gold-bright">
            {overall.text}
          </h2>
          <p className="mt-3 text-center text-[0.95rem] text-paper-dim">
            {overall.points} points · Streamsong 2027
          </p>
        </>
      ) : (
        <p className="mt-6 text-center text-paper-dim">All four rounds are in the books.</p>
      )}
    </>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`flex-none text-paper-faint transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/**
 * One row of The Card. Tapping the row expands that round's leaderboard, read live from the
 * same selectors as every other screen — so it is offline-identical and updates as scores land.
 * Before a round has any scores (every upcoming round) it simply says so. ROUNDS is a fixed
 * four, so calling the detail hook once per row is hook-order-stable.
 */
function CardRound({
  round,
  open,
  onToggle,
}: {
  round: (typeof ROUNDS)[number]
  open: boolean
  onToggle: () => void
}) {
  const { vm } = useRoundDetail(round.no)
  const hasScores = vm?.leaderboard.some((p) => p.thru > 0) ?? false
  const panelId = `round-leaderboard-${round.no}`

  return (
    <div className="border-b border-hair first:border-t first:border-t-hair-strong">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="tap grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-4 py-3.5 text-left"
      >
        <span className="font-display text-[0.75rem] uppercase tracking-[0.15em] text-paper-faint">
          R{round.no}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="font-display text-[1.14rem] font-semibold text-paper">
            {round.course}
          </span>
          <span className="text-[0.76rem] text-paper-faint">{round.architect}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="tnum whitespace-nowrap text-right text-[0.8rem] text-paper-dim">
            {round.day}
            <span className="mt-0.5 block text-[0.72rem] tracking-[0.04em] text-gold">
              {round.tee}
            </span>
          </span>
          <Chevron open={open} />
        </span>
      </button>

      {open && (
        <div id={panelId} className="pb-4">
          {hasScores ? (
            <ol className="mt-1">
              {vm!.leaderboard.map((p, i) => (
                <li
                  key={p.playerId}
                  className="flex items-baseline justify-between gap-3 border-t border-hair/60 py-2"
                >
                  <span className="flex items-baseline gap-3">
                    <span className="tnum w-4 text-[0.75rem] text-paper-faint">{i + 1}</span>
                    <span className="text-[0.95rem] text-paper">{p.name}</span>
                  </span>
                  <span className="tnum text-[0.85rem]">
                    <span className="font-semibold text-gold">{p.totalPoints}</span>
                    <span className="text-paper-faint"> pts · thru {p.thru}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-2 text-[0.85rem] text-paper-dim">No scores in yet.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function Home() {
  const [r, setR] = useState<Remaining>(() => remainingFrom(Date.now()))
  const [openRound, setOpenRound] = useState<number | null>(null)
  const roundsList = useRoundsList()

  useEffect(() => {
    if (r.done) return
    const id = window.setInterval(() => setR(remainingFrom(Date.now())), 1000)
    return () => window.clearInterval(id)
    // Re-arm only when we cross into the "done" state.
  }, [r.done])

  // The tournament is "started" either when the clock passes first tee, or the moment an
  // admin flips a round live (which can precede the booked tee time). Either flips the hero's
  // countdown over to the live board.
  const anyLive =
    roundsList?.some((r) => r.round.status !== 'upcoming') ?? false
  const showLive = r.done || anyLive

  return (
    <div>
      {/* Hero */}
      <header
        className="relative flex min-h-[clamp(420px,72vh,640px)] flex-col justify-between px-5 pb-10 pt-4"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, rgba(8,10,13,0.62) 0%, rgba(8,10,13,0.10) 20%, rgba(8,10,13,0.05) 42%, rgba(8,10,13,0.70) 74%, var(--ground) 100%), url(/assets/hero.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center 42%',
        }}
        role="img"
        aria-label="Streamsong Resort — the Black course windmill and sand bunkers"
      >
        <img
          src="/assets/streamsong-logo.svg"
          alt="Streamsong"
          className="h-8 w-auto"
        />
        <div className="max-w-[640px]">
          <span className="eyebrow block">{TRIP.name}</span>
          <h1 className="mt-3 font-display text-[clamp(2.6rem,13vw,4.8rem)] font-semibold leading-[0.94] tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.5)]">
            Streamsong
            <br />
            20<span className="text-gold-bright">2</span>7
          </h1>
          <p className="mt-4 font-display text-[clamp(1.05rem,4.6vw,1.4rem)] text-paper">
            {TRIP.dates}
          </p>
          <p className="mt-1 text-[0.8rem] uppercase tracking-[0.12em] text-paper-dim">
            {TRIP.venue} · {TRIP.venueCity}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[720px] px-5 pb-4">
        {/* Before first tee: countdown. Once underway: the live board. */}
        {showLive ? <LivePanel /> : <Countdown r={r} />}

        {/* The Field */}
        <section className="mt-8">
          <span className="eyebrow block">The Field</span>
          <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-3 min-[420px]:grid-cols-2">
            {PLAYERS.map((name, i) => (
              <div
                key={name}
                className="flex items-baseline gap-3 border-b border-hair pb-3"
              >
                <span className="tnum min-w-[1.1rem] font-display text-[0.8rem] text-gold">
                  {pad(i + 1)}
                </span>
                <span className="text-paper">{name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* The Card */}
        <section className="mt-10">
          <span className="eyebrow block">The Card — Four Rounds, Four Days</span>
          <div className="mt-4">
            {ROUNDS.map((round) => (
              <CardRound
                key={round.no}
                round={round}
                open={openRound === round.no}
                onToggle={() =>
                  setOpenRound((cur) => (cur === round.no ? null : round.no))
                }
              />
            ))}
          </div>
          <p className="mt-3 text-[0.72rem] text-paper-faint">
            Tap a round for its leaderboard.
          </p>
        </section>

        <footer className="mt-10 border-t border-hair pt-6 text-center text-[0.7rem] uppercase tracking-[0.14em] text-paper-faint">
          Net Stableford · 100% Allowance · See You in Florida
        </footer>
      </div>
    </div>
  )
}
