import { useRegisterSW } from 'virtual:pwa-register/react'
import { useSyncSnapshot } from '@/lib/sync/engine'

/**
 * The new-version prompt (docs/spec/decisions.md §"Service worker").
 *
 * The service worker is registered with `registerType: 'prompt'` and NEVER skipWaiting: a
 * waiting worker sits idle until the user taps Update, which calls `updateServiceWorker(true)`
 * and reloads. That reload is the reason for the one rule that matters here:
 *
 *   the prompt is SUPPRESSED while the outbox is non-empty.
 *
 * A reload mid-flush could interrupt a batch and, worse, tear down the page while a score
 * is still only in the queue. So we hold the offer — `needRefresh` stays true, the waiting
 * worker stays waiting — and show it the moment the queue drains. Nothing is lost; the
 * update just waits its turn behind the golf.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const { pending } = useSyncSnapshot()

  // Held, not dismissed: when pending > 0 we render nothing, but needRefresh stays true and
  // the banner reappears once the last queued score syncs.
  if (!needRefresh || pending > 0) return null

  return (
    <div
      role="status"
      className="border-b border-gold/40 bg-gold/10 px-4 py-2 text-[0.82rem] text-paper"
    >
      <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3">
        <span>A new version is ready.</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="tap rounded-md bg-gold-fill px-3 py-1.5 font-semibold text-paper"
          >
            Update
          </button>
          <button
            type="button"
            onClick={() => setNeedRefresh(false)}
            className="tap text-paper-faint underline underline-offset-2"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}
