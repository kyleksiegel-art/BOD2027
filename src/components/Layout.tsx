import { useEffect } from 'react'
import { Outlet, ScrollRestoration } from 'react-router-dom'
import { TopBar } from './TopBar'
import { BottomTabBar } from './BottomTabBar'
import { HydrationGate } from './HydrationGate'
import { PwaUpdatePrompt } from './PwaUpdatePrompt'
import { useSyncEngine } from '@/lib/sync/engine'
import { ensurePersistedIfUnlocked } from '@/lib/auth/session'

/**
 * App shell: persistent top bar + bottom tab bar with the routed page between.
 * The shell is fixed height; only the middle scrolls, so the tab bar never
 * drifts off-screen during one-handed use.
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
      <PwaUpdatePrompt />
      <main className="flex-1 overflow-x-hidden">
        <HydrationGate>
          <Outlet />
        </HydrationGate>
      </main>
      <BottomTabBar />
      <ScrollRestoration />
    </div>
  )
}
