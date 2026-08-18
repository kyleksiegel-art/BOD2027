import { Outlet, ScrollRestoration } from 'react-router-dom'
import { TopBar } from './TopBar'
import { BottomTabBar } from './BottomTabBar'
import { HydrationGate } from './HydrationGate'
import { useSyncEngine } from '@/lib/sync/engine'

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

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopBar />
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
