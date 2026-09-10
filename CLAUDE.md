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

Four players (Jon Aronson, Kyle Siegel, Adam Hersh, Chris Denove) play four rounds at Streamsong Resort, one per day Feb 4–7 2027: Red (Thu), Blue (Fri), Black (Sat), Bone Valley (Sun). Net Stableford scoring, cumulative across all counting rounds. Money split three ways — championship, round winners, closest to pin — with the CTP pot per-round proportional to that round's par-3 count (the printed cards give every course four par 3s — Red, Blue, Black and Bone Valley alike). App is used one-handed in a cart in Florida sun, and must work fully offline.

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
- **Bone Valley placeholder columns:** `courses.data_is_placeholder`, `holes.par`/`stroke_index` nullable, `tees.rating`/`slope` nullable, `hole_yardages.yardage` nullable. Only `rpc_validate_and_publish_course` may flip the flag from the app. **Bone Valley's real card is seeded and published since 2026-09-09** (`20260909120000_seed_bone_valley_card.sql`); the placeholder machinery stays for any new course and is exercised in tests by re-opening Bone Valley inside the transaction.
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
- **Drafts are persisted in Dexie (v7 `enter_drafts`, keyed `[round_id+hole_number]`)**
  (2026-09-05). iOS evicts backgrounded PWAs freely and Save is gated on the whole group, so
  React-state-only drafts were the likeliest thing on the phone to vanish. `Enter.tsx` still
  owns the value in refs (two taps in one frame) and writes through via
  `src/lib/data/drafts.ts` after every tap; a row is deleted when the hole has nothing unsaved
  left, which is what Save does. Drafts are per round and reload when the round changes —
  the picker no longer wipes them. Scores and the CTP pick share one row (`ctp_touched`
  distinguishes an explicit "no winner" from untouched).
- **Enter opens on the group's current hole**, not hole 1: `EnterVM.firstOpenHole` is the
  first hole on which some *playing* player has no stored cell (18 once complete, 1 with no
  round_players). Computed from stored rows only, never drafts. `hole` state is `null` until
  resolved, and the resolving effect is gated on the VM belonging to the selected round —
  before the round default settles, `useEnterHole` builds round 1 as a placeholder, and a
  finished round 1 would otherwise hand the live round its 18th hole. **A successful Save
  advances to the next hole** (Kyle, 2026-09-05); `justSaved` stays on the hole left so paging
  back reads "Saved". Hole 18 stays put. Tests: `enter.test.ts`,
  `drafts.test.ts`. Full `vitest run` → **161**.
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
- **Recap Share sends an image, not text** (Kyle 2026-09-05), **during the round as well as
  after it** (Kyle 2026-09-06 — the button is no longer gated on `!vm.live`). `src/lib/share/recapImage.ts`
  rasterises the `.recap-card` section with `modern-screenshot` (DOM → SVG foreignObject →
  canvas; self-hosted fonts get embedded) at 2× and shares it as a PNG `File` via
  `navigator.share({ files })`. The footer carries `data-share-exclude` so the buttons stay
  out of the picture. **The PNG is pre-rendered in an effect** after `document.fonts.ready`:
  iOS only honours `navigator.share` inside a user gesture, and rasterising on the tap could
  outlast it. **On a live card the pre-render is debounced 1.2 s** — the VM re-derives on every
  saved hole. Live files are named `…-thru{N}.png` and titled "Course — thru N" so mid-round
  shares don't collide in Photos. A card with `offsetWidth < 200` is refused (a hidden tab
  rasterises to a 2px ribbon) — in the desktop preview that guard fires whenever the pane is
  hidden/narrow and the tap silently does nothing; use the mobile preset when testing. Text
  summary is only the fallback where `canShare({ files })` is false. The share sheet itself
  can't be exercised in the desktop preview (`navigator.share` undefined); verified on Kyle's
  iPhone 2026-09-05 (Messages, first tap).
- **Money page: `src/routes/Money.tsx`** — total purse + 1st/2nd/round-winner breakdown, buy-in
  reconciliation, per-round winner cards (no CTP section), per-player ledger, settlement.
- **Settings: `SettingsEditor.tsx` "Money" card** — four dollar fields (buy-in, round winner,
  1st, 2nd), defaulting to $250/$50/$600/$200. `purse_mode`/`purse_weights`/`ctp_carry_mode` are
  legacy settings the money model no longer reads (still valid in `rpc_upsert_settings`).

Things that will bite if forgotten:
- **Standings ties share a position** (competition ranking), which is exactly what the
  pooled-position payout relies on — three tied for 1st still share only the two paid places.
- **`purse_amounts` needs no manual fixing** (verified on the hosted DB 2026-09-07). The seed in
  `20260812100400_seed_core.sql` already carries the new shape, and
  `20260823120000_money_model_revision.sql` ends with an `update ... where value ? 'fixed_cents'`
  that rewrites an old-shape row in place — a no-op on a row that is already new-shape, which is
  why the hosted row keeps its original `updated_at`. An **earlier version of this note claimed
  the hosted DB might still hold `fixed_cents` and that someone had to hit Save in Settings; that
  was wrong** — don't reintroduce it. `buildMoney` still falls back to 0 per field, and a config
  that doesn't add up is caught by `reconciliation.balanced` and flagged on the Money page rather
  than settled.
- The `fixed_cents` reads left in `20260819090000_admin_rpcs.sql` (~line 872) are **dead**: that
  migration's `rpc_finalize_round` is superseded by the money-model revision, which reads
  `round_winner_cents`. Don't take them as evidence the old shape is still live.
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

## Error boundary (2026-09-05) — the shape to reuse

A render crash used to be a white screen with no way back but a reload nobody in another cart
could suggest. Now: `src/components/ErrorBoundary.tsx` + `src/lib/crash.ts`.

- **Two react-router `errorElement`s, one `CrashPanel`.** A pathless route under `Layout`
  (`RouteFrame` + `RouteErrorPanel scope="route"`) catches a page that throws and renders the
  panel **inside Layout's Outlet — the tab bar survives**, so the scorer taps another tab. The
  root `Layout` route carries `RouteErrorPanel scope="shell"` for a crash in the shell itself.
- **`AppErrorBoundary`** (class, wraps `RouterProvider` in `main.tsx`) is belt-and-braces for
  anything outside the router. It does **not** see a Layout crash: react-router's built-in
  boundary sits inside it and paints "Unexpected Application Error!" first — which is exactly
  why the root route needs its own `errorElement`. Found in browser verification.
- **The crash is recorded** to `sync_meta['last_crash']` (`recordCrash`, never throws:
  message, stack ≤4000 chars, component stack, route, scope, UA). Diagnostics shows a "Last
  crash" section with Clear, and "Copy state as JSON" carries it.
- The panel's copy says what was **not** lost (saved scores, the outbox, drafts) — that is the
  only question in the cart.
- **Dev-only trigger:** `?crash=route` / `?crash=shell` (`DevCrash`, gated on
  `import.meta.env.DEV`; confirmed absent from the production bundle). Use it to see the panels.
- Tests: `crash.test.ts` (5). Full `vitest run` → **167**.

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

## Round report (2026-09-06, branch `shareholder-letter`) — the shape to reuse

An **addition** under the recap card on `/rounds/:n` once the round is final (Kyle: "I love how
the board looks now, I want it as an addition" — the recap is untouched). Mocked first as a
"Shareholder Letter" on the `BOD27 Wild Ideas` design canvas, then **de-jargoned on Kyle's
call** ("drop the business jargon") — the copy is plain, per the conventions above; only the
seal and the serif carry the annual-report idea. The canvas also holds two unbuilt ideas
(Field Report wire, player Form stats).

- **`src/lib/data/report.ts` `buildRoundReport(n, db) → ReportVM | null`** — pure, same rule as
  every builder. Null unless `buildRoundRecap(...).act === 'final'` (official *or* all scores
  in). Four short paragraphs as `ReportSeg[][]` (`strong` marks a derived fact): who won and by
  how much (+ "was behind at the turn" off `holeLeaders[8]`); the hole it turned on (the last
  lead-change hole, both players' points there; "led from the 1st and was never caught"
  otherwise) + the biggest jump on the previous counting round; the worst three-hole stretch on
  the books; the week ("leads the week at N, k clear of X. Two rounds to go." / "wins the week"
  on the last round). Headline pairs the round with the week: leads / keeps / takes the week
  lead / takes the week.
- **Every player is named, once** (Kyle 2026-09-06). After the three story paragraphs, anyone
  whose last name has not appeared gets a line in a "rest of the field" paragraph (place with
  competition ties, points, gap, plus a hook: the best hole at net birdie or better, else the
  blank count at 2+); DNP players get "sat out." The check is a substring match on the last name
  across the paragraphs already built, so a new template that names someone needs no bookkeeping.
- **Copy avoids pronouns** — names only — so no template ever guesses one.
- **`src/components/round/RoundReport.tsx`** — a written account, not a second scoreboard: no
  masthead, no results table (the recap has both). Body is Fraunces at `opsz 36 / wght 450`.
  Shares as a PNG through `renderRecapImage` like the recap; footer carries
  `data-share-exclude`; button hidden where `navigator.share` is undefined (desktop preview).
- **Collapsible**: the header (eyebrow, headline, day) is the tap target; body + Share fold. Open
  by default only when `ReportVM.latest` (no later round final/in progress). The Share button
  mounts only while open, so its pre-render never captures a header-only card.
- Selector `useRoundReport(n)`; wired in `RoundDetail.tsx` directly under `<RoundRecap>`.
- **The Handicap Worksheet is gone from `/rounds/:n`** (Kyle 2026-09-06 — the report took its
  slot; `HandicapWorksheet.tsx` deleted). The `Worksheet` data on `PlayerRoundVM` stays — the
  strokes derivation is still tested in `relative-strokes.test.ts` / `handicap.test.ts`.
- Tests: `report.test.ts` (4, three-player two-round fixture asserted by hand, incl. a DNP). Full
  `vitest run` → **172**. `tsc -b` + `npm run build` clean. Verified live on `/rounds/1` and `/rounds/2`.

## Field Report (2026-09-07, branch `field-report`) — the shape to reuse

The wire: plain-English events generated from saved scores, newest hole first. A one-line strip
on Standings under the live status line; tap → `/standings/wire`. Nothing is typed. Mocked first
on the `BOD27 Wild Ideas` canvas.

- **`src/lib/data/wire.ts` `buildFieldReport(db) → WireVM | null`** — pure. Follows the
  in-progress round, else the latest final round (so the wire has content between rounds); null
  before any hole is saved. Walks holes 1..thru replaying cumulative round points; per hole, per
  completed player: a score verb ("birdies the 12th"), then one consequence, then one note.
  - **Consequence** (hole > 1 only): takes the lead / ties for the lead (6) · breaks the tie (6) ·
    caught, tied (5) · drops from a sole lead (5) · moves/slips with rank change (4) · lead
    grows/cut/holds (sole → sole). **The opening all-square is nobody's lead**
    (`noLeaderBefore`): the first to separate "takes" it, the rest "slip".
  - **Note**: streak announced at 5 and every 4 holes after; a zero after a run ≥5 says "Ends a
    run of N"; otherwise "Nth zero of the round".
  - **Field collapse**: everyone in, same points, nobody moved → one line ("Field pars the 11th.
    No movement."). Never on hole 1.
  - **CTP** on a par 3 with a recorded winner → its own line (notability 3).
  - Clock per hole = latest `client_updated_at_effective` on that hole, via `formatClock` (ET, no
    suffix). The Phase 4 seed's stamps are Jan 2026 so they all read the same — real saves won't.
- `useFieldReport()` returns `undefined` while loading, `null` when there's nothing to show.
- **`FieldReportStrip.tsx`** (Standings): a **rolling ticker of the most recent events ACROSS
  holes** (newest first, capped `FEED_MAX` = 8), one every 4.5 s. **This replaced a version that
  rotated only the newest hole's events** (Kyle 2026-09-07, "it's not rotating"): a quiet current
  hole collapses to a single "No movement" line, so `events.length < 2` left it dead — the exact
  case real data hits most of the time, and the one my desktop test masked by injecting a second
  score. The feed flattens `vm.holes[].events`, so it is ≥2 from hole 1 on (hole 1 never
  collapses). **Reduced motion suppresses the FADE, not the advance** — the changing line is
  information, so it keeps moving; only the `.wire-swap` keyframes are gated on the media query
  (the old version froze the whole rotation, a second reason it looked broken). Keyed on the
  event so the hole marker and line swap together; two lines with `line-clamp-2`, news in the
  second clause.
- **`routes/FieldReport.tsx`**: hole groups (Par · SI · clock), event rows with the player's
  ribbon colour (same `PLAYER_COLORS` slots as the recap), `leader-row` on lead/position changes.
- Tests: `wire.test.ts` (5). Full `vitest run` → **177**.

## Player form (2026-09-07, branch `player-form`) — the shape to reuse

The third canvas mockup: what the stored scores say about how a player has actually played.
Expanded from a row on the Players page, same collapsible pattern as the round report.

- **`src/lib/data/form.ts` `buildPlayerForm(db) → Map<playerId, PlayerFormVM>`** — pure, built
  for the whole field at once (one `buildRoundDetail` per round, reused across players — the
  same shape as `buildPlayerCourseHandicaps`). Counts **final + in_progress rounds only**; a
  player with no completed hole is absent from the map (the row then has no expand affordance).
  - `bestRun` — longest run of consecutive holes with points, **within one round** (runs don't
    cross rounds). Ties → more points, then the later round.
  - `worstStretch` — lowest three consecutive *completed* holes across rounds. Ties → earliest
    (round, hole), so the figure doesn't jump as later rounds match it.
  - `front`/`back` — `{points, holes}` per nine. **The verdict compares points PER HOLE, not raw
    totals** (mid-round the front has more holes in it): `splitLean` is front/back/even, and
    `splitNote` quotes both rates. Both nines need ≥5 holes (`MIN_NINE_HOLES`) or both are null.
    A tile showing "38 · 22" beside "even either way" is why — always show the hole counts.
  - `strips` — **one per round the player actually played, newest first** (a DNP round is absent
    entirely), so two rounds of form compare without tapping (Kyle 2026-09-07, chosen off a
    two-option mockup against round tabs). `complete` drops the "thru N" from the header.
    **Every strip is 18 cells wide whatever the round's cutoff**: a 15-hole round rendered
    15-across has wider cells and its hole 8 does not sit above the next strip's hole 8, which
    is the entire point of stacking them. `FormCell.counted` is false past the cutoff and renders
    as a hairline, distinct from a counted-but-unplayed hole's outline.
- **`src/components/PlayerForm.tsx`** — three tiles + one hole strip per round, with the legend
  rendered **once** under the last strip. **Five points bands, not
  three**: net Stableford lives on 1–2 points, so one shared grey made every strip flat and
  uninformative. Ramp is red (0) · grey (1) · faint olive (2, par) · olive (3+) · gold ring
  (net eagle); unplayed is an outline. Tile labels reserve two lines (`min-h-[2.5em]`) so
  "Front · Back" wrapping doesn't drop its figure below the other two.
- **Players page**: **the whole collapsed row is the toggle** — header *and* the handicap strip,
  with `py-4` on the button itself, not the `<li>` (Kyle 2026-09-07, "the players card feels
  weird": the row was 161px tall with only the top 44px tappable, so 73% of the card was dead;
  the `<li>`'s own padding was another 32px of it). Course handicaps stay visible either way —
  they're what gets looked up on the tee — but as **one compact line** (`courseShortName`, `·`
  separated) rather than a three-line ragged wrap; the row is now ~106px and all four players
  fit. The Form panel renders **outside** the button so no panel is nested in a control.
  `PlayerCardVM.form` is the carrier; screens still import only from `selectors.ts`.
- `courseShortName` ("Streamsong Red" → "Red") now lives in `src/lib/format.ts`. It had been
  copy-pasted privately into `compute.ts` and `report.ts`; both now import the shared one.
- Tests: `form.test.ts` (7). Full `vitest run` → **184**.

## The shell is the only scroller (2026-09-07) — don't regress this

`Layout`'s `<main>` carries **`overflow-x: clip`, never `hidden`.** Kyle, on his phone: "the
field report scroll isn't working."

Per CSS Overflow 3, `visible` on one axis computes to **`auto`** when the other axis is neither
`visible` nor `clip`. So `overflow-x-hidden` on `<main>` silently made `overflow-y: auto`,
turning it into a nested scroll container with **no definite height** (`flex-1` under
`min-h-[100dvh]`) — the shape iOS Safari swallows touch scrolling on. `clip` keeps the
horizontal clipping and leaves `overflow-y: visible`, so the document stays the sole scroller.

- It went unnoticed for months because **every page fit in one or two flicks**: Standings 1.3
  screens, Players 1.2, Money 2.0, round detail 2.1. The **Field Report is 4.3 screens** and
  needs sustained momentum, so it surfaced there first — and will grow to ~6 screens by the end
  of an 18-hole round.
- `overflow: clip` is Safari 16+. On anything older the declaration is dropped and the axis
  falls back to `visible` — a wide child could then scroll the page sideways, which is a
  degradation, not a break.
- **Could not be reproduced on-device here** (the iOS Simulator needs a full Xcode install; this
  Mac has command-line tools only). Verified structurally instead: `<main>` computes
  `clip / visible`, no scroll container remains in the ancestor chain, the document scrolls its
  full 2693px range, and no page 
  from Home to Rules has horizontal overflow at 375px.
- Anything that needs its own horizontal scroll (the scorecard table, the round-by-round table)
  keeps its **own** `overflow-x-auto` wrapper. That is the right place for it — never the shell.

## Phase 9 — Polish (2026-09-07, branch `phase-9-polish`) — the shape to reuse

The polish pass. **No new tables, no schema change, no scoring change.** Photo upload is
deliberately out (Kyle: "don't need photos") — `photo_url` still passes through unchanged.

- **Code-splitting.** Route components are `React.lazy` (`src/router.tsx`); **Home stays
  eager** (landing page, no Suspense flash). One `<Suspense>` boundary wraps the `<Outlet>` in
  `RouteFrame` (`ErrorBoundary.tsx`) — it sits inside Layout so the tab bar stays up while a
  chunk loads, and under the route error boundary. Vendors are split in `vite.config.ts`
  `build.rollupOptions.output.manualChunks` (`react-vendor` / `supabase` / `db-vendor`).
  `modern-screenshot` is a **dynamic `import()` inside `renderRecapImage`** (`recapImage.ts`),
  not a static import — it only loads when a share image is actually rasterised. Result: main
  app chunk **847 KB → 118 KB**, no chunk over 500 KB, Vite's size warning gone. The pure
  helpers in `recapImage.ts` (`canShareFiles`, `recapImageFilename`, `SHARE_EXCLUDE_ATTR`) are
  still static — only `domToBlob` is deferred.
- **Light-only metadata caught up with Fairway Linen.** `index.html` had `class="dark"`, a dark
  `theme-color` (`#0c1013`) and `black-translucent` status bar left over from the retired
  dark-only theme (the app went light-only 2026-08-24). Now: no `dark` class, `theme-color`
  `#e9e1d0` (the `--ground` sand), status bar `default`; PWA manifest `theme_color`/
  `background_color` likewise `#e9e1d0`. **`.dark` is referenced nowhere in `src/`** — don't
  reintroduce it.
- **Hero LCP.** The Home hero is React-rendered, so the browser can't discover it from the HTML.
  A `<link rel="preload" as="image" type="image/avif" imagesrcset=… imagesizes="100vw">` in
  `index.html` (matching the AVIF `<source>`) plus `fetchPriority="high"` on the `<img>` makes
  Lighthouse's LCP-discovery insight all-green. Browsers that can't decode AVIF skip the preload.
- **Removed `public/ctp-inline.html`** — a 31 KB orphan mockup with no references that was being
  served and precached.
- **Lighthouse (real headless-Chrome run, production build, mobile):** Accessibility **100**,
  SEO 92; Performance **75** (all diagnostics green — TBT 20 ms, CLS 0; the gap is FCP/LCP over
  simulated Slow-4G, the SPA boot cost, not an asset/bundle problem). Best-practices reads 81
  **only** on `localhost` (`is-on-https` is the single fail; passes on Netlify HTTPS).
- **Perf ≥ 90 is not met in the lab** and is left that way on purpose: crossing it needs
  **prerendering Home to static HTML (SSG)** — a real architecture change, not polish. Deferred
  as a Kyle decision. The installed PWA serves from the SW precache (instant) and production adds
  Brotli/HTTP-2/CDN, so the number the trip phones see is far better than the cold lab throttle.
- **README** finished: env-vars table, Offline/diagnostics section, Deployment (Netlify env +
  Edge Function deploy + the HTTPS install/update pre-trip check), Custom-domain steps.
- Tests unchanged: `vitest run` → **184**. `tsc -b` + `npm run build` clean, no size warning.
- **How to re-measure Lighthouse locally:** `npm run build` → `npm run preview -- --port 4173` →
  `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx lighthouse
  http://localhost:4173/ --form-factor=mobile --chrome-flags="--headless=new"`.

## Bone Valley card (2026-09-09, branch `bone-valley-card`) — the shape to reuse

The last placeholder is gone. Kyle photographed the printed card in the cart (the resort still
publishes no Bone Valley PDF); migration `20260909120000_seed_bone_valley_card.sql` seeds it and
publishes it.

- **Par 72 (36/36), four par 3s (3, 7, 12, 16)**, men's stroke index `5 7 13 9 1 17 15 3 11 /
  6 12 18 2 14 16 10 4 8`. Seven tees — Green 74.7/134/7190, Black 72.0/128/6600, Silver
  69.4/120/6075, Gold 63.3/105/4855, and the combos Green/Black 73.2/131/6875, Black/Silver
  70.6/125/6320, Silver/Gold 66.3/110/5430 — each with all 18 yardages. `year_opened` → 2026
  ("Established 2026" on the card).
- **The combos come off the card's ▲/▼ row exactly as on the 2021 cards** (▲ = back tee of the
  pair): `▼▼▲▲▼▼▲▼▲ / ▼▲▲▼▲▲▲▼▼`. All three combo totals reconcile to the printed figures, which
  is also what settled two illegible Black cells (16 = 185, 17 = 365): the only reading under
  which Black In = 3190 *and* every combo sums right.
- **The seed flips `data_is_placeholder` itself**, in a `do` block that re-runs the publish
  RPC's checks (18 pars, 1–18 SI permutation, rating+slope on every tee, a yardage on every
  hole×tee, seven tees) and raises otherwise — a seed can't hold a session, and a printed card
  is the same trust level as the other three seeds. The RPC remains the only *app* path.
- **The tee/yardage upserts `DO UPDATE` on conflict**, not `DO NOTHING`: the placeholder Green
  tee and its 18 null-yardage rows already existed, and any hand-typed admin edits on the hosted
  DB are superseded by the card. Stable UUIDs `bbbb0004-…-000T`, T = 1..7 in the usual order.
- Tests that needed an empty placeholder course (`write_path.sql` hard block, `admin_path.sql`
  §7/§10) now **re-open Bone Valley inside their transaction** (flag on, pars nulled) instead of
  assuming it. `seed_integrity.sql` asserts the published card (plan 23 → 25).
  `scripts/verify-card-data.py` carries the Bone Valley transcription (all 7 tees) → 0 problems.
  `scripts/verify-admin-path.sh` §4 demonstrates the empty-card refusal on a throwaway course.
- `supabase test db` → **234**. `vitest run` → 184 (no `src/` change). **Pushed to the hosted
  project by Kyle 2026-09-09** (`supabase db push`, single migration) and read back over PostgREST:
  published, 7 tees, par 3s 3/7/12/16. Production now scores Round 4.
