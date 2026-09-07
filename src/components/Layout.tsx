import { useEffect } from 'react'
import { Outlet, ScrollRestoration } from 'react-router-dom'
import { TopBar } from './TopBar'
import { BottomTabBar } from './BottomTabBar'
import { HydrationGate } from './HydrationGate'
import { PwaUpdatePrompt } from './PwaUpdatePrompt'
import { DevCrash } from './ErrorBoundary'
import { useSyncEngine } from '@/lib/sync/engine'
import { ensurePersistedIfUnlocked } from '@/lib/auth/session'

/**
 * App shell: persistent top bar + bottom tab bar with the routed page between. The bars are
 * sticky and the DOCUMENT is the only scroller — `<main>` must never become one.
 *
 * `overflow-x: clip`, NOT `hidden` (Kyle 2026-09-07, "the field report scroll isn't working on
 * my phone"): per CSS Overflow 3, `visible` on one axis computes to `auto` when the other axis
 * is neither `visible` nor `clip`. So `overflow-x: hidden` silently made `overflow-y: auto`,
 * turning `<main>` into a nested scroll container with no definite height (it is `flex-1` under
 * `min-h-[100dvh]`) — the shape iOS Safari swallows touch scrolling on. It went unnoticed while
 * every page fit in one or two flicks; the Field Report is 4.3 screens tall and needs sustained
 * momentum, so it surfaced there first. `clip` keeps the horizontal clipping and leaves
 * `overflow-y: visible`, so no scroll container is created. Don't "tidy" it back to `hidden`.
 *
 * The sync engine starts here — one place, above every route, so a queued score keeps
 * trying whichever screen the phone is left on.
 */
export function Layout() {
  useSyncEngine()

  // If this device already holds a session, ask for durable storage on boot — the outbox is
  // the only copy of a dead-zone round and must not be evicted under pressure.
  useEffect(() => {
    void ensurePersistedIfUnlocked()
  }, [])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopBar />
      <DevCrash where="shell" />
      <PwaUpdatePrompt />
      <main className="flex-1 overflow-x-clip">
        <HydrationGate>
          <Outlet />
        </HydrationGate>
      </main>
      <BottomTabBar />
      <ScrollRestoration />
    </div>
  )
}
