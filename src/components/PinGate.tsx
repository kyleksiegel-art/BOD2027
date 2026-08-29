import { useEffect, useState, type FormEvent } from 'react'
import { unlock, unlockOffline, hasOfflineHash, UnlockError } from '@/lib/auth/session'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

/**
 * The PIN unlock panel.
 *
 * Score entry is deliberately NOT behind this (docs/spec/decisions.md §"PIN removed from
 * score entry") — it guards `/admin`, where a wrong edit to a course card, the points
 * table or a handicap snapshot silently re-derives every leaderboard. Wired up in
 * Phase 5B along with the admin editors.
 *
 * A single numeric field rather than one box per digit: `inputMode="numeric"` brings up the
 * phone keypad, one-handed, and there is nothing to tab between. The 16px font size is load
 * bearing — anything smaller and iOS zooms the page on focus.
 */

/**
 * PIN length. Changing this is the only client-side edit a new PIN length needs — the
 * label, the placeholder, the input cap and the submit rule all read it. The server checks
 * well-formedness over a range and lets argon2 be the real gate, so it needs no change.
 *
 * Kyle chose 4 (2026-08-18), overriding the brief's "use 6, not 4". See
 * docs/spec/decisions.md §"PIN length is 4, not 6".
 */
export const PIN_LENGTH = 4
export function PinGate({ purpose }: { purpose: string }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offlineAvailable, setOfflineAvailable] = useState(false)
  const online = useOnlineStatus()

  // Whether this device has ever unlocked online (so an offline unlock is possible at all).
  useEffect(() => {
    void hasOfflineHash().then(setOfflineAvailable)
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pin.length !== PIN_LENGTH || busy) return
    setBusy(true)
    setError(null)
    try {
      // With a link, try the server (mints a real token). With no link, verify locally
      // against the cached hash. If the server attempt fails on the network specifically,
      // fall back to the local check so a captive-portal false-positive still lets you in.
      if (online) {
        try {
          await unlock(pin)
        } catch (err) {
          // Only a genuine connection failure falls back to the local check — a server
          // "Incorrect PIN" or a throttle is a real answer and must stand.
          if (err instanceof UnlockError && err.networkFailed && offlineAvailable) {
            await unlockOffline(pin)
          } else {
            throw err
          }
        }
      } else {
        await unlockOffline(pin)
      }
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
    <section className="rounded-lg border border-hair bg-ground-2 p-5">
      <span className="eyebrow block">Locked</span>
      <h2 className="mt-2 font-display text-2xl text-paper">Enter the PIN</h2>
      <p className="mt-2 text-[0.9rem] leading-relaxed text-paper-dim">{purpose}</p>

      <form onSubmit={submit} className="mt-4">
        <label htmlFor="pin" className="sr-only">
          {PIN_LENGTH}-digit PIN
        </label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={PIN_LENGTH}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
          placeholder={'•'.repeat(PIN_LENGTH)}
          className="tap w-full rounded-md border border-hair-strong bg-ground px-4 py-3 text-center text-2xl tracking-[0.4em] text-paper tnum placeholder:text-paper-faint focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          disabled={pin.length !== PIN_LENGTH || busy}
          className="tap mt-3 w-full rounded-md bg-gold-fill px-4 py-3 font-semibold text-paper disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-[0.9rem] text-gold-bright">
          {error}
        </p>
      ) : null}

      {!online && offlineAvailable ? (
        <p className="mt-3 text-[0.82rem] leading-relaxed text-paper-dim">
          No signal — this device will unlock from the PIN it saved the last time it was
          online. Changes that need the server still wait for a connection.
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
