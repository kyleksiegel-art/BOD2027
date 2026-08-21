# Handoff

**Phase just finished:** 6a — the offline write queue and the comparator. Branch
`phase-6-offline` (Phases 4–6a all still uncommitted to `main`). Nothing is stubbed; 6b is
untouched.

**Built:** `src/lib/sync/` — `comparator.ts` (the one tuple ordering; microsecond-precision
timestamps, lowercased uuid tie-break), `clock.ts` (monotonic, Dexie-persisted stamps),
`outbox.ts` (enqueue in one transaction, coalesce latest-per-key, batch 36 × 4, settle,
atomic dead-letter, `clearEchoed`), `merge.ts` (site 3), `realtime.ts` (site 2),
`reachability.ts` (HEAD probe), `engine.ts` (flush triggers + `useSyncSnapshot`). Dexie v5
adds `ctp_results`, `outbox`, `dead_letter`, `sync_meta`. `saveCells` now queues rather than
posts; the badge shows the pending count.

**Verified:** `npm run test:sync` → **39 pass**; full `vitest run` → **106**; `supabase test
db` → **232**, unchanged. Browser at 375 px against local Supabase: online save landed in
Postgres; with the API failing, holes 15–17 × 3 players read "9 TO SYNC" and the footer
advanced to thru 17 with **no** server rows; on reconnect all 9 landed carrying their
original offline timestamps, no duplicates; with `supabase_kong` **stopped**, hole 18 was
entered, the page cold-reloaded, standings rendered from Dexie, `attempts: 0`, and the queue
drained when the container came back; a foreign Realtime write with a newer stamp landed
live and the same row rewritten with a 2020 stamp was refused. DB reset afterwards.

**Four deviations, all in `decisions.md` + the checklist:** offline costs **no** retry
attempts (only an answer from the server does, or a dead zone dead-letters a whole round);
our own acknowledged row overwrites the optimistic one unconditionally, which is how the
server's 5-minute clamp gets adopted; `ctp_results` is mirrored and queueable before its
Phase 7 UI; and `saveCells` now resolves on *queued*, not on *server has it*.

**Note on the harness:** click injection timed out all session (`visibilityState: 'hidden'`),
so browser taps were dispatched as DOM events to the same React handlers. Everything else in
those tests was real. If a future session sees the same, don't chase it in the app.

**Kyle still owes (carried, unchanged):** real player indexes + who's assigned + each
player's tee; the real 4-digit PIN as a Supabase secret; a hosted Supabase project +
`supabase db push`; Netlify env vars; confirm the deploy preview + Lighthouse baseline.
**`origin/main` is still only the countdown page — no phase work has ever merged**, and
there is still no hosted Supabase. 6b's PWA/install verification needs a real HTTPS URL.

**Local dev PIN is `2718`.** Run `supabase functions serve --env-file
supabase/functions/.env --no-verify-jwt` alongside `supabase start`.

**Next phase:** 6b — `vite-plugin-pwa` (`registerType: 'prompt'`, explicit `globPatterns`
and `maximumFileSizeToCacheInBytes`, update toast suppressed while the outbox is non-empty),
`navigator.storage.persist()` after unlock, offline PIN via bcrypt cost 10, the Diagnostics
screen (`retryDeadLetter` / `lastSyncAt` / `useSyncSnapshot` already exist and are tested),
admin CSV export, and `round_player` as the third outbox kind once the offline PIN exists.
Read `CLAUDE.md` §"Offline path (Phase 6a)", `acceptance-checklist.md` §Phase 6a, this file,
and Phase 6 in `phase-plan.md`.
