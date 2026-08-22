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
- **Combo tees seeded 2026-08-22** (Green/Black, Black/Silver, Silver/Gold on Red/Blue/Black — migration `20260822090000_seed_combo_tees.sql`). All nine carry the card's rating/slope/total AND full per-hole yardages: the card's single ▲/▼ "Combo" row gives all three combos (▲ = back tee of the pair, ▼ = forward tee), and every combo's 18 yardages were verified to sum to its printed total. So they pass the course-publish check like any base tee. Bone Valley has no combos (no card yet).
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

Built on branch `phase-4-read-ui` (off `phase-2-schema`, which carries Phases 1+2+3).
The read pipeline is real and end-to-end: **anon Supabase SELECT → TanStack Query →
Dexie → `useLiveQuery` → screen**. Every derived number comes from the Phase 3 scoring
engine; no scoring math is recomputed in a component. Verified live against a local
Supabase stack seeded with Phase-4 fake scores.

### Implemented

| Requirement | Verification |
|---|---|
| Read path honors the data-layering rule | `src/lib/supabase.ts` (anon client) → `src/lib/data/hydrate.ts` (TanStack Query fetches all public tables, bulkPut into Dexie) → components read **only** via `src/lib/data/selectors.ts` (`useLiveQuery`). No screen imports Dexie or Supabase directly. `QueryProvider` in `main.tsx`; `HydrationGate` in the shell |
| Seeded fake scores (Phase 4 seed) | `supabase/migrations/20260817120000_seed_phase4_fake_scores.sql`, **generated** by `scripts/gen-phase4-seed.ts` so handicap snapshots are computed by the real engine. `supabase db reset` applies clean; anon REST returns 170 `scores` + 12 `round_players`. R1 Red final(18); R2 Black final but **curtailed after 15** (`holes_counted=15`); R3 Blue **in progress** (~thru 13), Chris **DNP** |
| Standings, cumulative + **live** + position change | `/standings`. The overall board is **inclusive of the round in play** (Kyle's request): the live `in_progress` round counts toward the total as it stands. Live: Jon 91, Adam 84 (▲1), Kyle 83 (▼1), Chris 48 — Adam climbs past Kyle on the live round. Position change is movement between the two most recent counting rounds (R2-final → R3-live). Matrix marks R3 live (•, counted) / R4 upcoming (·, not counted). `Movement.tsx` renders ▲/▼/–/· |
| Rounds list | `/rounds`. Each round: course, ET day+tee time, `StatusBadge` (Final / • In progress / Upcoming), round **winner/leader** name. Bone Valley shown |
| Round detail: leaderboard | `/rounds/:n`. Round-specific board (distinct from championship). R2 result Kyle 30 / Jon 26 / Adam 23 / Chris 22; live R3 shows "thru X · proj Y" (Jon 25/13×18 = **34.6**, Adam 20/12×18 = **30.0**); tied players share rank |
| Round detail: scorecard grid | `Scorecard.tsx` — horizontally-scrollable, sticky label column, Par/S.I. rows, OUT/IN/TOT. Points ⇆ Gross toggle. Net-to-par marks (circle=net birdie+, square=net bogey+), strokes-received pips, **PU** cells, per-nine + total subtotals |
| **Derived points match the engine** | Hand-checked R2 Jon front nine: 2+1+2+2+2+2+1+2+3 = **17 = OUT**; total 26 = leaderboard. All cells are `computeHoleResult` output surfaced via `compute.ts`; the generator's stderr dump is the independent expected-value source |
| Excluded-holes strikethrough | R2 holes 16–18 render struck-through "–" (past the `holes_counted=15` cutoff). Header shows "Shortened — 15 holes count" |
| PU legend | Rendered under every scorecard (net birdie+, net bogey+, strokes received, PU, excluded) |
| Position-change indicators against prior-round data | See Standings row — ▲1 / ▼1 driven by `standingsThroughRound` for the previous counting round |
| Handicap worksheet toggle | `HandicapWorksheet.tsx` (collapsible). Re-derives each line from stored snapshot inputs. Verified by hand: Jon 9.2 → 10.99 + 1.7 = 12.69 → PH 13; Kyle 12.4 → 16.51 → 17; **CAPPED 18** badge on Chris (22→18); Adam's exact 18.43→18 shows **no** cap |
| Players page | `/info/players`. Roster with initials avatars, index with `*` for unassigned, live footnote from `settings.assigned_index_footnote` |
| Rules page | `/info/rules`. Format, **live** points table + allowance + cap from `settings`, money split, ties. Plain language (no annual-report winking) |
| Design tokens / tabular numerals / dark / 44px | All screens use the Phase 1 tokens; numbers are `tnum`; tap targets ≥44px; `font-size:16px` inputs preserved. No console errors on any route |

### Automated tests

Scoring suite unchanged: `npx vitest run src/lib/scoring --reporter=dot` → **67 passed**.
`npx tsc -b --noEmit` clean; `npm run build` succeeds. No new unit tests were added —
Phase 4 is presentation over the already-tested engine, verified live against known-good
generator output (per the phase plan's screenshot-based verification).

### Manual tests

- `supabase db reset` applies the Phase-4 seed clean; anon REST reads confirm 170 scores /
  12 round_players / correct round statuses.
- Live browser walk-through (screenshots captured in-session): Standings, Rounds list,
  Round 1 (final), Round 2 (scorecard Points + Gross, worksheet open with cap badge),
  Round 3 (live projections + DNP), Round 4 (Bone Valley placeholder), Players, Rules.
- Toggles exercised: Points⇆Gross scorecard, worksheet expand/collapse.

### Deferred requirements / open items

- **No write path** — correct for Phase 4. Score entry, PIN auth, RPCs, Realtime, and the
  offline outbox/comparator are Phases 5–6. The Enter/Money/Admin/Itinerary/Courses screens
  remain Phase-1 stubs.
- **Fake scores are invented** for the demo and are overwritten by real entry in Phase 5+.
- **Bundle size** now 616 KB (184 KB gzip) after adding supabase-js + TanStack Query + Dexie;
  over Vite's 500 KB warning. Code-splitting is a Phase 9 concern.
- **Home is briefly behind the hydration gate** on a cold, empty-cache first visit (falls
  through instantly once Dexie is populated, which persists). Making the marquee Home fully
  static-first is a Phase 9 nicety.

### Deviations

1. **Read pipeline built for real, not stubbed.** The phase plan says "via Dexie +
   `useLiveQuery` after TanStack Query hydrates"; since Docker + the Supabase CLI are
   available, this was wired against a live local Supabase rather than faked — the same
   pipeline Phase 5/6 extend. Only the *scores* are fake.
2. **Fake-scores seed is generated, not hand-written.** `scripts/gen-phase4-seed.ts` imports
   the scoring engine so `round_players` handicap snapshots are guaranteed consistent with
   what the UI derives; its stderr dump doubles as the expected-value oracle.
3. **Scorecard shows net-to-par marks on the displayed value in both modes.** In Points mode
   the circle/square encodes the hole's net-to-par while the number is points — a deliberate
   dual-encoding, clarified by the always-on legend.
4. **Overall standings are live-inclusive (overrides a Phase 3 default).** Kyle asked the
   overall scoreboard to include the current round. `src/lib/data/compute.ts` sets a round's
   `counts` flag true for `final` **and** `in_progress` (never `upcoming`/`abandoned`); the
   pure engine is unchanged (the caller has always owned the `counts` flag). Nothing jumps at
   finalization — the live points were already in the total. The Phase 3 doc comment in
   `championship.ts` was softened to say the caller decides. This supersedes the "final only"
   line in `championship.ts`'s original comment; **do not revert.**

---

## Phase 5A — Auth + score entry (online only)

**Phase 5 was split.** As specified it covers the PIN Edge Function, sessions, ~20 RPCs,
every server-side validation rule, the Enter screen, *and* four admin editors (players,
courses + Bone Valley validate-and-publish, rounds + finalize/abandon/re-snapshot,
settings). That is two sessions of work, and the brief explicitly says to split an
oversized phase rather than rush the back half. **5A is auth + the write path + Enter,
which is what the phase title names and what Phase 6 builds on. 5B is the admin
editors and their RPCs.** Nothing in 5A is stubbed.

Built on branch `phase-4-read-ui` (Phase 4 is still uncommitted, awaiting sign-off).

> **Mid-phase amendment — the PIN came off score entry.** Kyle: *"I dont want a pin - just
> a hole by hole save button."* Asked whether `/admin` should lose it too, he chose entry
> only. So `rpc_upsert_scores` and `rpc_upsert_ctp` now take **no session token** and the
> Enter screen has an explicit per-hole **Save** button instead of a lock;
> `rpc_upsert_round_player` and every admin RPC still require a session. The brief carries
> a marked amendment and the reasoning + accepted exposure are in `decisions.md`
> §"PIN removed from score entry". The auth machinery below was all built and tested first
> and is **retained in full** for `/admin` (Phase 5B) — none of it is dead-lettered.

### Implemented

| Requirement | Verification |
|---|---|
| PIN Edge Function with argon2id, real client IP | `supabase/functions/pin-verify/index.ts`. argon2id via `npm:hash-wasm` at OWASP parameters (m=19456 KiB, t=3, p=1) — verified running inside `supabase-edge-runtime-1.74.3`. IP from the left-most `x-forwarded-for` entry, which only the edge can see (the reason this is a function and not an RPC) |
| Per-IP throttling; short global backoff at a high threshold; never an indefinite lockout | `public.rpc_pin_gate(inet)`. Per-IP: 5 free failures **since that IP's last success**, then `min(300, 30·2^(n−5))` seconds. Global: only above 25 failures across all IPs in 10 min, and only for 60 s. pgTAP asserts the trip, the scope, the finite `retry_after`, that a *different* IP is unaffected, and that a success clears the count |
| **Failed PIN attempts never invalidate an issued session** | Structural: neither throttle function touches `public.sessions`. pgTAP asserts the session row survives and can still write while another IP is locked out. `scripts/verify-write-path.sh` §10 demonstrates it live: 6 wrong PINs → unlock returns **429 `retry_after: 30`**, and the same session's write returns **200 `applied: true`** |
| Constant error messaging (no PIN oracle) | A wrong PIN and a malformed PIN both return `401 {"error":"Incorrect PIN."}` — verify script §4/§5 |
| PIN hash is an Edge Function secret, never a readable row | `APP_PIN_ARGON2_HASH` env var. `supabase/functions/.env` is gitignored; `.env.example` carries only the local-dev PIN's hash, labelled as such (it hashed `271828` when Phase 5A was verified; now `2718`, after the PIN went to 4 digits) |
| `sessions` populated with hashed tokens, ≥128-bit | 256 bits from `crypto.getRandomValues`; only `encode(sha256(token),'hex')` is stored. pgTAP asserts no row equals the raw token |
| `rpc_create_session`, `rpc_revoke_all_sessions` | `20260818090000_auth_write_rpcs.sql`. **`rpc_create_session` is granted to `service_role` only** — anon minting its own session would make the PIN decorative. pgTAP asserts anon lacks EXECUTE; verify script §2 shows `42501` |
| `rpc_upsert_scores`, `rpc_upsert_ctp`, `rpc_upsert_round_player` | Same migration. Batch `jsonb` in, `[{key, applied, error, row}]` out, so a client can distinguish "rejected as stale" from "error" |
| All `SECURITY DEFINER` with `SET search_path = ''`, fully schema-qualified | pgTAP test 1 counts SECURITY DEFINER functions in `public` **without** `search_path=""` in `proconfig` and asserts **0**. (`COALESCE`/`LEAST`/`GREATEST`/`EXTRACT` appear unqualified because they are SQL constructs, not schema-resolvable functions — noted in the migration header) |
| `CREATE FUNCTION`'s implicit `EXECUTE TO PUBLIC` revoked, re-granted narrowly | Every function has an explicit `revoke ... from public` followed by a grant to `anon` or `service_role`. pgTAP asserts both directions for 8 functions, including that `fn_require_session` is granted to nobody (no token oracle) |
| The comparator, SQL guard (site 1 of 4) | `(excluded.client_updated_at_effective, excluded.client_id) > (existing…)`. pgTAP covers: first write applies; older loses; **the loser is handed the current winner row**; an exact tie on both loses (replays are idempotent); a timestamp tie breaks by `client_id` in both directions; newer wins regardless of client_id |
| `client_updated_at_effective = least(raw, now() + 5 min)`, computed server-side | pgTAP: a write stamped 2031 is accepted, its `_effective` is clamped under `now()+6 min`, and `_raw` still holds the value as sent for diagnostics |
| Whole-tuple replacement; **no `COALESCE` merges** | pgTAP: picking up a hole that had a gross score returns `gross_strokes: null` — both columns are replaced together |
| Every server-side validation rule from the brief | pgTAP §4 + verify script §8, one cell per rule: `round_not_found`, `round_upcoming`, `course_data_is_placeholder`, `no_round_player_row`, `player_not_playing`, `hole_not_on_course`, `gross_strokes_out_of_range` (both ends), `picked_up_requires_null_gross`, `missing_required_field` |
| A failing cell is reported specifically and the batch continues | pgTAP asserts a batch containing a malformed uuid still applies its valid cell. (This needed a fix: the key fields were parsed *outside* the per-cell exception block, so one bad uuid aborted the whole call) |
| CTP validation | pgTAP §6: par-3 only, DNP cannot win, negative distance refused, **null `player_id` accepted** (no winner yet / a carry), and a placeholder card has no par 3s so Bone Valley is refused structurally |
| `rpc_upsert_round_player` — server owns the handicap math | `public.fn_compute_handicap` mirrors `src/lib/scoring/handicap.ts` (numeric `round()` in Postgres is already half-away-from-zero). pgTAP: client-sent outputs of 999 are **ignored** and the server returns 17; `course_handicap` reproduces the hand-verified Blue/Green example (12.4 × 134/113 = 14.70 + 2.0 = **16.70** → 17), matching `handicap.test.ts`; the cap is applied last (index 30 → 18); a tee from another course is refused |
| **Score entry needs no PIN; the gated RPCs still do** | pgTAP asserts `rpc_upsert_scores`/`rpc_upsert_ctp` exist exactly once, take only `cells`/`results` (no overload left behind), and that **anon itself** can call both with no session — while still being denied a direct `INSERT` on `scores` (`42501`), so the RPC remains the only door. `rpc_upsert_round_player` is asserted to refuse a bogus, expired and null token. Verify script §3 vs §7 shows both halves live |
| Session token in Dexie, expiry Feb 8 2027 (for `/admin`) | `src/lib/auth/session.ts` + Dexie `session` table. Dexie, not `sessionStorage` — a force-quit in the cart must not log the scorer out. Expiry `2027-02-08T23:59:59-05:00`, configurable via `APP_SESSION_EXPIRES_AT` |
| Enter screen: hole-by-hole, all players on one screen | `/enter`. Header (hole, par, S.I., yardage + tee name), one row per player with 44px ± steppers and a large number, strokes-received pips, live points, PU button, prev/next, an 18-hole picker marking holes that already have entries, and a "Round N so far" footer with points and thru per player |
| **The par default is display-only and is never written** | Verified live twice — before the Save button (paging 14 holes wrote 0 rows) and after (steppers and PU edit a local draft only; `select count(*) … hole_number = 15` returned **0** with edits visibly pending on screen, and 2 rows immediately after tapping Save). With an explicit Save there is now no code path at all that writes without a deliberate tap |
| Explicit per-hole Save | `Save hole N` commits every edited player on the hole in **one** `rpc_upsert_scores` request. Verified: Jon +3 and Kyle PU → one request → both rows correct. The button reads `No changes` / `Save hole N` / `Saving…` / `Saved`, and unsaved cells carry a `•` marker |
| Unsaved edits survive navigation | Drafts are keyed by hole, not cleared on page. Verified: edited hole 16, paged to 15 and back — the edit and the `Save hole 16` state were both still there. Holes with unsaved edits are outlined in gold in the hole picker, and a footer line lists them when more than one is pending |
| A failed save never loses a hole | `saveCells` returns false and the drafts are kept; the message is non-destructive ("your scores are still here"). Offline is treated as a normal state, not an error |
| Unentered players render muted; "thru X" counts only written rows | Muted at `opacity-60` until entered; DNP at `opacity-40` with no controls. `thru` comes from `computePlayerRound().holesCompleted` |
| Picked-up is a first-class button | Verified live: tapping PU for Kyle on hole 15 wrote `gross_strokes = null, picked_up = true`, the row rendered `—` / `0 pt`, and **thru advanced 13 → 14** while his round total stayed at 19 |
| Round 4 hard-blocked until the card is validated | Verified live (screenshot): `/enter` R4 shows no steppers at all and lists "Par is not set on 18 holes · Stroke index is not set on 18 holes · Green tees are missing yardages", with a link to the editor. Belt-and-braces server-side: `course_data_is_placeholder` (pgTAP) |
| Loud pre-flight when `round_players` rows are missing | Verified live on R4: "No tee or handicap set for Jon Aronson, Kyle Siegel, Adam Hersh, Chris Denove." |
| Writes are coalesced into one request per hole | The 500 ms debounce became unnecessary: an explicit Save is the coalescing point, and one hole is one request carrying up to four cells |
| iOS install-then-unlock tip | On the PIN panel (now `/admin`-only) and in the README |
| Data-layering rule holds in both directions | The write path puts the server's returned rows into Dexie; screens still read only through `selectors.ts`. Optimistic drafts are overlaid in **`compute.ts`**, not patched over rendered numbers, so points/thru/standing derive from the draft through the scoring engine |

### Automated tests

- `supabase test db` → **PASS, 126 tests** (`rls_smoke.sql` 32, `seed_integrity.sql` 23,
  **`write_path.sql` 71**).
- `npx vitest run src/lib/scoring --reporter=dot` → **67 passed**, unchanged.
- `npx tsc -b --noEmit` clean; `npm run build` clean.

### Manual tests

- `scripts/verify-write-path.sh` run end to end against the local stack; full transcript
  in session. All ten sections behaved as described above.
- Browser walkthrough at 375 px, run twice — once with the PIN gate and once after it was
  removed. Pre-amendment: locked → wrong PIN (`Incorrect PIN.`) → correct PIN → unlocked.
  Post-amendment, from a cleared IndexedDB: straight into scoring with no gate; three `+`
  taps and a PU held as unsaved drafts with **0 rows in the database**; one Save wrote both
  cells; an edit on hole 16 survived paging to 15 and back; R4 still hard-blocked. The
  database was queried after each step. No console errors.

### Bugs found and fixed during verification

1. **One malformed cell aborted the whole batch.** `round_id`/`player_id`/`hole_number`
   were cast to uuid/int *before* the per-cell exception block, so a bad uuid raised out of
   the loop — exactly the failure the per-cell error reporting exists to prevent. The key
   is now echoed back as sent and all casts happen inside the guard.
2. **Dexie's `scores` table was keyed by the server `id`, not the logical cell key.** A row
   whose server id changed left the old row behind, so one cell had two conflicting entries
   locally and whichever sorted last won — the UI showed 6 while the database held 9.
   Re-keyed to `[round_id+player_id+hole_number]`, mirroring the Postgres unique key
   (Dexie v3 drops the table, v4 recreates it; it is a read mirror and re-hydrates).
   This also gives the Phase 6 comparator the key it reasons about.
3. **The Phase 4 fake-score seed stamped its client timestamps on the trip dates
   (Feb 2027).** Since the comparator is last-write-wins on `client_updated_at_effective`
   and the server clamps an incoming stamp to `now() + 5 min`, every real entry made before
   the trip lost to the demo data and was rejected as stale. `gen-phase4-seed.ts` now
   stamps January 2026; the seed was regenerated and **only the timestamps changed** (diff
   of all non-timestamp lines is empty).
4. **Rapid stepper taps dropped increments.** The row computed `value + delta` from a prop
   that had not round-tripped yet. The parent now owns the value in a ref, so a burst
   accumulates; `onStep(delta)` is relative rather than absolute.

### Deferred to Phase 5B

- **All admin RPCs and screens**: `rpc_upsert_player/course/tee/hole/hole_yardage`,
  `rpc_validate_and_publish_course`, `rpc_upsert_round`, `rpc_upsert_round_player_admin`,
  `rpc_resnapshot_round_handicaps`, `rpc_finalize_round`, `rpc_abandon_round`,
  `rpc_set_manual_override`, `rpc_upsert_itinerary/lodging/lodging_assignment/settings`,
  `rpc_export_all_scores`; and the players / courses (Bone Valley editor) / rounds /
  settings editors with their online-only guards. `/admin` is still a Phase 1 stub, so the
  Enter screen's "Open the course editor" link currently lands on that stub.
- **`rpc_upsert_ctp` and `rpc_upsert_round_player` have no UI yet** — both are built,
  validated and tested at the SQL layer. CTP entry is Phase 7 (Money); the day-of tee
  change screen is Phase 5B.
- **Round status transitions** are not exposed: a round cannot yet be moved from
  `upcoming` to `in_progress` from the app (Phase 5B `rpc_upsert_round` / finalize).
  R3 is `in_progress` only because the Phase 4 seed set it there.
- **Offline everything** — Phase 6. Phase 5 writes straight through; there is no outbox,
  no local PIN hash, and no Realtime. The "sync indicator" is a request state, not an
  outbox depth.

### Deviations

1. **Phase 5 split into 5A/5B** (see the note at the top of this section).
0. **The PIN came off score entry mid-phase, at Kyle's direction** — see the amendment box
   above. This supersedes the brief; the brief, `decisions.md`, `CLAUDE.md`, the README and
   the pgTAP suite were all updated rather than left describing the old posture.
2. **argon2id comes from `npm:hash-wasm`**, a pure-WASM implementation, because native
   argon2 bindings do not load in the Deno-based edge runtime. Verified working in the
   local edge runtime before anything was built on it.
3. **Local drafts were added**, which the phase plan puts under "Writes go to Dexie, then
   the outbox" (Phase 6). With an explicit Save they are no longer merely an optimisation —
   they are the mechanism: an edit has to live somewhere between the tap and the tap that
   commits it. They are overlaid in the pure layer (`compute.ts`), so points, "thru" and the
   round standing all derive from a pending edit through the scoring engine rather than
   being patched over rendered numbers, and no scoring math moved into a component.
4. **`28000` maps to HTTP 403, not 401**, through this PostgREST version (`42501` maps to
   401). Both are refusals; recorded here rather than claiming 401.
5. **The local-dev PIN hash is committed** in `supabase/functions/.env.example` so a fresh
   clone can run the stack. It hashes `271828` and is labelled as local-only; the real PIN
   is a Supabase secret Kyle sets.

---

## Phase 5B — Admin RPCs + admin editors (online only)

The back half of Phase 5: everything the brief lists under "admin screens" plus the RPCs
behind them. Built on branch `phase-4-read-ui` (Phases 4, 5A and 5B are all uncommitted).
Nothing here is stubbed.

### Implemented

| Requirement | Verification |
|---|---|
| Every admin RPC in `schema.md` §"Admin (online-only)": `rpc_upsert_player` / `_course` / `_tee` / `_hole` / `_hole_yardage` / `_round` / `_round_player_admin` / `_settings` / `_itinerary` / `_lodging` / `_lodging_assignment`, `rpc_validate_and_publish_course`, `rpc_resnapshot_round_handicaps`, `rpc_finalize_round`, `rpc_abandon_round`, `rpc_set_manual_override` | `supabase/migrations/20260819090000_admin_rpcs.sql`; `admin_path.sql` asserts EXECUTE is granted to `anon` on each by exact signature |
| `rpc_export_all_scores` (brief §Diagnostics) | `admin_path.sql`: the payload carries `players, courses, tees, holes, rounds, round_players, scores, ctp_results, round_money, settings, exported_at` and non-empty scores. `verify-admin-path.sh` §15 prints 170 score rows / 12 round_players rows over PostgREST |
| **All 18 are `SECURITY DEFINER` with `SET search_path = ''`, fully schema-qualified** | `admin_path.sql` test 1 asserts zero unpinned `SECURITY DEFINER` functions in `public` (catches any future one too) |
| **Every admin RPC requires a PIN session** | 18 individual `throws_ok('28000')` assertions in `admin_path.sql`, plus an expired-session case. `verify-admin-path.sh` §1 shows all 18 answering **403** over PostgREST with a forged token and the real argument list |
| Anon still cannot write to an admin table directly | `verify-admin-path.sh` §2: `PATCH /courses` → `42501` "permission denied for table courses" |
| Admin screens for **players** (name, title, index, agreed-index flag) | `src/components/admin/PlayersEditor.tsx`; browser at 375 px |
| Admin screen for **courses** — Bone Valley editor + validate-and-publish | `src/components/admin/CoursesEditor.tsx`. Browser: Bone Valley listed "4 to fix"; Validate & publish returned the server's five reasons; hole 1 saved par 4 / S.I. 5 / 412 yds and the DB row shows exactly that; the on-screen issue list re-derived from Dexie to "17 holes" without a reload |
| Admin screen for **rounds** — tee assignment, start, finalize, abandon, re-snapshot | `src/components/admin/RoundsEditor.tsx`. Browser: Finalize on R3 rendered "Jon Aronson is missing 5 hole(s) / Kyle Siegel 5 / Adam Hersh 6" and **not** Chris Denove (DNP) |
| Admin screen for **settings** — points table, allowance, cap, purse | `src/components/admin/SettingsEditor.tsx`. Browser: allowance 100 → 95 saved; `select value from settings where key='allowance'` → `0.95` |
| Online-only guards with a plain-language notice | `Admin.tsx`. Browser: with `navigator.onLine` forced false, the banner reads "No connection. Admin changes go straight to the server — they are not queued like scores are," and every control is disabled |
| Round 4 stays hard-blocked until the card is published | `verify-admin-path.sh` §4–§5: Bone Valley refuses to publish with five specific reasons, and `rpc_start_round` on R4 then refuses with "the course card is not published yet" |
| Changing an index is **not** retroactive; re-snapshot is the explicit action | `admin_path.sql`: after `rpc_upsert_player` moves Jon to 20.0, R1's `index_used` is still 9.2; `rpc_resnapshot_round_handicaps` on R3 rewrites every row to 20.0 while R1 keeps its own snapshot |
| Server owns the handicap math on every path | `rpc_upsert_round_player_admin` sends INPUTS only and calls the same `fn_compute_handicap` the outbox variant uses; `admin_path.sql` asserts `strokes_received` came back computed, and that a tee from another course is refused |
| `rpc_finalize_round` writes `round_money` matching a compute-time derivation | `admin_path.sql`: $100 × 4 players, 40/30/30, four counting rounds → `championship_share_cents` 4000, `round_purse_cents` 3000, `par_3_count` from the round's own card. `verify-admin-path.sh` §12 shows the same row over the API |
| Every server-side validation rule tested by direct API call | `verify-admin-path.sh` §7–§10 (hole edit un-publishes; slope 1370 refused; hole 19 refused; cross-course tee refused; unknown settings key, malformed points table, 150% allowance all refused) |

### Automated tests

`supabase test db` → **232 pass** across four files (**106 new** in `supabase/tests/admin_path.sql`).
`npx vitest run --reporter=dot` → 67 pass (unchanged; the scoring engine did not move).
`npx tsc -b` and `npm run build` clean.

Notable assertions beyond the table above:

- `fn_allocate_even_cents` / `fn_allocate_proportional_cents` are asserted against the same
  cases as `allocateEvenCents` / `allocateProportionalCents` in `src/lib/scoring/money.ts` —
  `1000/3 → {334,333,333}` (remainder to the *earliest* part), the 40/30/30 split of a $400
  pool, the 4/4/5/0 CTP split summing back exactly, and the zero-weight and zero-parts cases
  that would otherwise divide by zero.
- The two helpers are asserted **not** executable by `anon`: they are internal arithmetic,
  reachable only from inside a definer function.
- A duplicate stroke index refuses to publish even though all 18 values are non-null.
- A tee with a null slope refuses to publish (see Deviations).
- A `final` round refuses to re-snapshot; an `abandoned` round refuses to finalize; abandoning
  a finalized round removes its `round_money` row but keeps its scores.

### Manual tests

Browser at 375 × 812, dark, against local Supabase + `supabase functions serve`:

1. `/admin` locked → PIN gate with copy explaining why admin is gated and score entry is not.
2. Unlocked with `271828` → "Session runs to Mon, Feb 8", four tabs.
3. **Courses → Bone Valley**: issue list, Validate & publish refusal, one hole entered and
   saved, DB row confirmed by `psql`, issue list re-derived to 17 with no reload.
4. **Rounds → R3**: per-player "thru 13 · 5 to go", Finalize refused naming three players and
   omitting the DNP.
5. **Settings**: allowance saved and confirmed in `settings`.
6. **Offline**: banner up, controls disabled, banner clears on reconnect.
7. **Points-table retroactivity, round trip through the UI.** `/standings` read
   91 / 84 / 83 / 48. Settings → "Level" 2 → 3 → Save; `/standings` re-read
   113 / 112 / 110 / 64 **and the order changed** (Adam 112 passed Kyle 110). Set it back to
   2; standings returned to 91 / 84 / 83 / 48 exactly. No scores were touched — every figure
   re-derived from stored gross strokes.
8. Browser console: no errors or warnings beyond the pre-existing React Router v7 future-flag
   notice.

### Deferred requirements

| Deferred | To | Why |
|---|---|---|
| Itinerary / lodging **editors** (the RPCs exist and are gated + tested) | Phase 8 | The phase plan puts Info sub-pages and their editors in Phase 8 |
| Buy-in vs fixed **reconciliation** on the Money page | Phase 7 | The purse *settings* are editable here; the Money page derives from them |
| Export as **CSV**, and the rest of the Diagnostics screen | Phase 6 | JSON export + copy-to-clipboard ships now; the CSV shape and the outbox/dead-letter views belong with the offline work |
| Photo upload for players (`photo_url` is passed through unchanged) | Phase 9 | Needs the upload Edge Function |
| Adding/removing players and courses from the UI | — | The RPCs support it; the trip has four fixed players and four fixed courses, and a create form is a way to make a duplicate at 6 a.m. Edit-in-place only |

### Deviations from the brief

1. **`rpc_start_round` was added.** Nothing in `schema.md` could move a round out of
   `upcoming`, yet the Enter screen tells the scorer to "start it from admin". See
   `decisions.md` §"Starting a round".
2. **Publishing a course also requires rating and slope on every tee** — a fifth check beyond
   the brief's four. `fn_compute_handicap` falls back to slope 113 on null, so the brief's
   checks alone could publish a card that hands out quietly wrong strokes.
   `decisions.md` §"Publishing a course also requires a rating and slope on every tee".
3. **Editing a hole un-publishes the card, and new courses start as placeholders.** Stronger
   than the brief, which only says the publish RPC is the one thing that may clear the flag.
   `decisions.md` §"A new course starts as a placeholder…".
4. **`round_money.championship_share_cents` is read as this round's share**, not the whole
   pot, so the four rows are additive. `decisions.md`.
5. **`rpc_upsert_settings` is a whitelist.** The brief does not say to validate settings
   shapes; they are retroactive at compute time, so a malformed value silently rewrites every
   leaderboard.

### Resolved in-session — the brief's par-3 claim

The brief says Streamsong Black has five par 3s and uses that to motivate the CTP weighting.
The seed said four. **Kyle supplied the resort's 2021 scorecard PDFs and the seed is right:**
Black has four par 3s (5, 7, 15, 17) and five par 5s (1, 4, 10, 12, 18); 4×3 + 9×4 + 5×5 = 73.

| Checked | Result |
|---|---|
| All three cards transcribed and diffed against the database — 54 hole pars, 54 stroke indexes, 12 tee rating/slope/par/total rows, 216 hole yardages | **0 discrepancies.** `python3 scripts/verify-card-data.py` |
| The transcription checks itself against each card's printed Out / In / Total, and that each stroke-index row is a 1–18 permutation | Passes, so a transcription typo cannot masquerade as a seed error |
| Anything in code assuming five par 3s | None. `computePurse` reads the count from the data. The only carrier was a fixture comment in `money.test.ts`, now corrected |

Changed: the brief carries a marked correction; `decisions.md` §"RESOLVED — the brief's
'Black has five par 3s' is wrong"; a provenance note in the seed migration; the
`money.test.ts` fixture comment. **No seed data and no scoring code changed.** The fixture
keeps its uneven 4/5/4/4 par-3 counts on purpose — with the real 4/4/4/4 a proportional
split and a flat split are indistinguishable and the test would pass on a broken
implementation.

The CTP-by-par-3-count rule still earns its place: Bone Valley's count is unknown until its
card is entered, and an abandoned round redistributes.

---

## Phase 6a — Offline: outbox and comparator

Phase 6 was pre-committed to a split (`phase-plan.md`). **6a is this session:** Dexie
tables, the outbox and dead-letter, the comparator in one file applied at all four sites,
Realtime, the reachability probe, and the tests. **6b is not built:** service worker, PWA
install, `navigator.storage.persist()`, offline PIN, Diagnostics, CSV export.

### Implemented

| Requirement | Verification |
|---|---|
| Dexie schema mirroring the server tables; `ctp_results` added | `src/lib/db.ts` v5 — `ctp_results` keyed `[round_id+hole_number]`, mirroring its Postgres unique key; hydrate fetches it and anon can read it (`curl` → 200) |
| Outbox and dead-letter tables; client UUID + local sequence number | `db.outbox` (`++seq`, the brief's local sequence number, also the flush tie-break), `db.dead_letter` keyed by the item's stable client UUID |
| `client_id` persisted | `src/lib/clientId.ts` (localStorage, unchanged since Phase 5); observed as one stable uuid across every row written in the browser run below |
| Monotonic, persisted timestamps | `src/lib/sync/clock.ts` — `max(Date.now(), lastIssued + 1)` in `sync_meta`. `clock.test.ts`: three stamps in one millisecond are distinct and increasing; a **backwards** clock jump still yields a larger stamp; the high-water mark survives `db.close()` + reopen |
| Comparator in one file | `src/lib/sync/comparator.ts`. Nothing else defines an ordering; the other three sites import `incomingWins` / `compareStamps` |
| Comparator applied at all four sites | 1 SQL guard (Phase 5A, `write_path.sql`); 2 `realtime.ts` `applyScoreEvent` / `applyCtpEvent`; 3 `merge.ts` `mergeStampedRows`, called by `hydrate.ts`; 4 `outbox.ts` `shieldAllows` — used by sites 2, 3 **and** by the write-back of acknowledged rows |
| Whole-tuple replacement enforced | Payloads are whole cells (`gross_strokes` + `picked_up` together); coalescing keeps the latest entry per key and discards the rest, which is only safe *because* nothing is a delta. No `COALESCE` merge exists on either side |
| Flush before refetch | `useHydrate()`'s `queryFn` awaits `flushOutbox()` before `fetchAll()` |
| Realtime echo clears markers only when its timestamp is ≥ the newest pending | `outbox.ts` `clearEchoed()` — compares stamps, not `client_id` alone; the echo of an older write leaves a newer pending entry queued |
| Reachability probe backing `navigator.onLine` | `src/lib/sync/reachability.ts` — HEAD `/rest/v1/`, 3 s timeout, two consecutive flush failures trip Offline. Proved in the browser: with the API container stopped and `navigator.onLine` still **true**, the badge read OFFLINE |
| Flush triggers | `engine.ts`: `online` event, visibilitychange (guarded on `visible`), 60 s interval, Realtime `SUBSCRIBED`, and immediately after a save |
| Pending count surfaced whenever the outbox is non-empty, gone when it drains | `ConnectionBadge` reads `useSyncSnapshot()` off Dexie; observed reading "9 TO SYNC" → "ONLINE" |
| Poison items do not block the queue | `outbox.ts` — terminal refusals dead-letter on the first answer, retryables after 8 attempts, and the pass continues either way |
| Never permanently delete an unsynced mutation | `transferToDeadLetter()` is an atomic move inside one transaction, keeping payload, both timestamps, attempt count and last error; `retryDeadLetter()` puts it back |

### Automated tests

`npm run test:sync` — **39 tests**, `fake-indexeddb` (real Dexie, real schema upgrades, real
transactions) plus a `FakeServer` in `src/test/fakeServer.ts`. Full suite: `npx vitest run`
→ **106 passed** (67 scoring + 39 sync). `npx supabase test db` → **232 passed**, unchanged.

Covering the brief's list by name:

| Brief's required test | Where |
|---|---|
| Queue survives a simulated app kill and replays in order | `outbox.test.ts` "the queue survives an app kill and replays in order" — `db.close()`/reopen between enqueue and flush; the wire order is `[1, 2, 3]` |
| Replaying the same item twice produces one row, not two | same file — the replayed entry settles as `'stale'`; one server row, one Dexie row |
| Poison item transfers to dead-letter with payload intact, and the queue continues | "moves a refused cell to dead-letter with its payload intact" — 1 dead-lettered, 2 of 3 holes still sent |
| A stale self-echo does not clear the unsynced marker on a newer pending write | "the self-echo rule" ×3 — a covering echo clears, a stale echo leaves the newer entry, another device's write is not an echo at all |
| Points and standings compute correctly with the network fully disabled | "standings compute from the local rows with the network fully disabled" — `buildStandings` over Dexie after an offline enqueue, `server.requests === 0` |
| Two simulated devices editing the same hole offline converge to the same final state on both | "two devices editing the same hole while both offline" — two client_ids, two storages; the later write wins, the loser rolls onto the winner, nothing is retried or dead-lettered |
| The LWW guard tested against real Postgres | Phase 5A `supabase/tests/write_path.sql` (stale rejected; exact tie loses; `client_id` tie-break; skew clamp). `comparator.test.ts` re-runs those **same four cases** in TypeScript so the two languages are visibly aligned |

Also covered: microsecond-precision ordering (`Date.parse` truncation would silently drop a
write), coalescing five stepper taps into one wire cell, an offline flush costing zero
attempts across six passes, the clamp write-back, and a Realtime row landing mid-flight not
being undone by the in-flight response.

### Manual tests — browser at 375 px against local Supabase, 2026-08-18

Input events were dispatched as DOM clicks: the harness's click injection timed out
throughout this session (the pane reported `visibilityState: 'hidden'`), so taps were
delivered to the same React handlers by `dispatchEvent`. Everything else — the app, the
network, Postgres, the Realtime socket — is real.

1. **Online save.** Hole 14 of R3, two players. Button went `Save hole 14` → `Saved`, badge
   ONLINE, and Postgres held both rows with matching `client_updated_at_raw` /
   `_effective` and one `client_id`.
2. **Dead zone.** With Supabase requests failing, holes 15–17 × 3 players were entered and
   saved. Badge read **9 TO SYNC**; the line under Save read "Saved on this phone — it'll
   sync when you have signal. (3 holes waiting)"; the round footer advanced to **thru 17**
   from local rows alone. `select … where hole_number in (15,16,17)` → **none**.
3. **Reconnect.** All 9 landed — **carrying their original offline timestamps**
   (06:01:40 / 06:01:43 / 06:01:46), not the flush time — with no duplicates.
4. **Cold reopen while genuinely offline.** `docker stop supabase_kong_BOD2027`, hole 18
   entered and saved, then a full page load. Standings rendered in full from Dexie, badge
   read **2 TO SYNC**, both outbox entries were intact with **`attempts: 0`** and
   `dead_letter` empty — offline had cost nothing. Restarting the container drained the
   queue (Realtime `SUBSCRIBED` fired the flush) and hole 18 landed with its offline stamp.
5. **Realtime in, winning.** A direct SQL write to R3 hole 14 with a newer stamp and a
   foreign `client_id` appeared in Dexie within ~2 s with no reload. Its
   `client_updated_at_effective` came back as `…T06:06:21.603907+00:00` — the microsecond
   precision the comparator parses rather than truncates.
6. **Realtime in, losing.** The same row rewritten with a 2020 stamp did **not** land; Dexie
   kept the newer value. Comparator site 2 confirmed against a real socket.
7. Database restored with `npx supabase db reset` (170 seed scores) and `supabase test db`
   re-run: 232 pass.

### Deferred requirements

| Requirement | Phase | Why |
|---|---|---|
| `vite-plugin-pwa` + Workbox, `registerType: 'prompt'`, `globPatterns` / `maximumFileSizeToCacheInBytes` | 6b | The pre-committed split |
| `navigator.storage.persist()` after unlock | 6b | Belongs with the PIN work it hangs off |
| Offline PIN verification (bcrypt cost 10) | 6b | Same |
| Diagnostics screen (client_id, session expiry, last sync, outbox, dead-letter with Retry / Export-JSON, copy-state-as-JSON) | 6b | `retryDeadLetter()`, `lastSyncAt()` and `useSyncSnapshot()` exist and are tested; 6b builds the screen over them |
| Admin "export all scores" as CSV | 6b | JSON export shipped in 5B |
| `round_player` as an outbox kind (the day-of tee change) | 6b | It is the one queued write that needs a **session token**, so it waits for the offline PIN. `decisions.md` §"Answer to the open question" is unchanged; the queue's `kind` discriminator is already in place |
| Two real phones converging; iOS install-then-unlock | Manual, pre-trip | Cannot be automated. `handoff.md` carries them |

### Deviations from the brief

1. **Offline costs no retry attempts.** The brief says "after N attempts, move to
   dead-letter." Applied literally to a network failure, a long dead zone would exhaust the
   budget and dead-letter a round no server ever refused. Only an answer from the server
   counts. `decisions.md` §"Offline costs no retry attempts".
2. **An acknowledged row overwrites our optimistic row unconditionally** when it is our own
   (same `client_id` + `raw`), rather than going through the comparator. This is how the
   server's 5-minute clamp is adopted; the comparator still governs every other write-back.
   `decisions.md` §"The server's row replaces our optimistic row".
3. **`ctp_results` is mirrored and queueable before its UI exists** (Phase 7). The brief
   requires the local store to cache every CTP result; building the second outbox kind now
   is what keeps the queue general. `decisions.md` §"`ctp_results` mirrored into Dexie in 6a".
4. **Save's contract changed.** It now resolves once the hole is durably queued, not once
   the server has it — which is the whole point of the outbox, but it is a real change to
   Phase 5A's behaviour and the copy under the button changed with it.

---

## Phase 6b — Offline: PWA, offline PIN, day-of tee change, Diagnostics, CSV

The back half of Phase 6, on branch `phase-6-offline` (Phases 4–6 all still uncommitted to
`main`). Nothing here is stubbed. Deps added: `vite-plugin-pwa` (dev), `bcryptjs`.

### Implemented

| Requirement | Verification |
|---|---|
| `vite-plugin-pwa` + Workbox, `registerType: 'prompt'`, no `skipWaiting`/`clientsClaim` | `vite.config.ts`. `npm run build` emits `dist/sw.js`, `dist/workbox-*.js`, `dist/manifest.webmanifest`; PWA log: `generateSW`, precache **22 entries (1230 KiB)** |
| `globPatterns` and `maximumFileSizeToCacheInBytes` set **explicitly** (the brief) | `workbox.globPatterns` = `**/*.{js,css,html,woff2,svg,png,jpg,ico,webmanifest}`, `maximumFileSizeToCacheInBytes` = 4 MiB. The built `sw.js` precache list includes `assets/hero.jpg` (~360 KB, over Workbox's 2 MiB default would-be cap only if larger — set high deliberately), both fonts, all icons, the manifest and the shell |
| Update toast in the top bar, **suppressed while `outbox.length > 0`** | `src/components/PwaUpdatePrompt.tsx` (`useRegisterSW`); renders `null` when `useSyncSnapshot().pending > 0`. `injectRegister: false` — React owns registration, so there is no second auto-register |
| `navigator.storage.persist()` after unlock | `src/lib/storage.ts` `requestPersistentStorage()`, called by `unlock`/`unlockOffline` and once on cold-start if a session exists (`ensurePersistedIfUnlocked` in `Layout`). Guarded, best-effort |
| Offline PIN verification via a stored bcrypt hash (cost 10) | `pin-verify` returns `pin_bcrypt_hash` on success (env `APP_PIN_BCRYPT_HASH`); `session.ts` caches it in `sync_meta`, `unlockOffline()` verifies with `bcryptjs`. **Live:** a real curl unlock with PIN `2718` returned `"pin_bcrypt_hash":"$2b$10$…"`; in the browser after unlocking, Dexie `sync_meta` held the `$2b$10$` hash and the session row was `{offline:false, token:…}` |
| Offline unlock grants UI access but no server token | `SessionRow.offline`; `readToken()` returns null for an offline session. `session.test.ts`: right PIN → `offline:true`, `token:''`, `readToken()` null; wrong PIN rejected; hash survives `lock()` |
| Diagnostics screen | `src/routes/Diagnostics.tsx` at `/diagnostics`, linked from `/admin`. PIN-gated, **not** connection-gated. **Live (375 px):** unlocked with `2718`, rendered client_id, "Server token held", "Session expires Mon, Feb 8", reachability `online`, last sync, "Outbox — 0 waiting", "Dead letter — 0 stuck", "Copy state as JSON". No console errors |
| Diagnostics: outbox, dead-letter with Retry / Export-JSON, copy-state-as-JSON | Reads `db.outbox`/`db.dead_letter` via `useLiveQuery`; each dead item has Retry (`retryDeadLetter`) and Export JSON; "Copy state as JSON" assembles a snapshot with the **session token omitted** |
| `round_player` as the third outbox kind | `enqueueRoundPlayer` (optimistic row via `computeHandicap`), key `rp|round|player`, flushed via `rpc_upsert_round_player` with a token. Applied at all four comparator sites (SQL guard existed; added merge, `applyRoundPlayerEvent`, shield/write-back). `roundplayer.test.ts` (7): optimistic compute offline, recompute on tee change, flush with token, **defer without a token then send after one appears**, offline-only-session defer, shield holds a stale server row, self-echo clears |
| Day-of tee change works offline; the rest of `/admin` does not | Rounds editor's "Save tees & handicaps" → `saveRoundPlayersQueued`, enabled while offline; the banner now carves out the exception. **Live against real Postgres:** `rpc_upsert_round_player` accepted the client's exact wire payload for R3/Jon on the Black tee → `applied:true`, `strokes_received` recomputed 13→**10** (CH 10.38), row carried our `client_id` and the effective stamp |
| Admin "export all scores" as CSV/JSON | JSON (5B) kept; CSV added — `src/lib/data/csv.ts` `scoresToCsv()`, wired into the Export panel. `csv.test.ts` (3): names resolved, sorted round→player→hole, comma-quoting, empty-safe |
| Dark / tabular / 44px / no console errors | New screens use the Phase 1 tokens; Diagnostics verified at 375 px with no console errors |

### Automated tests

- `npm run test:sync` → **46** (adds `roundplayer.test.ts`, 7).
- `npx vitest run --reporter=dot` → **122** (67 scoring + 46 sync + 6 auth `session.test.ts`
  + 3 `csv.test.ts`). Was 106.
- `npx tsc -b --noEmit` clean; `npm run build` clean (708 KB JS / 213 KB gzip — over Vite's
  500 KB warning, unchanged posture; code-splitting is Phase 9).
- `supabase test db` → **232**, unchanged: no migration changed. The one server edit is the
  `pin-verify` Edge Function (returns the bcrypt hash), which pgTAP does not cover; its contract
  is checked live (curl above) and by `scripts/verify-write-path.sh`.

### Manual tests — browser at 375 px against the local stack, 2026-08-21

Input events were dispatched to the same React handlers via `dispatchEvent`; the harness's click
injection timed out again (`visibilityState: 'hidden'`), exactly as the Phase 6a handoff warned.
Everything else — the app, the Edge Function, Postgres — is real.

1. **Build → PWA artifacts.** `sw.js` + `workbox-*.js` + `manifest.webmanifest` generated; precache
   list confirmed to include the hero, fonts, icons, manifest and shell.
2. **Online unlock caches the offline hash.** curl unlock returned `pin_bcrypt_hash`; in the browser,
   after unlocking on `/diagnostics`, Dexie `sync_meta` held `$2b$10$…` and the session was online.
3. **Diagnostics renders** the device panel, outbox and dead-letter sections, unlocked with `2718`.
4. **round_player over real Postgres:** `rpc_upsert_round_player` accepted the client payload,
   recomputed strokes 13→10, returned the stamped row. DB restored with `supabase db reset`.

### Deferred / not verifiable this session

| Item | Why |
|---|---|
| PWA **install** + the update prompt firing on a real deploy | A service worker needs a secure (HTTPS) context; there is no hosted origin yet. Pre-trip manual: install on iPhone, unlock inside the installed app, confirm the update toast waits while the outbox is non-empty |
| Two real phones; a full airplane-mode round | Cannot be automated; carried on the definition-of-done tracker |
| `round_player` flush from an **offline-only** session | By design it waits for an online unlock to mint a token; covered in `roundplayer.test.ts` but not on hardware |

### Deviations from the brief

1. **The offline bcrypt hash is delivered by the Edge Function on unlock, not shipped in the
   bundle.** Stronger than "a stored hash" — it never sits in a public artifact. `decisions.md`
   §"Offline PIN: hash delivered on unlock".
2. **An offline unlock carries no server token**, so token-gated writes (admin RPCs, the
   round_player flush) wait for an online unlock. The brief did not anticipate the two-tier session.
   `decisions.md`.
3. **The editor's tee-save always goes through the outbox** (online and offline), replacing the
   online-only admin variant for that one button; the admin RPC is retained for tests/hard-reset.
   The queued path also preserves `manual_override`, which the admin variant cleared. `decisions.md`.

---

## Phase 7 — Money

Built on branch `phase-7-money` (off `phase-6-offline`; Phases 4–7 remain unmerged). No
migration and no new RPC — the tables (`ctp_results`, `round_money`), `rpc_upsert_ctp` and
`rpc_finalize_round` all shipped in Phases 5–6. Phase 7 is the pure compute layer
(`src/lib/data/money.ts`), the CTP entry UI, and the Money page. Nothing is stubbed.

### Implemented

| Requirement | Verification |
|---|---|
| Money page — per-round pot breakdown, running totals, buy-in reconciliation warning | `src/routes/Money.tsx` via `useMoney()` → `buildMoney()`. Browser at 375 px against local Supabase (buy-in $100 × 4): total purse **$400**, championship $160 / round winners $120 / CTP $120; a card per round with championship share, round winner, CTP pot + per-hole lines |
| Pots derive live from `settings` + par-3 count; nothing derived stored | `buildMoney` reads `purse_mode`/`purse_weights`/`purse_amounts`/`ctp_carry_mode` and each round's par-3 count, calls `computePurse`. `round_money` is **not** hydrated or read by the client (`decisions.md` §"The Money page derives live") |
| CTP entry within Rounds detail — par-3 rows, distance in feet with decimal, no-winner + carry | `src/components/round/CtpEntry.tsx` in `/rounds/:n` (`useRoundCtp`). Browser R3: par 3s 5/7/10/16, winner chips for the three **playing** players (DNP Chris excluded), "No winner", a decimal feet input, per-hole Save |
| CTP write path is real and offline-first | Selected Jon on R3 hole 5, entered 14.5 ft, Saved → `saveCtp` → `enqueueCtp` (same outbox as scores, `kind: 'ctp'`, no PIN) → `rpc_upsert_ctp`. DB row confirmed over REST: `hole_number 5, player_id d0…0001, distance_feet 14.5`. The Money page then showed "Hole 5 · Jon Aronson · 14.5 ft · $10.00" and awarded moved $330 → $340, pending $70 → $60 |
| Greedy settlement with integer-cent arithmetic | `settle()` (Phase 3 engine) wired in `buildMoney`; shown only when every non-abandoned round is `final` and nothing is pending (zero-sum requirement). `money.test.ts` "awards … reconciles to the cent" asserts one transfer P2→P1 $100 on a fully-final round |
| Remainder-cent rules encoded | Championship/round remainder → higher standing (`orderByStanding` + `allocateEvenCents`); CTP remainder → last par 3 (`allocateEvenCentsRemainderLast`, engine). Stated in the Money page footnotes |
| Buy-in vs fixed toggle in admin | Already shipped in `SettingsEditor.tsx` (Phase 5B); `money.test.ts` "fixed mode" asserts `buildMoney` honours explicit pot amounts and skips buy-in reconciliation |
| Round-money snapshotting on `rpc_finalize_round` | Shipped + asserted in Phase 5B (`admin_path.sql`). `money.test.ts` "frozen-figure parity" mirrors that split in TypeScript (additive per-round shares from the same `allocate*` helpers) |
| Buy-in reconciliation to the cent | Browser: Collected $400 = Awarded $340 + Pending $60, "Reconciles to the cent". `money.test.ts` "reconciliation" and "carry returns to contributors" both assert `balanced` with the pot fully distributed |

### Automated tests

`npx vitest run --reporter=dot` → **131 passed** (was 122; **+9** in `src/lib/data/money.test.ts`).
`npx tsc -b --noEmit` clean; `npm run build` clean (precache 22 entries). `supabase test db`
unchanged — **no migration changed** (232 as of Phase 5B).

`money.test.ts` covers: the 40/30/30 pot split summing back to buy-ins; championship + round +
CTP payouts with reconciliation to the cent and a one-payment settlement; **carry returns to
contributors at the last par 3** (all-no-winner round → void $60 refunded evenly); void carry
mode; the **shortened-round fold** (a cut-off par 3's slice folds into the last played par 3, no
cents vanish); **abandoned round redistributes** (its shares go to the remaining rounds);
pending money before finalization (awarded + pending === buy-ins, no settlement yet); fixed mode.

### Manual tests

Browser at 375 px, dark, against local Supabase (Phase-4 seed: R1/R2 final — R2 shortened at
15 — R3 in progress, R4 Bone Valley upcoming; buy-in $100 × 4):

1. `/money`: pot breakdown, per-round cards, per-player ledger, settlement gated ("last round
   still in play"), footnotes. No console errors.
2. **Reconciliation bug caught and fixed live:** the first render warned "payouts don't
   reconcile" — R2's 4th par 3 (hole 17) was past its 15-hole cutoff and its $10 CTP slice was
   dropped. Fixed by folding cut-off slices into the last played par 3; the page then read
   Collected $400 = Awarded $330 + Pending $70 and "Reconciles to the cent." Locked by a test.
3. `/rounds/3`: CTP entry rendered, DNP excluded, a real save landed in the DB and flowed back
   through to the Money page (see the write-path row above).

### Deferred requirements

- **Manual admin buy-in settlement of a DNP player's round** (brief: "Not eligible for a round
  purse unless I manually settle it in admin") — no UI; DNP players are excluded from winning as
  specified, but an admin override to hand a DNP player a round purse is not built. Small, and
  no scenario needs it yet.
- **Live two-phone / real settlement at trip's end** — same pre-trip manual bucket as the rest.

### Deviations from the brief

1. **A cut-off par 3's CTP slice folds into the last played par 3** so a shortened round's pot
   still reconciles. The brief doesn't name this case. `decisions.md` §"A cut-off par 3's CTP
   slice folds into the last played par 3".
2. **Settlement is hidden until every round is final** (zero-sum requirement of greedy
   settle). `decisions.md` §"Settlement is shown only once every round is final".
3. **CTP entry lives inside the round detail, not a separate screen**, and takes no PIN (same
   posture as score entry). `decisions.md` §"CTP entry lives inside the round detail".

### Note

A single demo `ctp_results` row (R3 hole 5) was left in the **local** fake-data DB by the
write-path verification — the service role lacks a direct DELETE grant and a full `db reset`
would disrupt another active session on the same local stack. It is inconsequential (all
scores on that DB are fake) and clears on the next `supabase db reset`.

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
- [~] Round 4 entry is blocked until the Bone Valley card is complete and validated, and unblocks the moment it is — blocking verified end to end (Phase 4 Enter screen, `rpc_upsert_scores` `course_data_is_placeholder`, `rpc_start_round` refusal); the *unblocks* half is proved on a complete card (`verify-admin-path.sh` §7: Red un-publishes on a hole edit and re-publishes on validate). Not yet proved on Bone Valley itself, which has no real card to enter
- [x] Changing a point value in admin instantly recalculates every leaderboard from stored gross scores — Phase 5B manual test 7: "Level" 2 → 3 moved the standings 91/84/83/48 → 113/112/110/64 and changed the order; setting it back restored them exactly
- [x] Changing an index or allowance does not, and requires an explicit re-snapshot — `admin_path.sql`: after `rpc_upsert_player` moves Jon to 20.0, R1's `index_used` is still 9.2; `rpc_resnapshot_round_handicaps` on R3 rewrites that round only, and refuses on a `final` round
- [ ] Handicaps verify by hand (Red, Blue, Black) against a manual calculation
- [ ] Strokes-received hole list matches the printed scorecard's stroke index
- [x] No playing handicap anywhere in the app exceeds 18 — enforced in the engine (Phase 3) and again server-side in `fn_compute_handicap`; pgTAP asserts index 30 → 18
- [~] Two phones open at once: a score on one appears on the other without a refresh — the mechanism is proved (Phase 6a manual test 5: a foreign write reached the open page over a real Realtime socket in ~2 s, no reload). Two actual phones is a pre-trip manual test
- [~] Airplane-mode test: 18 holes × 4 players entered offline, force-quit, cold reopen offline, then reconnect syncs without loss or duplication — done in the browser against a genuinely stopped API (Phase 6a manual tests 2–4: entry offline, cold reopen offline with standings intact and `attempts: 0`, reconnect landing every row with its original stamp and no duplicates). Still owed on a real phone in airplane mode, over a full round
- [x] Admin screens clearly refuse to write while offline; score entry in the same session stays fully functional — admin half in Phase 5B manual test 6 (banner + every control disabled); score-entry half in Phase 6a manual tests 2–4 (holes 15–18 entered and kept with the API stopped)
- [x] Stale offline writes never clobber newer data; losing device rolls back to the winner — `write_path.sql` (SQL guard, real Postgres), `outbox.test.ts` "two devices editing the same hole while both offline" (the loser adopts the winner), and Phase 6a manual test 6 (a 2020-stamped Realtime event refused on the open page)
- [x] A refetch on reconnect never wipes unsynced local entry — `flushOutbox()` runs before `fetchAll()`, and `mergeStampedRows` applies comparator + shield per row; `outbox.test.ts` "a routine refetch never wipes unsynced local entry"
- [x] Every server-side validation rule is enforced against a direct API call — `supabase/tests/write_path.sql` + `scripts/verify-write-path.sh` §8 (Phase 5A)
- [~] Anon cannot write to any table without a valid PIN session — **superseded by the 2026-08-17 amendment.** What holds now, and is demonstrated in `scripts/verify-write-path.sh` §1–§3 and §7: anon can never write to a *table* directly (`42501`), can never mint a session, and can never reach a gated RPC without one — but `rpc_upsert_scores` / `rpc_upsert_ctp` are deliberately open. See `decisions.md` §"PIN removed from score entry"
- [ ] Anon can read every public table and Realtime events actually arrive (demonstrate with `curl` and a socket client)
- [x] Failed PIN attempts on one device never lock out a device that already holds a valid session — `scripts/verify-write-path.sh` §10: unlock 429 while the live session writes 200 (Phase 5A)
- [x] Buy-in mode reconciles to the cent — `money.test.ts` (awarded + pending === buy-ins across the pot split, payouts, carry-to-contributors, void, shortened-fold and pending cases) and the live Money page (Collected $400 = Awarded + Pending, "Reconciles to the cent"). A pre-trip real-settlement run at trip's end is still owed on real phones
- [ ] Lighthouse mobile performance and accessibility both above 90
- [ ] Deployed and reachable at a live Netlify URL
