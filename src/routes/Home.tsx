import { useEffect, useState } from 'react'
import { FIRST_TEE_ISO, TRIP, PLAYERS, ROUNDS } from '@/config/trip'

const TARGET = new Date(FIRST_TEE_ISO).getTime()

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

export default function Home() {
  const [r, setR] = useState<Remaining>(() => remainingFrom(Date.now()))

  useEffect(() => {
    if (r.done) return
    const id = window.setInterval(() => setR(remainingFrom(Date.now())), 1000)
    return () => window.clearInterval(id)
    // Re-arm only when we cross into the "done" state.
  }, [r.done])

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
        {/* Countdown */}
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
            {r.done ? (
              <span className="font-semibold text-gold-bright">
                Tee it up — see you in Florida
              </span>
            ) : (
              <>
                First tee — <strong className="font-semibold text-gold-bright">Thu, Feb 4</strong>{' '}
                · <strong className="font-semibold text-gold-bright">1:10 PM ET</strong> ·
                Streamsong Red
              </>
            )}
          </p>
        </div>

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
              <div
                key={round.no}
                className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-4 border-b border-hair py-3.5 first:border-t first:border-t-hair-strong"
              >
                <span className="font-display text-[0.75rem] uppercase tracking-[0.15em] text-paper-faint">
                  R{round.no}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-display text-[1.14rem] font-semibold text-paper">
                    {round.course}
                  </span>
                  <span className="text-[0.76rem] text-paper-faint">
                    {round.architect}
                  </span>
                </span>
                <span className="tnum whitespace-nowrap text-right text-[0.8rem] text-paper-dim">
                  {round.day}
                  <span className="mt-0.5 block text-[0.72rem] tracking-[0.04em] text-gold">
                    {round.tee}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-10 border-t border-hair pt-6 text-center text-[0.7rem] uppercase tracking-[0.14em] text-paper-faint">
          Net Stableford · 100% Allowance · See You in Florida
        </footer>
      </div>
    </div>
  )
}
