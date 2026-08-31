# CLAUDE.md — architecture summary and conventions

This file is what a fresh session reads to restore context cheaply. Keep it current. Trust it instead of re-reading source to remember how something works.

## Session discipline (from the brief — non-negotiable)

1. **Build exactly one phase per session, then stop.** End by writing `docs/spec/handoff.md` and nothing else.
2. **Never read the whole repository.** At the start of a session, read only: this file, `docs/spec/acceptance-checklist.md`, `docs/spec/handoff.md`, and the one or two spec documents relevant to the phase you're on. Then open only the files you're actually changing.
3. **Don't re-derive what's already decided.** The architecture summary, data-layering rule, schema shape, and conventions live here.
4. **End every session with `docs/spec/handoff.md`** — 15 lines max.
5. **Don't dump test output into context.** Use `npx vitest run --reporter=dot` and report failures only.
6. **One phase per branch**, merged to `main` when signed off. Netlify deploy previews per branch. (Exception: Phase 0 pushed to `main` directly — the repo was empty and Netlify needed content to import.)

## The trip in one paragraph

Four players (Jon Aronson, Kyle Siegel, Adam Hersh, Chris Denove) play four rounds at Streamsong Resort, one per day Feb 4–7 2027: Red (Thu), Blue (Fri), Black (Sat), Bone Valley (Sun). Net Stableford scoring, cumulative across all counting rounds. Money split three ways — championship, round winners, closest to pin — with the CTP pot per-round proportional to that round's par-3 count (Black has 5 par 3s; Red/Blue have 4; Bone Valley TBD). App is used one-handed in a cart in Florida sun, and must work fully offline.

## Architecture in one paragraph

Vite + React + TypeScript + Tailwind SPA, deployed to Netlify from `main`. Backend is Supabase (Postgres + Realtime + RLS + Edge Functions + Storage). Local store is Dexie (with `dexie-react-hooks`). Network layer is TanStack Query. Scoring is a pure TS module in `src/lib/scoring/` — no React, no network imports — so it works identically offline. The service worker is `vite-plugin-pwa` with Workbox, `registerType: 'prompt'` (never `skipWaiting` + `clientsClaim`).

## Data-layering rule (memorize this)

> **TanStack Query owns network fetch and writes results into Dexie. Components read only from Dexie via `useLiveQuery`, never from TanStack's cache directly. Scoring and CTP mutations go through the outbox and nothing else.**

Corollary: if a component would need to `useQuery` to render, that's a bug. Query in a hook, hydrate Dexie, render from Dexie.

## Offline capability boundary

- **Offline-capable, through the outbox:** score entry, picked-up flags, CTP results, day-of `round_players` tee/handicap changes.
- **Online-only, direct RPC:** everything else in `/admin` — players, indexes, tees, scorecards, settings, rounds, itinerary, lodging, purse config, round finalization. Admin screens detect offline and say so plainly.

## Schema shape (canonical detail in `docs/spec/schema.md`)

Core tables: `players`, `courses`, `tees`, `holes`, `hole_yardages`, `rounds`, `round_players`, `scores`, `ctp_results`, `round_money`, `itinerary_items`, `lodging`, `lodging_assignments`, `sessions`, `pin_attempts`, `settings`.

Rules that are easy to forget:
- **Stroke index is stored once per course**, not per tee (`holes.stroke_index`). Decided; not open for relitigation.
- **Store gross scores only; derive everything else.** No points, net, or derived money in tables. Exception: `round_money` snapshots dollar figures at round finalization.
- **`scores` unique key:** `(round_id, player_id, hole_number)`. Whole-tuple replacement — the RPC replaces both `gross_strokes` and `picked_up` together, or neither. **No `COALESCE`-style partial merges.**
- **`ctp_results` unique key:** `(round_id, hole_number)`. `player_id` nullable (no winner yet, or carry).
- **`round_players` unique key:** `(round_id, player_id)`. Editable mid-round; changing the tee recomputes course/playing handicap, cap, and stroke allocation, then re-derives all points from stored gross scores.
- **Bone Valley placeholder columns:** `courses.data_is_placeholder`, `holes.par`/`stroke_index` nullable, `tees.rating`/`slope` nullable, `hole_yardages.yardage` nullable. Only `rpc_validate_and_publish_course` may flip the flag.
- **Realtime is enabled on** `scores`, `ctp_results`, `rounds`, `settings`, `players`, `round_players`. Others are not published because nothing derived from them needs to reach four phones live.
- **Two client timestamps on `scores` and `ctp_results`:** `client_updated_at_raw` (as sent) and `client_updated_at_effective` (`least(raw, now() + interval '5 min')`, computed server-side). **The comparator uses `_effective`.** `_raw` exists for diagnostics.

## The four comparator sites (memorize)

Row-level last-write-wins ordered by tuple `(client_updated_at_effective, client_id)`. Written **once** in `src/lib/sync/comparator.ts`. Applied identically in all four places — this is where every subtle sync bug hides:

1. **The SQL guard** inside the upsert RPC. Only overwrite when the incoming tuple wins. Returns `{ applied: bool, row }` so the client can tell "rejected as stale" from "error."
2. **The Realtime handler.** A remote event may only overwrite a local row when it wins the comparator. Never a blind `put`.
3. **Hydration and refetch.** On reconnect, **flush the outbox before refetching**. Route the refetch's results through the comparator so a routine refetch never wipes unsynced local entry.
4. **The pending-write shield.** Index outbox entries by `(round_id, player_id, hole_number)`; a remote event never overwrites a row that has a pending outbox entry unless it wins the comparator outright.

The self-echo rule: your own Realtime echo clears the "unsynced" marker **only when the echoed `client_updated_at_effective` >= the newest pending timestamp for that key**. Compare timestamps, not just `client_id`.

## Auth model in one paragraph

**Amended 2026-08-17 (Kyle): score entry has NO PIN.** `rpc_upsert_scores` and
`rpc_upsert_ctp` take no session token and are open to `anon`; the Enter screen has an
explicit per-hole **Save** button instead of a lock. `rpc_upsert_round_player` (it rewrites
handicaps) and every admin RPC still require a session. The line is the brief's own
offline/online split. See `docs/spec/decisions.md` §"PIN removed from score entry"; the
brief carries a marked amendment. Everything below describes the PIN as it now applies to
`/admin`.

Reads are public. Admin writes require a 4-digit PIN session (Kyle's call, 2026-08-18 — the brief said 6; `decisions.md` §"PIN length is 4, not 6"). `PIN_LENGTH` in `PinGate.tsx` is the one client constant; the Edge Function checks a `\d{4,8}` range and lets the stored hash decide. PIN verification happens in an **Edge Function** (real client IP for throttling), not an RPC. On success, the client receives a 128-bit opaque session token; the server stores only its hash. All writes go through `SECURITY DEFINER` RPCs that validate the token against `sessions`. Every `SECURITY DEFINER` function pins `SET search_path = ''` and fully schema-qualifies references. `CREATE FUNCTION`'s implicit `EXECUTE TO PUBLIC` is revoked, then re-granted to `anon` only on intended RPCs. Do **not** call `supabase.realtime.setAuth(token)` — the token is opaque, not a JWT; the Realtime connection stays on the anon key. Local offline PIN verification uses a stored bcrypt hash — accepted tradeoff for a four-person golf trip.

## Scoring in one paragraph

Net Stableford. Points table stored in `settings` (retroactive). **Handicap index is read LIVE from the player** (Kyle 2026-08-22 — "simplify players and rounds"): `buildRoundDetail` pass 1 uses `players.handicap_index`, not `round_players.index_used`, so editing an index on the Players tab moves every non-finalized round's points at once. `round_players` still snapshots `index_used`/`allowance_used`/`cap_used` for the server's own strokes calc and as a fallback, but the client no longer scores off it. No re-snapshot step; the per-round index field, allowance/cap knobs, manual override and status picker were removed from the Rounds editor — it is now just a tee dropdown per player. Finalized-round *money* stays frozen (`round_money`). Course Handicap = `Index × (Slope / 113) + (Course Rating − Par)`, carried unrounded; Playing Handicap = round(Course Handicap × allowance%); Final Strokes = min(Playing Handicap, cap). Cap default 18 — applied last, after allowance and after rounding. Rounding is half-away-from-zero (not JS's `Math.round`). **Play off the low handicap (Kyle 2026-08-22, amends the brief):** after each player's own strokes are computed, the round field's *lowest* playing handicap is subtracted from everyone — the low player is scratch, the rest get only the difference (`max(0, own − fieldLow)`), computed per round over playing players only. Applied once in `buildRoundDetail`; `buildChampionships` reads its points from there. See `decisions.md §"Play off the low handicap"`. Stroke allocation is then by course-level stroke index, wrapping above 18 (guarded to terminate). DNP players score 0, don't set the low, and are excluded from that round's holes-won and shortened-round cutoff computation.

## Conventions

- **Language in the UI is plain.** No "Shareholder Standings" or "Accounts Payable." Standings, Rounds, Scorecard, Players, Money, Rules, Itinerary. Visual treatment carries the annual-report idea; copy does not wink at it.
- **Light mode only ("Fairway Linen").** Cream ground, ink text, deep-brass accents; single theme, high contrast for direct sun (Kyle 2026-08-24, reverses the brief's dark-only — see `decisions.md §"Fairway Linen"`). Tabular numerals wherever numbers appear. Tokens live in `src/index.css`; on a light ground the accent must read as text, so `--gold`/`--gold-bright` are both deep brasses (≥4.5:1 on cream) and emphasis comes from weight, not a brighter hue.
- **Minimum 44px tap targets.** No hover-dependent interactions. `font-size: 16px` on inputs to prevent iOS zoom-on-focus.
- **Viewport:** standard `width=device-width, initial-scale=1`. No `user-scalable=no`.
- **Timezones:** always render tee times and itinerary in `America/New_York`. Never device locale.
- **Migrations:** idempotent, hard-coded stable UUIDs in seed files (`INSERT ... ON CONFLICT DO NOTHING`). Never a fresh `gen_random_uuid()` at seed time — cached rows on phones would orphan.
- **Tests:** `npx vitest run --reporter=dot` for anything invoked in a session. Never watch mode.

## Files worth knowing about

- `docs/spec/brief.md` — verbatim brief. Source of truth. Changes go here first.
- `docs/spec/decisions.md` — every decision made outside the brief, with rationale.
- `docs/spec/phase-plan.md` — the nine phases, one section each.
- `docs/spec/schema.md` — full schema, RLS policies, RPC signatures.
- `docs/spec/acceptance-checklist.md` — per-phase evidence, updated at end of every phase.
- `docs/spec/handoff.md` — 15-line session-end note. Overwritten every session.

## Read path (Phase 4) — the shape to reuse

The read pipeline is live and enforces the data-layering rule: `src/lib/supabase.ts` (anon
client, env vars) → `src/lib/data/hydrate.ts` (`useHydrate` — TanStack Query fetches every
public table, `bulkPut` into Dexie) → `src/lib/db.ts` (Dexie read mirror) → pure assembly in
`src/lib/data/compute.ts` (rows in, view models out, all scoring via `@/lib/scoring`) →
`src/lib/data/selectors.ts` (`useLiveQuery` hooks) → screens. **Screens import only from
`selectors.ts`** — never Dexie, Supabase, or the scoring engine directly. `QueryProvider`
wraps the router in `main.tsx`; `HydrationGate` runs the hydrate in the shell. Fake demo
scores: `scripts/gen-phase4-seed.ts` → `supabase/migrations/*_seed_phase4_fake_scores.sql`.
Env: copy `.env.example` → `.env.local` (local anon key from `supabase start`).

## Write path (Phase 5A) — the shape to reuse

`src/components/PinGate.tsx` → `src/lib/auth/session.ts` (unlock via the `pin-verify` Edge
Function, token in the Dexie `session` table, expiry Feb 8 2027) → `src/lib/data/mutations.ts`
(500 ms debounce keyed by `(round, player, hole)`, batch RPC, **server's returned rows written
back into Dexie** so the screen re-renders through the same `useLiveQuery`). Optimistic edits
are `EnterDraft`s overlaid **inside `compute.ts`**, never patched over rendered numbers, so
points/thru/standing still derive through the scoring engine. Screens still import only from
`selectors.ts`.

Things that will bite if forgotten:
- **Dexie's `scores` table is keyed by `[round_id+player_id+hole_number]`**, not the server
  `id` — mirroring the Postgres unique key. Keyed by `id`, a regenerated id left two rows for
  one cell and the wrong one won.
- **`rpc_create_session` and the two PIN-throttle functions are granted to `service_role`
  only.** Only the Edge Function may call them. Everything else client-callable is `anon`.
- In SQL, `COALESCE`/`LEAST`/`GREATEST`/`EXTRACT` are constructs, not schema-qualifiable
  functions — they stay bare under `SET search_path = ''`.
- Per-cell parsing lives **inside** the per-cell exception block, or one malformed uuid
  aborts the whole batch.
- The Phase 4 seed's client timestamps are January 2026 on purpose: dated on the trip they
  would out-rank every real entry made before February 2027 and it would be rejected as stale.
- Phase 5 is **online only**. No outbox, no local PIN hash, no Realtime — all Phase 6.
- **Nothing auto-saves.** Edits live in per-hole drafts (`DraftsByHole` in `Enter.tsx`) that
  survive paging between holes, and reach the server only on Save. On a failed save the
  drafts stay put, so a bad connection costs a second tap, never a hole.
- **A hole can't be saved until every *playing* player has a score on it** (Kyle,
  2026-08-21 feedback). Save is gated on `allEntered` in `Enter.tsx` — computed from
  `vm.players` (drafts already overlaid), a gross or a pick-up counts, DNP players are
  excluded, so the required count is `playing.length` (3 when someone sat out), not a
  hardcoded 4. Editing one cell of an already-complete hole still saves.
- **Phase 5 was split**: 5A is auth + write path + Enter; 5B is the admin RPCs and editors.

## Admin path (Phase 5B) — the shape to reuse

`/admin` is `src/routes/Admin.tsx`: `PinGate` when locked, a plain online-only banner when
offline (`useOnlineStatus`), then four tabs — Rounds / Players / Courses / Settings — in
`src/components/admin/`, plus an Export panel. Reads come from `useAdmin()` in
`selectors.ts` → `buildAdmin()` in `compute.ts`, same rule as every other screen. Writes go
through `src/lib/data/admin.ts`, which attaches the session token, maps failures into three
genuinely different kinds (`locked` / `offline` / `refused`), and then **invalidates the
`['hydrate']` query** rather than patching Dexie by hand — several tables move at once, so
the one existing network→Dexie path refills them. `queryClient` lives in its own module
(`src/lib/data/queryClient.ts`) so the non-React write path can reach it.

RPCs are `supabase/migrations/20260819090000_admin_rpcs.sql`; every one is session-gated,
asserted individually in `supabase/tests/admin_path.sql` and demonstrated over PostgREST by
`scripts/verify-admin-path.sh` (which mutates the DB — `supabase db reset` afterwards).

Things that will bite if forgotten:
- **`data_is_placeholder = false` means "validated," not "nobody objected."** New courses
  are created placeholder; **editing any hole sets the flag back to true** and stops scoring
  until Validate & publish is re-run. Only `rpc_validate_and_publish_course` clears it.
- **Publishing also requires a rating and slope on every tee** — not one of the brief's four
  checks, but `fn_compute_handicap` falls back to slope 113 on null and every allocation
  would be quietly wrong. `courseCardIssues()` mirrors it client-side.
- **`fn_allocate_even_cents` / `fn_allocate_proportional_cents` mirror `money.ts`
  line-for-line**, remainder placement included. Change one, change both, and assert the
  same case in both languages.
- **`round_money.championship_share_cents` is this round's share of the championship pot**,
  not the whole pot — the four rows are additive.
- **Admin `round_players` writes stamp the comparator columns** with sentinel client_id
  `ffffffff-…-ffffffffffff`. Null would make a deliberate admin write lose to a stale cart write.
- `rpc_upsert_settings` is a **whitelist** with a per-key shape check. Use
  `jsonb_typeof(x) IS DISTINCT FROM 'number'` — a plain `<>` lets a MISSING key through.
- PostgREST answers `28000` with **403**, not 401 (`42501` is the 401).
- Phase 5B is still online-only. No outbox, no Realtime — Phase 6.
- Itinerary / lodging RPCs exist but their editors are Phase 8; the purse figures feed
  Phase 7's Money page.

## Offline path (Phase 6a) — the shape to reuse

`src/lib/sync/` holds the whole sync engine and nothing else imports its internals:

- `comparator.ts` — **the** tuple ordering, and the only place it is written. Parses
  timestamps to (epoch seconds, **microseconds**) because Postgres orders on microseconds
  and `Date.parse` truncates to milliseconds; compares `client_id` lowercased, which equals
  Postgres's uuid byte order.
- `clock.ts` — `nextStamp()` = `max(Date.now(), lastIssued + 1)`, persisted in Dexie's
  `sync_meta`. Never use `Date.now()` for a write stamp.
- `outbox.ts` — enqueue (local row + queue entry in **one** transaction), coalesce
  latest-per-key, batch by kind (36 cells/call, 4 calls in flight), settle, dead-letter,
  `clearEchoed()`. `setTransport()` is the test seam.
- `merge.ts` — comparator site 3, called by `hydrate.ts` after it flushes.
- `realtime.ts` — comparator site 2. `applyScoreEvent` / `applyCtpEvent` are exported so
  the tests can drive them without a socket.
- `reachability.ts` — HEAD probe, 3 s timeout; two consecutive flush failures trip Offline.
- `engine.ts` — the flush triggers and `useSyncSnapshot()`. Started once, from `Layout`.

Things that will bite if forgotten:
- **A failed-to-reach flush costs no attempts.** `OfflineError` stops the pass and
  penalises nothing; only `TransportError` and server refusals count. Otherwise a long
  dead zone dead-letters a whole round no server ever refused.
- **`'stale'` is success, not failure.** The server's winner comes back in the same
  response; the loser adopts it and the entry leaves the queue.
- **Terminal refusals dead-letter on the first answer**, retryables after 8 attempts.
  Nothing is ever deleted — `dead_letter` keeps payload, stamps, attempts and last error.
- **An acknowledged row overwrites our optimistic row unconditionally** (same `client_id`
  + same `raw`) — that is where the server's 5-minute clamp is adopted. Anything else goes
  through the comparator.
- **Dexie v5** adds `ctp_results` (keyed `[round_id+hole_number]`), `outbox` (`++seq`),
  `dead_letter`, `sync_meta`. The hydrate `bulkPut`s only the uncontended tables; `scores`
  and `ctp_results` go through `mergeStampedRows`.
- **Save now always succeeds.** `saveCells()` returns false only if Dexie itself refused.
  Enter clears its drafts on a queue, not on a server round-trip.
- Tests: `npm run test:sync` (`fake-indexeddb`, a `FakeServer` in `src/test/`). The
  SQL guard's own correctness is pgTAP's job — `comparator.test.ts` re-runs
  `write_path.sql`'s exact verdict cases in TypeScript so the two languages are visibly
  the same cases.
- Phase 6a is **not** the whole of Phase 6: no service worker, no PWA install, no offline
  PIN, no Diagnostics screen, no CSV export. Those are 6b.

## Offline path (Phase 6b) — the shape to reuse

The rest of Phase 6: the PWA, the offline PIN, the day-of tee change, Diagnostics, CSV.

- **Service worker:** `vite-plugin-pwa` v1 in `vite.config.ts`, `registerType: 'prompt'`,
  `injectRegister: false`. Registration + the update prompt are React (`useRegisterSW` in
  `src/components/PwaUpdatePrompt.tsx`, mounted in `Layout`); the prompt renders `null` while
  `useSyncSnapshot().pending > 0`, so a reload never interrupts a flush. `globPatterns` and
  `maximumFileSizeToCacheInBytes` (4 MiB) are explicit; the build precaches the shell, JS/CSS,
  both fonts, the icons and the responsive hero (AVIF/WebP at 640/1080/1600 + the JPG fallback,
  ~1.6 MiB total — `glob` includes `avif,webp`). The hero is a `<picture>` in `Home.tsx`, not a
  CSS background; regenerate variants after replacing `public/assets/hero.jpg` with
  `npm i --no-save sharp && node scripts/gen-hero-images.mjs`. **`sharp` is deliberately NOT a
  dependency** — it broke Netlify's `npm ci` (install-deps stage); the variants are committed so
  the build never needs it. Icons live in `public/` (`icon.svg` +
  `sips`-rasterised PNGs); `index.html` carries the apple-touch/favicon links, the manifest link
  is injected. **Install/update needs a real HTTPS origin — pre-trip manual check.**
- **`navigator.storage.persist()`** — `src/lib/storage.ts` `requestPersistentStorage()`, called
  after any unlock and once on cold-start if a session exists (`ensurePersistedIfUnlocked` in
  `Layout`). Best-effort, guarded, never throws.
- **Offline PIN** — `pin-verify` returns `pin_bcrypt_hash` (bcrypt cost 10, env
  `APP_PIN_BCRYPT_HASH`) on a successful unlock; `session.ts` caches it in `sync_meta` and
  `unlockOffline()` verifies against it with `bcryptjs`. An offline session has `offline: true`
  and an **empty token**, so `readToken()` returns null and token-gated writes wait for an online
  unlock. `PinGate` falls back to the local check only on `UnlockError.networkFailed`. The cached
  hash survives `lock()`.
- **`round_player` = the third outbox kind.** `enqueueRoundPlayer` computes the optimistic row
  with `computeHandicap` (so strokes are right offline), key `rp|round|player`. The Rounds
  editor's "Save tees & handicaps" always queues (`saveRoundPlayersQueued`), enabled offline;
  the flush attaches `readToken()` and **defers** (no attempt, no error) when there is none.
  `round_player` now flows through all four comparator sites — merge (`merge.ts`), a dedicated
  `applyRoundPlayerEvent` (`realtime.ts`), and the shield/write-back (`outbox.ts`); it is no
  longer in the hydrate `bulkPut` or the realtime invalidate loop.
- **Diagnostics** — `/diagnostics` (`src/routes/Diagnostics.tsx`, linked from `/admin`).
  PIN-gated, **not** connection-gated. Shows client_id, session, reachability, last sync, the
  outbox and dead-letter (Retry / Export-JSON per item, "Copy state as JSON" — token redacted).
- **CSV export** — `src/lib/data/csv.ts` `scoresToCsv()`, wired into the admin Export panel
  beside JSON; both copy to clipboard.

Things that will bite if forgotten:
- **An offline unlock cannot mint a server token.** A tee change queued on an offline-only
  session is kept and syncs after the next *online* unlock — do not expect it to flush offline.
- **`mergeStampedRows` now takes `round_players`** (optional). `hydrate.ts` no longer bulkPuts
  that table; a routine refetch must not overwrite an unsynced tee change.
- **The editor uses `saveRoundPlayersQueued`, not `saveRoundPlayers`.** The latter (online admin
  RPC, sentinel client_id) is retained for `admin_path.sql` and as a hard reset, but is unused by
  the UI; the queued path preserves `manual_override`, the admin one cleared it.
- Tests: `npm run test:sync` now 46 (adds `roundplayer.test.ts`); plus `session.test.ts` and
  `csv.test.ts`. Full `vitest run` → 122. `supabase test db` unchanged (no migration changed —
  only the Edge Function, which pgTAP doesn't cover; its contract is checked by
  `verify-write-path.sh` and a live curl).

## Money path (Phase 7) — the shape to reuse

The money ledger, assembled the same way every other screen is: Dexie rows → pure compute →
`useLiveQuery`.

**Model revised 2026-08-23 (Kyle — the trip's real money sheet), see `decisions.md §"Money
model: buy-in funds 1st/2nd + round winners, no CTP money"`:** a buy-in per man funds three
payouts — **1st overall, 2nd overall, and a per-round winner**. There is **no closest-to-pin
money** (CTP is still entered on the round screen for bragging rights, it just pays $0). The old
40/30/30 championship/round/CTP weighted split is gone.

- **`src/lib/data/money.ts` `buildMoney(dbData) → MoneyVM`** is the whole ledger, pure and
  offline-identical. It reads `settings.purse_amounts` = `{ buy_in_per_player_cents,
  champ_first_cents, champ_second_cents, round_winner_cents }`, resolves 1st/2nd off
  `buildStandings` and each round's winner off `resolveRoundWinner`, and awards. Everything is
  **integer cents**; round only at display (`formatMoney`/`formatMoneySigned`). `computePurse`
  and the weighted `PurseConfig` in `@/lib/scoring` are now **unused by the app** (kept, still
  unit-tested); `buildMoney` uses `allocateEvenCents`/`settle`/`compareCountback` directly.
- **Ties pool the tied positions' purses and split evenly** (`resolveChampionPlaces`): two tied
  for 1st split (1st+2nd); a tie for 2nd splits 2nd; the remainder cent → higher standing
  (`orderByStanding`). Round-winner ties split via the round countback then even split.
- **Reconciliation is now a real check, not just a status.** `balanced` = `awarded + pending ===
  buy-in × players`; because the awards are fixed amounts (not fractions of the pot), a
  misconfigured amount or an abandoned round genuinely won't reconcile and the page flags it.
  Settlement runs only when settleable **and** balanced **and** nothing pending.
- **Derive live; never read `round_money` on the client.** `rpc_finalize_round` still freezes a
  mirror, but under the new model it freezes **`round_purse_cents = round_winner_cents`** and
  **0** for championship_share and ctp (championship is trip-level; CTP pays nothing). The table
  shape is unchanged. Migration: `20260823120000_money_model_revision.sql`.
- **CTP entry now lives in the Enter flow (`src/routes/Enter.tsx`), not on `/rounds/:n`**
  (2026-08-30, `recap-mockup` branch — Kyle, "score it with everything else"). On a par-3
  hole an inline "Closest to pin" picker appears below the player rows; the *same* hole Save
  records scores and the CTP winner together (`saveCtp` folded into `saveHole`, dirty state
  is `holeIsDirty || ctpIsDirty`). `EnterHoleVM` gained `ctpEligible` (par 3 within
  `holesCounted`) and `ctpWinnerId`. Still records through the outbox; still $0. The
  standalone `CtpEntry.tsx` component and the `useRoundCtp` selector are **deleted** —
  `/rounds/:n` only *reports* CTP now, via the RoundRecap's "Closest to Pin" fact.
- **Money page: `src/routes/Money.tsx`** — total purse + 1st/2nd/round-winner breakdown, buy-in
  reconciliation, per-round winner cards (no CTP section), per-player ledger, settlement.
- **Settings: `SettingsEditor.tsx` "Money" card** — four dollar fields (buy-in, round winner,
  1st, 2nd), defaulting to $250/$50/$600/$200. `purse_mode`/`purse_weights`/`ctp_carry_mode` are
  legacy settings the money model no longer reads (still valid in `rpc_upsert_settings`).

Things that will bite if forgotten:
- **Standings ties share a position** (competition ranking), which is exactly what the
  pooled-position payout relies on — three tied for 1st still share only the two paid places.
- **On the hosted DB, `purse_amounts` may still hold the old shape** (`buy_in_per_player_cents` +
  `fixed_cents`) until the migration is pushed *or* someone hits Save on the Money settings card.
  `buildMoney` reads the new fields (fallback 0), so until then the Money page will reconcile
  against a stale buy-in — set it in Settings.
- Tests: `money.test.ts` (6) covers payouts+reconciliation, tie pooling, pending, abandoned, the
  reconciliation tripwire, and empty config. Full `vitest run` → **130**. `supabase test db` →
  **232** (finalize freeze + admin_path asserts updated; `plan(106)` unchanged).

## Info + admin editors (Phase 8) — the shape to reuse

The four Info sub-pages and their admin editors, assembled the same way everything else is:
Dexie rows → pure compute → `useLiveQuery`. Three new tables joined the read model.

- **Dexie v6** adds `itinerary_items`, `lodging`, `lodging_assignments` — **plain reference
  tables**: online-only admin writes (the offline boundary keeps itinerary/lodging online), so
  no comparator columns, no outbox, no merge. `hydrate.ts` fetches and `bulkPut`s them like the
  other uncontended tables; `useDbData` reads them. `Db`'s three new fields are **optional** so
  the scoring-only test fixtures still satisfy the type — build functions read `?? []`.
- **Compute** (`compute.ts`): `buildItinerary(db, todayET?)` (grouped by day, current-day flag,
  `todayET` injectable for tests), `buildLodging`, `buildCoursesIndex`, `buildCourseDetail`,
  `buildPlayerCourseHandicaps` (playing handicap per round, **live from the current index**, not
  a snapshot). `buildAdmin` gained `itinerary` (raw rows) + `lodging` (rows + assignments).
- **Selectors**: `useItinerary`, `useLodging`, `useCoursesIndex`, `useCourseDetail`;
  `PlayerCardVM` gained `courseHandicaps`.
- **Public pages** (`src/routes/info/`): `Itinerary.tsx` (timeline), `Courses.tsx` (index) +
  `CourseDetail.tsx` (`/info/courses/:courseId` scorecard), `Players.tsx` (per-course handicap
  strip added), `Rules.tsx` (money section rewritten to the buy-in model, reads live amounts).
- **Admin editors** (`src/components/admin/`): `ItineraryEditor.tsx`, `LodgingEditor.tsx`, and a
  tee-time field added to `RoundsEditor.tsx`. Writes in `admin.ts`: `saveItinerary` (batch),
  `saveLodging`, `saveLodgingAssignment`, `saveRound` (tee time) — all through the existing
  session-gated `call()` + `['hydrate']` invalidate. Two new admin tabs.
- **Time helpers** (`format.ts`): `formatDayLong`, `etDateString`, `etTimeInputValue`,
  `composeEtTimestamp` — all pinned to `America/New_York` / −05:00 (the trip is entirely EST).

Things that will bite if forgotten:
- **No delete path this phase** (Kyle, 2026-08-24 — small fixed data set). Editors are add/edit
  only; the RPCs never had a delete. See `decisions.md §"No delete for the Info editors"`.
- **New-row pattern**: existing rows render from props (keyed by id, own edit state); an added
  row is a local draft that **removes itself on save success** (`useAdminAction` gained an
  optional `onSuccess`) so the server row re-appears via hydrate without a duplicate. A new
  lodging must be saved before its rooms — the assignment RPC needs `lodging_id`.
- **The three RPCs already existed + gated** in `20260819090000_admin_rpcs.sql`; Phase 8 added
  only the client bindings. **No migration changed** — `supabase test db` still 232.
- Course handicap on the Players page is the player's **own** handicap (post cap/override), NOT
  the play-off-the-low relative figure the scorecard uses.
- Tests: `info.test.ts` (10). Full `vitest run` → **140**. `tsc -b` + `npm run build` clean.

## Design refinement pass (2026-08-28) — the shape to reuse

Not a numbered phase — a tuning pass over the existing "Fairway Linen" language from an external
design brief, on branch `design-refinements` off `main`. No new tables, no logic changes.

- **Fraunces is now the `full` Fontsource build, not `wght`-only** (`src/assets/fonts/
  fraunces-latin-full-normal.woff2`, 121 KB, was 36.6 KB). The `wght`-only subset silently drops
  the `opsz`/`SOFT` axes instead of erroring — needed for the `.fx-*` classes below. Combined font
  payload is ~169 KB, over the Phase 1 checklist's ≤80 KB target; accepted, see `decisions.md
  §"Design refinement pass"`. Refresh procedure is in the `fonts.css` header comment.
- **`.fx-display` / `.fx-head` / `.fx-title` / `.fx-serif-sm`** (`index.css`, `@layer components`)
  set `opsz`/`SOFT`/`wght` tiers by rendered size — display masthead/countdown down to small serif
  labels. Applied on the home masthead, countdown digits, `PageHeader` (all page titles), round
  headlines, and the leaderboard/standings/money point figures.
- **`.leader-row`** (+ `--leader-tint` token) is the one leader/winner treatment — gold spine +
  tint background — reused verbatim on Standings' top row, the round-detail `Leaderboard`'s rank-1
  row, Money's "1st place overall" line, and Enter's "Round so far" top player. Gold is reserved
  for this; it no longer colors every row's position number unconditionally (that was the bug the
  brief called out).
- **`courseSlug(name)`** (`src/lib/format.ts`) maps a course name to `red`/`black`/`blue`/`bone`
  for the `.round[data-course]` accent system (`--red`/`--blue`/`--olive`/`--paper`). Wired into
  the Rounds list (rail), Home's round card list (swatch dot), RoundDetail's header (swatch dot).
  **The rail is `box-shadow: inset 3px 0 0 var(--course))`, not `border-left`** — a `border-left`
  version silently loses to any `border-{color}` Tailwind utility (e.g. `border-hair`) on the same
  element, because Tailwind's utilities layer outranks `@layer components` regardless of
  specificity, and `border-hair` sets all four sides via the `border-color` shorthand. Every
  element needing the rail also carries a hairline border utility, so this isn't a corner case —
  don't "simplify" it back.
- `--paper-dim`/`--paper-faint` darkened ~12% (`#4b453c`/`#4f4a41`) for direct-sun legibility —
  headroom above AA, not a contrast fix.
- **`HeroPhoto` (`Home.tsx`) recovers from a failed hero fetch.** `<picture>`/`<source>` only
  negotiate by format support — if the chosen source's *fetch* fails (dropped connection, a
  reload racing the load) there's no automatic fallback to the next source or the `<img>`'s own
  `src`. On the `<img>`'s `onError`, drop every `<source>`; the browser redoes selection and falls
  through to the guaranteed JPG. Found via a real (client-side, not deploy) failure during this
  pass's own browser verification.
- Tests: unchanged, **148** (no logic touched). `tsc -b` + `npm run build` clean.
