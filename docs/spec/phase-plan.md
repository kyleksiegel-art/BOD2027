# Phase plan

The nine phases are ordered as the brief lays them out. Two adjustments were proposed and accepted in Phase 0:

- **Phase 2 adds a tiny pgTAP smoke test** proving RLS actually denies anon writes and permits anon reads. ~30 minutes; prevents Phase 5 discovering policy bugs on top of a PIN flow.
- **Phase 6 is pre-committed to splitting if needed.** 6a = Dexie + outbox + comparator + tests. 6b = service worker, PWA install, offline PIN, diagnostics. Split noted in handoff if it happens.

Everything else — including "Phase 3 has zero UI" and "Phase 4 renders from seeded fake scores before any write path exists" — is unchanged.

## Phase 0 — Spec split, decisions, plan (no code)

**Deliverable:** `CLAUDE.md`, `docs/spec/brief.md`, `docs/spec/decisions.md`, `docs/spec/phase-plan.md`, `docs/spec/schema.md`, `docs/spec/acceptance-checklist.md`, `docs/spec/handoff.md`, first push to GitHub.

**Sign-off gate:** Kyle reviews all docs. No code until sign-off.

## Phase 1 — Scaffold + Netlify

**Deliverable:** Vite + React + TS + Tailwind project. React Router with the five tab routes (Standings, Rounds, Enter, Money, Info) plus `/`, `/admin`, and Info sub-routes as empty pages. Design tokens in CSS (colors, tabular numerals, hairline borders). Self-hosted Fraunces + Inter subsetted to Latin. Persistent top bar (trip wordmark, live connection badge stub) and bottom tab bar. `netlify.toml` (build command, publish dir, SPA redirect, Node pin, `no-cache` headers block). Deployed to a live URL. Deploy previews on branches.

**Verification:** Live Netlify URL loads on a phone. Tab bar navigates. Dark theme reads in direct sun. Lighthouse baseline captured (accessibility ≥ 90 target for later).

## Phase 2 — Supabase schema + RLS + seeds (no UI)

**Deliverable:** Migrations for every table in `docs/spec/schema.md`. RLS on with permissive `SELECT` policies for `anon` on public tables; `sessions` and `pin_attempts` locked. Realtime publication wrapped in `DO` blocks; `REPLICA IDENTITY FULL` on published tables. Idempotent seeds in migration files (stable UUIDs) for Red / Blue / Black scorecards (rating, slope, par, yardage per tee, stroke index). Bone Valley seeded with `data_is_placeholder = true` and null par/SI/rating/slope/yardage. pgTAP smoke test: anon can SELECT, anon cannot INSERT/UPDATE/DELETE. Course-data source citations in seed migration comments.

**Verification:** `supabase db reset` on a clean local instance produces every table, every seed row, all policies. `curl` with anon key reads courses; `curl` with anon key trying to insert into `scores` returns 401/403 (documented in README). pgTAP passes.

## Phase 3 — Scoring engine (pure TS, no UI, no network)

**Deliverable:** `src/lib/scoring/` — `rounding.ts` (half-away-from-zero), `handicap.ts` (course/playing handicap, cap, allocation), `round.ts` (per-hole net + points, DNP/shortened/abandoned), `championship.ts` (cumulative, position change, projections), `tiebreak.ts` (countback chain, round preference order, shortened fallback), `money.ts` (purse allocation, CTP weights, greedy settlement), `types.ts`. Full test suite covering every unit test listed in the brief, including the three hand-verified worked examples (one tee each of Red / Blue / Black).

**Verification:** `npm run test:scoring` passes with failures reported dot-only. Manual verification: each of the three worked-example tees produces the expected course handicap when compared to a hand calculation from the published rating and slope; the derivation is included as a comment above the test.

## Phase 4 — Read-only UI

**Deliverable:** Standings, Rounds list, Round detail (scorecard grid, leaderboard, handicap worksheet toggle), Players, Rules pages. Reading from seeded fake scores (added as a Phase 4 seed) via Dexie + `useLiveQuery` after TanStack Query hydrates. Design tokens fully applied. Tabular numerals visible. No write paths. PU legend renders. Excluded-holes strikethrough renders. Position change indicators render (against fake previous-round data).

**Verification:** Every fake score's derived points on the scorecard matches what the scoring engine returns for that (round, player, hole). Screenshots of Standings, Rounds/1, Rounds/1 with worksheet open, Rounds/1 scorecard.

## Phase 5 — Auth + score entry (online only)

**Deliverable:** PIN Edge Function with argon2id, per-IP throttling, short global backoff at high threshold, real client IP. `sessions` table populated with hashed tokens. `rpc_upsert_scores`, `rpc_upsert_ctp`, and the admin RPCs listed in `schema.md`, all `SECURITY DEFINER` with `SET search_path = ''`. Session token in Dexie, expiry Feb 8, 2027. Enter screen (hole-by-hole, all players on one screen, steppers, picked-up button, previous/next, hole picker, "thru X" footer, current standing). **Par default is display-only; no row written until an explicit tap.** Admin screens for players, courses (Bone Valley editor + validate-and-publish), rounds (tee assignment + finalize + abandon + re-snapshot), settings (points table, allowance, cap, purse). Online-only guards on admin screens with plain-language notice. All server-side validation from the brief enforced.

**Verification:** Anon `curl` write refused; PIN unlock via Edge Function succeeds; authenticated `curl` write accepted. Every validation rule tested by direct API call and rejection recorded. Score enters end-to-end from a phone. Manual: fat-fingered PIN attempts on one device don't lock out a device with a valid session.

## Phase 6 — Offline

**Deliverable:** Dexie schema mirroring server tables; outbox and dead-letter tables; `client_id` persisted; monotonic timestamps. Comparator in one file, applied in all four places (SQL guard, Realtime handler, hydration, pending-write shield). Whole-tuple replacement enforced. Realtime echo clears markers only when its timestamp is ≥ newest pending. `vite-plugin-pwa` with Workbox, `registerType: 'prompt'`; `maximumFileSizeToCacheInBytes` and `globPatterns` set explicitly. Reachability probe backing `navigator.onLine`. Offline PIN verification via stored bcrypt hash. `navigator.storage.persist()` called after unlock. Diagnostics screen (client_id, session expiry, last sync, outbox, dead-letter with Retry / Export-JSON, "copy state as JSON"). Admin "export all scores" as CSV/JSON.

**If splitting:** 6a = Dexie + outbox + comparator + tests. 6b = service worker, PWA install, offline PIN, diagnostics.

**Verification:** `npm run test:sync` passes. Manual: airplane-mode 18-hole entry across four players, force-quit, cold reopen offline (standings render), reconnect, syncs with no duplicates and no lost holes. Two devices editing the same hole offline converge to the same final state on both. iOS install-then-unlock order verified.

## Phase 7 — Money

**Deliverable:** Money page (per-round pot breakdown, running totals, buy-in reconciliation warning). CTP entry within Rounds detail (par-3 rows, distance in feet with decimal, no-winner + carry). Round-money snapshotting on `rpc_finalize_round`. Greedy settlement with integer-cent arithmetic. Remainder-cent rules encoded. Buy-in vs fixed toggle in admin.

**Verification:** Manual buy-in scenario reconciles to the cent. Test: abandoned round redistributes across remaining counting rounds. Test: carried pot returns to contributors at last par 3 with no winner. Test: `rpc_finalize_round` writes `round_money` with values matching the compute-time derivation from settings + par-3 count.

## Phase 8 — Info + admin editors

**Deliverable:** Info sub-pages (Itinerary timeline with current-day highlight, Courses index + per-course pages, Players with photos and course-handicap-per-course, Rules). Admin editors for itinerary, lodging (with `lodging_assignments`), tee times per round. All timestamps rendered in `America/New_York`.

**Verification:** Every field on every Info page is either set from a seed or clearly rendered "empty" without a placeholder. Admin edits to any field appear on the public page within one Realtime tick.

## Phase 9 — Polish

**Deliverable:** Lighthouse mobile performance and accessibility both above 90. Responsive hero images (AVIF/WebP). Photos uploaded via Edge Function. Live countdown on Home. Full acceptance pass against `docs/spec/acceptance-checklist.md`. README complete (local setup, env vars, threat model, iOS install order, `curl` commands, PIN recovery, custom domain notes).

**Verification:** Lighthouse report attached. Every acceptance-checklist line has verification evidence. Deployed to production Netlify.
