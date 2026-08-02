import { Outlet, ScrollRestoration } from 'react-router-dom'
import { TopBar } from './TopBar'
import { BottomTabBar } from './BottomTabBar'

/**
 * App shell: persistent top bar + bottom tab bar with the routed page between.
 * The shell is fixed height; only the middle scrolls, so the tab bar never
 * drifts off-screen during one-handed use.
 */
export function Layout() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopBar />
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
      <BottomTabBar />
      <ScrollRestoration />
    </div>
  )
}
