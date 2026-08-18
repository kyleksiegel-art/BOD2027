import { useState, type FormEvent } from 'react'
import { unlock, UnlockError } from '@/lib/auth/session'

/**
 * The PIN unlock panel.
 *
 * Score entry is deliberately NOT behind this (docs/spec/decisions.md §"PIN removed from
 * score entry") — it guards `/admin`, where a wrong edit to a course card, the points
 * table or a handicap snapshot silently re-derives every leaderboard. Wired up in
 * Phase 5B along with the admin editors.
 *
 * A single numeric field rather than six boxes: `inputMode="numeric"` brings up the phone
 * keypad, one-handed, and there is nothing to tab between. The 16px font size is load
 * bearing — anything smaller and iOS zooms the page on focus.
 */
export function PinGate({ purpose }: { purpose: string }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pin.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      await unlock(pin)
      setPin('')
    } catch (err) {
      const message = err instanceof UnlockError ? err.message : 'Could not unlock.'
      const retry = err instanceof UnlockError ? err.retryAfter : undefined
      setError(retry ? `${message} (about ${retry}s)` : message)
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-hair bg-black/20 p-5">
      <span className="eyebrow block">Locked</span>
      <h2 className="mt-2 font-display text-2xl text-paper">Enter the PIN</h2>
      <p className="mt-2 text-[0.9rem] leading-relaxed text-paper-dim">{purpose}</p>

      <form onSubmit={submit} className="mt-4">
        <label htmlFor="pin" className="sr-only">
          Six-digit PIN
        </label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••"
          className="tap w-full rounded-md border border-hair-strong bg-ground px-4 py-3 text-center text-2xl tracking-[0.4em] text-paper tnum placeholder:text-paper-faint focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          disabled={pin.length !== 6 || busy}
          className="tap mt-3 w-full rounded-md bg-gold px-4 py-3 font-semibold text-ground disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-[0.9rem] text-gold-bright">
          {error}
        </p>
      ) : null}

      {/* iOS gives a home-screen PWA a storage context separate from Safari, so unlocking
          in Safari and then installing leaves you locked out with no signal. */}
      <p className="mt-4 border-t border-hair pt-3 text-[0.8rem] leading-relaxed text-paper-faint">
        On iPhone, add this to your home screen <em>first</em>, then unlock inside the
        installed app — on wifi, before you need it.
      </p>
    </section>
  )
}
