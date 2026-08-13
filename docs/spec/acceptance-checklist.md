# Acceptance checklist

Updated at the end of every phase with:

- Requirements implemented
- Automated tests covering them
- Manual tests performed
- **How each was verified** — concrete evidence, not an assertion
- Requirements deferred, and to which phase
- Any deviation from the brief, with the reason

A requirement is not complete merely because the UI exists.

---

## Phase 0 — Spec, decisions, plan

### Implemented

| Requirement | Verification |
|---|---|
| Phase plan proposed with two accepted adjustments (pgTAP smoke in Phase 2; pre-committed Phase 6 split) | `docs/spec/phase-plan.md` |
| File/route structure proposed | Presented in chat, captured in `phase-plan.md` per-phase deliverables |
| Supabase schema, RLS policies, RPC signatures written out | `docs/spec/schema.md` |
| `docs/spec/decisions.md` written listing every decision made outside the brief, every ambiguity resolved, and every place two requirements appeared to conflict | `docs/spec/decisions.md` |
| Answer to the open offline question: (a) — day-of tee changes carved into the outbox | `docs/spec/decisions.md` §"Answer to the open question" |
| Photo upload path chosen: Edge Function | `docs/spec/decisions.md` §"Photo upload path" |
| `CLAUDE.md` in place with architecture summary, data-layering rule, schema shape, conventions | `CLAUDE.md` |
| `docs/spec/brief.md` — verbatim copy of the brief | `docs/spec/brief.md` |
| `docs/spec/handoff.md` — 15-line session-end note | `docs/spec/handoff.md` |
| First push to GitHub | Manual push command handed to Kyle; verified once he confirms the push landed |

### Automated tests

None. Phase 0 is spec-only.

### Manual tests

None. Phase 0 is spec-only.

### Deferred requirements

Everything in the brief is deferred to a later phase per the phase plan. The brief's `CONFIG — FILL THIS IN` block (player indexes, tees, tee times, lodging, dining, travel, purse mode + amounts) is deferred to seeds and admin editors in later phases; working values acceptable until 2027-02-01, final index snapshot on that date.

### Deviations

1. **Phase 0 pushed directly to `main`**, not a `phase-0-spec` branch. Reason: repo was empty, Netlify blocked on empty repo. Phase 0 is docs only. From Phase 1 forward, one branch per phase.
2. **Phase 0 committed before verbal sign-off.** Reason: implicit go-signal from Kyle's Netlify screenshot. Any correction is a follow-up commit; no code built on top yet.

---

## Phase 1 — Scaffold

Built on branch `phase-1-scaffold`. `main` (the live static countdown) untouched.

### Implemented

| Requirement | Verification |
|---|---|
| Vite + React + TS + Tailwind project | `npm run build` succeeds: `tsc -b` clean + Vite build (56 modules, 969ms). `package.json`, `vite.config.ts`, `tailwind.config.ts`, `tsconfig*.json` |
| React Router with five tab routes + `/`, `/admin`, Info sub-routes as empty pages | `src/router.tsx`. Verified live in preview: `/` (Home), `/standings`, `/info` (→ `/info/itinerary`), `/nope` (404) all render; bottom-tab active state toggles gold |
| Design tokens in CSS (colors, tabular numerals, hairline borders) | `src/index.css` `:root` — Streamsong palette, `.tnum`/`th`/`td` tabular-nums, `--hair`/`--hair-strong`. Mapped into Tailwind in `tailwind.config.ts` |
| Self-hosted Fraunces + Inter, subsetted to Latin | `src/fonts.css` + `src/assets/fonts/*.woff2` (Latin `wght`-axis subsets from Fontsource 5.3.0, provenance in comment). No CDN. **Measured payload 84.9 KB** (Fraunces 36.6 + Inter 48.3) — marginally over the ≤80 KB target; trim/confirm in Phase 9 |
| Persistent top bar (wordmark + connection badge stub) | `src/components/TopBar.tsx` + `ConnectionBadge.tsx`. Badge reflects `navigator.onLine` only — labeled a STUB; real reachability probe is Phase 6 |
| Persistent bottom tab bar | `src/components/BottomTabBar.tsx`. 44px targets (`.tap`), no hover dependence, safe-area insets. Verified across routes |
| `netlify.toml` (build cmd, publish dir, SPA redirect, Node pin, no-cache headers) | `netlify.toml`: `npm run build` → `dist`, `NODE_VERSION=22`, `/*`→`/index.html` 200, `index.html`/`sw.js` no-cache, `/_assets/*` immutable, `/assets/*` 1-day |
| Deployed to a live URL + branch deploy previews | **Pending** — Kyle to confirm the branch deploy-preview URL loads after push (Netlify auto-builds PRs/branches once this branch is pushed) |

### Automated tests

None yet. No unit-testable logic in the scaffold; the scoring test suite is Phase 3. `npm test` passes with `--passWithNoTests`.

### Manual tests

- Home `/`: hero, wordmark, **live countdown ticking** (186d / seconds decrementing between screenshots), field roster, four-round card — all render on a 375-px mobile viewport. No console errors.
- Navigation: `/standings`, `/info` (redirects to Itinerary), `/nope` (404 "Off the fairway") verified. Active-tab highlight works.
- Countdown target carried over from the interim page: 1:10 PM ET Feb 4 2027 (`FIRST_TEE_ISO` in `src/config/trip.ts`).

### Deferred requirements

- **Live Netlify URL / Lighthouse baseline** — deferred to Kyle's post-push confirmation and Phase 9's full Lighthouse pass. Netlify wiring is a dashboard action, not a code change.
- **Font payload ≤80 KB** — measured at 84.9 KB; revisit in Phase 9 (drop an axis or ship static weights if it must come under).
- No favicon yet (Phase 9 polish).

### Deviations

1. **Palette** — Phase 1 uses the Streamsong-branded palette from the interim page, not the earlier draft tokens in `decisions.md`. That section has been updated to match; see it for the retired values and rationale.
2. **Hashed build output moved to `/_assets/`** (via `build.assetsDir`) so stable public images at `/assets/` (hero, logo — the OG image URL) can keep a separate, non-immutable caching policy. Not a spec change; enables the netlify.toml caching split.
3. **Fonts self-hosted by copying Fontsource's Latin woff2 into the repo** rather than importing the npm package at runtime — truly offline, stable cache URLs, and full control of which faces ship. Only roman (no italic) is shipped to stay near the payload budget.

---

## Phase 2 — Supabase schema + RLS + seeds

Built on branch `phase-3-scoring` (Phase 2 was owed; the scoring engine had been built
first because it has no DB dependency — see the Phase 3 deviation). Supabase project
scaffolded with `supabase init`. Six migrations in `supabase/migrations/` (enums,
tables, RLS, realtime, core seed, tees seed); pgTAP tests in `supabase/tests/`.

### Implemented

| Requirement | Verification |
|---|---|
| Migrations for every table in `schema.md` | `20260812100100_tables.sql` — all 16 tables. `supabase db reset` applies all six migrations clean; `select count(*) from information_schema.tables where table_schema='public'` = 16 |
| Enums | `20260812100000_enums.sql` — `round_status`, `rp_status`, `itin_category`, guarded idempotent |
| RLS on; permissive anon `SELECT` on public tables; `sessions`/`pin_attempts` locked | `20260812100200_rls.sql`. pgTAP `rls_smoke.sql`: anon SELECT succeeds on all 14 public tables, is denied (42501) on `sessions`/`pin_attempts`. **Correction:** anon needs an explicit `grant select` — Supabase local does not auto-grant it, so RLS policies alone left anon with "permission denied." Grant added; `schema.md` updated (it had omitted this) |
| No anon INSERT/UPDATE/DELETE anywhere | Blanket `revoke insert,update,delete ... from anon`. pgTAP: INSERT denied on all 14 writable tables, UPDATE+DELETE denied on `scores` (all 42501) |
| Realtime publication wrapped in `DO` blocks; `REPLICA IDENTITY FULL` on published tables | `20260812100300_realtime.sql`. pgTAP `seed_integrity.sql`: all six intended tables (`scores`, `ctp_results`, `rounds`, `settings`, `players`, `round_players`) are in `supabase_realtime` and have `relreplident='f'` |
| Idempotent seeds in migration files, stable UUIDs | `on conflict do nothing` + hard-coded UUID scheme (courses `c…00C`, players `d…00P`, rounds `e…00R`, holes `aaaa000C…HH`, tees `bbbb000C…T`). Re-running `db reset` is deterministic |
| Red/Blue/Black scorecards: rating, slope, par, yardage per tee, stroke index | `20260812100400_seed_core.sql` (holes: par + SI) + `20260812100500_seed_tees.sql` (4 base tees/course: Green/Black/Silver/Gold with rating/slope/total + per-hole yardage). 13 tees, 72 holes, 234 hole_yardages (216 non-null) |
| **Course data researched + cited from a named source** (brief §Phase 2) | Transcribed from the resort's **official 2021 printed scorecards** (Red/Blue/Black-2021-Scorecard.pdf), hand-verified page-by-page against the saved PDFs. Cited in both seed migration headers |
| Bone Valley seeded placeholder: `data_is_placeholder=true`, null par/SI/rating/slope/yardage | `seed_core.sql` course row + 18 null-par/SI holes; `seed_tees.sql` one placeholder tee (rating/slope/total null) + 18 null-yardage rows. pgTAP asserts all 18 pars/SIs null and the flag true |
| Course-per-round order + tee times = actual booked tee sheet | `rounds` seed: R1 Red, R2 Black, R3 Blue, R4 Bone Valley; tee times at -05 (EST). Rendered in `America/New_York`: Thu 01:10 PM, Fri 10:33 AM, Sat 10:35 AM, Sun 08:28 AM. pgTAP asserts the round→course mapping |
| pgTAP smoke test: anon SELECT ok, anon write denied | `supabase test db` → **55/55 pass** (`rls_smoke.sql` 32, `seed_integrity.sql` 23) |
| Course-data source citations in seed comments | Headers of both seed migrations |

### Automated tests

`supabase test db` → **PASS, 55 tests** (0 failures). `rls_smoke.sql` (32): anon read
allowed on the 14 public tables, write denied everywhere, locked-table reads denied.
`seed_integrity.sql` (23): par totals 72/72/73; each course's stroke index a complete
1–18 permutation; Black 17/18 SI = 13/5 (printed card); Bone Valley all-null +
placeholder flag; row counts; round→course mapping; every base tee's hole-yardage sum
equals its printed total; realtime publication + replica identity.

### Manual tests

- `supabase db reset` on a clean instance: all six migrations apply, no errors; produces 16 tables + all seed rows.
- `curl` with the anon key: reads `courses` → HTTP 200 with 4 rows (Bone Valley `data_is_placeholder=true`, others false); reads `scores` → 200 `[]`; **POST `scores` → HTTP 401, `42501` "permission denied for table scores"**; reads `sessions` → 401, 42501. (Commands recorded in the README.)
- Scorecard spot-check via `psql`: Black hole 17 (par 3, SI 13, 205 yd) and hole 18 (par 5, SI 5, 586 yd) match the printed card.

### Deferred requirements / open items

- **RPCs are not implemented** (all the `rpc_*` in `schema.md`). Correct per the phase plan — RPCs are Phase 5 (auth + write path). Phase 2 is schema + RLS + realtime + seeds + pgTAP only.
- **Player handicap indexes are WORKING PLACEHOLDERS** (9.2 / 12.4 / 14.0 / 16.8, all `index_is_assigned=false`). The brief lists all four indexes (and each player's tee) as TODO; working values are acceptable until 2027-02-01, when finals are entered and the four rounds re-snapshotted. **Kyle to supply real indexes + who plays an assigned index + each player's tee.**
- **`round_players` and `scores` are not seeded.** `round_players` creation is the Phase 5 "Set tees and confirm handicaps" admin action; fake scores are a Phase 4 seed.
- **Combo tees not seeded** (Green/Black, Black/Silver, Silver/Gold): the card gives their rating/slope/total but no per-hole yardages, so they'd be incomplete. Admin can add them if the group plays a combo set.
- **Bone Valley `year_opened` (2025) and its placeholder tee `par` (72)** are working values — the schema forces non-null on both. Overwritten when the real card is entered and published (Phase 5). Rating/slope/total/yardages/hole-par/SI are all correctly null.
- Realtime *event delivery* over a socket (definition-of-done) is demonstrable once a write path exists (Phase 5/6); Phase 2 verifies the publication + replica identity are configured.

### Deviations / findings

1. **All three courses' par/stroke-index hand-verified against the official 2021 PDFs.** Black holes 17/18 SI = 13/5 in the seed, matching both the printed card and the Phase 3 fixtures (`src/lib/scoring/__fixtures__/streamsong.ts`). Red and Blue also verified correct. (A mid-session claim that the fixtures had 17/18 swapped was a misread on my part — the fixtures were always correct; no fixtures change is needed, and the DB and the scoring engine agree.)
2. **`schema.md` was stale** on RLS: it created SELECT policies for anon but never granted anon the underlying SELECT privilege, which Supabase local does not auto-grant. Corrected in the migration and in `schema.md`.

---

## Phase 3 — Scoring engine

Built on branch `phase-3-scoring` (off `phase-1-scaffold`, since Phase 2 is not yet built — the scoring engine is pure TS with no DB dependency). Pure `src/lib/scoring/`, no React/network imports.

### Implemented

| Requirement | Verification |
|---|---|
| `rounding.ts` — half-away-from-zero | `roundHalfAwayFromZero`; `rounding.test.ts` asserts `.5`/`−.5` symmetry and non-half cases |
| `handicap.ts` — course/playing handicap, cap, allocation | `computeHandicap`, `allocateStrokes`, `resolveStrokesReceived`; `handicap.test.ts` (21 tests) |
| **3 hand-verified worked examples (Red/Blue/Black)** | `handicap.test.ts`: Red/Green 74.1/137 idx 8.0→12; Blue/Green 74.0/134 idx 12.4→17; Black/Green 74.7/135 **par 73** idx 12.4→17. Manual arithmetic in comments above each. Black reproduces the brief's own worksheet (14.82 + 1.7 = 16.52). Real rating/slope/par/SI transcribed in `__fixtures__/streamsong.ts` from the resort's official 2021 scorecard PDFs (cited) |
| Allowance 100% and 95%, rounding once after allowance | `handicap.test.ts` §allowance |
| The 18 cap: 19/24/40→18 `capApplied=true`; exactly 18→`false`; plus handicap unaffected | `handicap.test.ts` §cap |
| Cap ordering: 24 @ 95% → 23 → 18 (never 24→18→17) | `handicap.test.ts` "applies the cap AFTER the allowance and rounding" |
| Stroke allocation for PH 0, 5, 18, 22, 38, −2 (wrap + plus) | `handicap.test.ts` §allocateStrokes |
| Strokes-received hole list matches the printed scorecard SI | `handicap.test.ts` "matches the printed Black scorecard stroke index"; fixtures assert SI is a complete 1–18 permutation on all three cards |
| `round.ts` — per-hole net + points, DNP/shortened | `computeHoleResult`, `computePlayerRound`, `commonCompletedHoleCount`, `stablefordPoints`; `round.test.ts` (12) |
| Every points-table row + both clamps; par-5-in-2; ace on par 3 w/ stroke | `round.test.ts` §stablefordPoints / §computeHoleResult |
| Picked-up = 0 pts, counts as played; unentered = null, doesn't count; plus-handicap net = gross+1 | `round.test.ts` §computeHoleResult |
| Shortened cutoff excludes DNP players | `round.test.ts` §commonCompletedHoleCount |
| `championship.ts` — cumulative, position change, projection | `totalPoints`, `computeStandings`, `standingsThroughRound`, `computeProjection`; `championship.test.ts` (7) |
| Cumulative with mix of final/shortened/abandoned/DNP | `championship.test.ts` §totalPoints |
| Projection suppressed until thru 5, never for DNP, one decimal | `championship.test.ts` §computeProjection |
| `tiebreak.ts` — holes-won, countback chain, round-preference order, shortened fallback | `outrightHoleWinner`, `tallyHolesWon`, `countbackHoleStages`, `resolveCountback`; `tiebreak.test.ts` (11) |
| Holes-won: outright low net, halved→nobody, picked-up can't win, <2 completed→nobody | `tiebreak.test.ts` §outrightHoleWinner |
| Countback branches: preference order, all abandoned→tie, shortened <hole 10 fallback | `tiebreak.test.ts` §resolveCountback |
| `money.ts` — purse allocation, CTP weights, greedy settlement (integer cents) | `computePurse`, `settle`, `allocate*Cents`, `reconcile`; `money.test.ts` (13) |
| CTP weighted by par-3 count (every par 3 worth ~the same); abandoned round redistributes | `money.test.ts` §computePurse |
| Three-way $100 split reconciles to the cent; greedy settlement ≤ n−1 transfers | `money.test.ts` §settle / §reconcile |
| `types.ts` + `index.ts` barrel | Public surface; all views import from `@/lib/scoring` |

### Automated tests

`npm run test:scoring` → **67 passed** (6 files), dot reporter. Also `npx tsc -b` clean and `npm run build` clean (production bundle unchanged at 56 modules — test files are not bundled).

### Manual tests

Course-handicap hand calculations verified against the resort's published rating/slope for one tee on each course; arithmetic is written out in comments above each worked-example test. Black uses par 73 in the `(Rating − Par)` term and reproduces the brief's worksheet figures exactly.

### Deferred requirements / open items

- **Overall countback preference order** is parameterized (`DEFAULT_COUNTBACK_ROUND_ORDER = [3,4,2,1]`, the brief's literal text). Per Kyle's Phase 3 instruction, the positional-vs-re-pin-to-Black decision is left as a note (see handoff). Changing it is a one-line edit to that constant.
- Shortened round that reached hole 10 but not 18: the standard windows are clamped to the counted end (documented in `countbackHoleStages`). The brief only specifies the <hole-10 fallback; this is a reasonable extension, tested only for the full-18 and <hole-10 cases the brief names.
- `money.ts` is the pure engine only; wiring to `settings`/`round_money` and the Money UI is Phase 7.

### Deviations

1. **Built before Phase 2.** Phase 2 (Supabase schema/RLS/seeds) needs Docker + the Supabase CLI to verify and neither is installed on this machine; the scoring engine has no DB dependency, so Phase 3 was built first at Kyle's direction. Phase 2 remains to be done.
2. **Branch base:** `phase-3-scoring` branches from `phase-1-scaffold`, not `main`/`phase-2`, for the same reason.

---

## Phase 4 — Read-only UI

_(To be filled in at end of Phase 4.)_

---

## Phase 5 — Auth + score entry

_(To be filled in at end of Phase 5.)_

---

## Phase 6 — Offline

_(To be filled in at end of Phase 6.)_

---

## Phase 7 — Money

_(To be filled in at end of Phase 7.)_

---

## Phase 8 — Info + admin editors

_(To be filled in at end of Phase 8.)_

---

## Phase 9 — Polish

_(To be filled in at end of Phase 9.)_

---

## Definition-of-done tracker (from the brief)

These are the final acceptance criteria. Every line needs verification evidence before the trip.

- [ ] All four rounds enterable end to end, hole by hole, from a phone, including picked-up holes
- [ ] Round 4 entry is blocked until the Bone Valley card is complete and validated, and unblocks the moment it is
- [ ] Changing a point value in admin instantly recalculates every leaderboard from stored gross scores
- [ ] Changing an index or allowance does not, and requires an explicit re-snapshot
- [ ] Handicaps verify by hand (Red, Blue, Black) against a manual calculation
- [ ] Strokes-received hole list matches the printed scorecard's stroke index
- [ ] No playing handicap anywhere in the app exceeds 18
- [ ] Two phones open at once: a score on one appears on the other without a refresh
- [ ] Airplane-mode test: 18 holes × 4 players entered offline, force-quit, cold reopen offline, then reconnect syncs without loss or duplication
- [ ] Admin screens clearly refuse to write while offline; score entry in the same session stays fully functional
- [ ] Stale offline writes never clobber newer data; losing device rolls back to the winner
- [ ] A refetch on reconnect never wipes unsynced local entry
- [ ] Every server-side validation rule is enforced against a direct API call
- [ ] Anon cannot write to any table without a valid PIN session (demonstrate with `curl`)
- [ ] Anon can read every public table and Realtime events actually arrive (demonstrate with `curl` and a socket client)
- [ ] Failed PIN attempts on one device never lock out a device that already holds a valid session
- [ ] Buy-in mode reconciles to the cent
- [ ] Lighthouse mobile performance and accessibility both above 90
- [ ] Deployed and reachable at a live Netlify URL
