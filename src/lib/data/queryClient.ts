// The app's one QueryClient, in its own module so the non-React write path can reach it.
//
// Admin writes (src/lib/data/admin.ts) touch tables the write path does not mirror back
// row-by-row — publishing a course, finalizing a round, re-snapshotting handicaps all
// change several tables at once. Rather than hand-patch Dexie for each, an admin write
// invalidates the hydrate query and lets the ONE existing network→Dexie path refill it.
// That keeps the data-layering rule intact: TanStack fetches, Dexie stores, components
// read Dexie.
import { QueryClient } from '@tanstack/react-query'

// Read-only defaults inherited from Phase 4: no refetch storms, one retry. The
// offline-aware refetch/flush ordering is a Phase 6 concern.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
})
