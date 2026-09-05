# Handoff — 2026-09-05 (branch `recap-share-image`)

Recap "Share ↗" now shares a PNG of the recap card instead of a text summary (Kyle: "just the
image"). `src/lib/share/recapImage.ts` (modern-screenshot, 2×, footer excluded via
`data-share-exclude`); `ShareButton` in `RoundRecap.tsx` pre-renders after fonts settle so the
tap → share sheet stays inside the iOS user gesture. Text is only the fallback where the share
sheet can't take files.

Verified in the desktop preview at 375px: 670×1549 PNG, ~219 KB, ~170 ms, fonts and course
accent intact, footer gone. `navigator.share` is undefined in the preview, so the sheet itself
is untested — **check on an iPhone: /rounds/1 → Share → Messages.**

Tests 162, `npm run build` clean. Earlier today (merged, PR #11): Enter drafts persist in Dexie,
Enter opens on the current hole, Save advances.

Still open from the 2026-09-05 ranking: error boundary, score history, Realtime channel-status
handling, wake lock, DB backup, the four-phone dry run and pre-trip chores.
