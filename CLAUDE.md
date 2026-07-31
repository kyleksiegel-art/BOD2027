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
- **Online-only, direct RPC:** everything else in `/admin` — players, indexes, tees, scorecards, settings, rounds, itinerary, lodging, purse config, re-snapshotting, round finalization. Admin screens detect offline and say so plainly.

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

Reads are public. Writes require a 6-digit PIN session. PIN verification happens in an **Edge Function** (real client IP for throttling), not an RPC. On success, the client receives a 128-bit opaque session token; the server stores only its hash. All writes go through `SECURITY DEFINER` RPCs that validate the token against `sessions`. Every `SECURITY DEFINER` function pins `SET search_path = ''` and fully schema-qualifies references. `CREATE FUNCTION`'s implicit `EXECUTE TO PUBLIC` is revoked, then re-granted to `anon` only on intended RPCs. Do **not** call `supabase.realtime.setAuth(token)` — the token is opaque, not a JWT; the Realtime connection stays on the anon key. Local offline PIN verification uses a stored bcrypt hash — accepted tradeoff for a four-person golf trip.

## Scoring in one paragraph

Net Stableford. Points table stored in `settings` (retroactive). Handicaps snapshotted per round in `round_players` (not retroactive; re-snapshot requires an explicit admin action). Course Handicap = `Index × (Slope / 113) + (Course Rating − Par)`, carried unrounded; Playing Handicap = round(Course Handicap × allowance%); Final Strokes = min(Playing Handicap, cap). Cap default 18 — applied last, after allowance and after rounding. Rounding is half-away-from-zero (not JS's `Math.round`). Stroke allocation is by course-level stroke index, wrapping above 18 (guarded to terminate). Plus handicaps remove strokes starting from SI 18. DNP players score 0 and are excluded from that round's holes-won and shortened-round cutoff computation.

## Conventions

- **Language in the UI is plain.** No "Shareholder Standings" or "Accounts Payable." Standings, Rounds, Scorecard, Players, Money, Rules, Itinerary. Visual treatment carries the annual-report idea; copy does not wink at it.
- **Dark mode only.** High contrast. Tabular numerals wherever numbers appear.
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
