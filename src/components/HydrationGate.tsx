import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useHydrate } from '@/lib/data/hydrate'
import { db } from '@/lib/db'
import { Page } from './Page'

/**
 * Runs the one-time hydrate and gates the first paint. Once Dexie holds anything it
 * renders children and lets a background refetch update in place (stale-while-revalidate),
 * so a reconnect never blanks the screen. Only a cold start with an empty cache blocks.
 */
export function HydrationGate({ children }: { children: ReactNode }) {
  const hydrate = useHydrate()
  const hasData = useLiveQuery(async () => (await db.rounds.count()) > 0, [], undefined)

  if (hasData) return <>{children}</>

  // Cold cache: wait on the first fetch.
  if (hydrate.isError) {
    return (
      <Page>
        <span className="eyebrow block text-gold">Couldn’t load the trip</span>
        <p className="mt-4 text-paper-dim">
          The scoreboard data couldn’t be reached. Check your connection — it will retry on its own.
        </p>
        <p className="mt-3 break-words text-[0.8rem] text-paper-faint">{String(hydrate.error)}</p>
      </Page>
    )
  }

  return (
    <Page>
      <div className="flex min-h-[40vh] items-center justify-center">
        <span className="eyebrow animate-pulse text-paper-faint">Loading the board…</span>
      </div>
    </Page>
  )
}
