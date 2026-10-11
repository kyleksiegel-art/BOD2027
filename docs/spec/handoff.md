# Handoff — 2026-10-10 (pinned bug fixes)
- Branch `pinned-bug-fixes`: fixes #1, #2, #3 and #5 from the 2026-09-28 pinned review (see CLAUDE.md
  §"Pinned bug fixes"). `vitest run` → 236, `npm run build` clean. Not browser-tested end to end for
  Save (dev server may point at the hosted DB); Home + Enter render clean at 375px.
- #4 (Clear scores resurrected by a dead-zone phone) fixed on `clear-scores-epoch`: `rounds.scores_epoch`.
  **Push `20261010120000_round_scores_epoch.sql` to the hosted DB** (`supabase db push`). vitest 237, pgTAP 251.
- `minor-fixes`: AVIF-only precache (5.1 → 1.8 MB), revoke TRUNCATE from anon (**push the migration**),
  44px tap targets. Still pinned: PIN throttle XFF, Annual Report lower-tie T / abandoned CTPs, etc.
- Pre-trip checklist (late January, on the real phones) unchanged from the 2026-09-14 handoff:
  1. Supabase awake on a non-pausing tier; hydrate returns rows; `pin-verify` unlocks.
  2. Reset every round to upcoming; real indexes, tees, tee times, money amounts.
  3. Install the PWA on all four phones; accept one SW update; storage persists.
  4. Share recap card, round report, strokes card once on-device.
  5. One hole in airplane mode → flush, other phone's Realtime update, empty outbox in Diagnostics.
  6. Never edit a handicap index after Thursday's tee.
