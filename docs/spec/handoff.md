# Handoff — 2026-09-05 (branch `enter-drafts-persist`, uncommitted)

Two cart-reliability fixes on the Enter screen, no phase work.

1. Enter drafts persist in Dexie (v7 `enter_drafts`) so an iOS eviction mid-hole loses nothing.
   Helper: `src/lib/data/drafts.ts`. Write-through on every tap; row deleted on Save.
2. Enter opens on the group's current hole (`EnterVM.firstOpenHole`), per round, from stored
   cells only. Round picker resets the hole and reloads that round's drafts.

Verified in the browser against local Supabase (R3 in progress, 3 playing): opened on 13,
drafts on 13+14 survived a reload, Save cleared 13 and left 14. Test writes reverted in the DB.
Tests 161 (was 148 + 13 new), `npm run build` clean. CLAUDE.md §Phase 5A updated.

3. A successful Save advances to the next hole (18 stays put); "Saved" remains on the hole left.

Not done: error boundary, score history,
Realtime channel-status handling, wake lock, DB backup — see the 2026-09-05 chat ranking.
Next: review + PR to `main`; then the four-phone dry run and the pre-trip chores.
