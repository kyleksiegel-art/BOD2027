# Audit log — running notes

Started 2026-09-09. Auditor: Claude (QA + product + tournament ops). Branch at start: `main` @ bbe21f0 (clean).

## Phase 0 — environment gate (2026-09-09)

| Check | Result |
|---|---|
| Repo accessible | Yes — `/Users/kylesiegel/projects/BOD2027`, `main`, clean tree |
| Local instance | Yes — Docker up; `supabase status` shows DB (54322), REST/Kong (54321), Realtime, edge runtime all running. `supabase functions serve --env-file supabase/functions/.env --no-verify-jwt` already running (pin-verify reachable; returns 401 on an empty POST, i.e. alive). `.env.local` points at `http://192.168.1.183:54321` which is this Mac's `en0` address, so the browser preview and a phone on the LAN both reach it. |
| Disposable data | Yes — `supabase db reset` rebuilds from migrations incl. the Phase 4 fake-score seed (R1 final, R2 final over 15 holes, R3 in progress w/ Chris DNP, R4 upcoming, no R4 round_players). Reset run at start: OK. Direct SQL via `docker exec supabase_db_BOD2027 psql -U postgres` (no local `psql` binary). |
| Browser automation | Yes — in-app Browser pane (`preview_start` `vite-dev` on :5173 from `.claude/launch.json`). |
| Persistence/server layer direct | Yes — PostgREST RPC via curl with the local anon key (well-known local demo key, never written here), SQL via docker exec, pgTAP via `supabase test db`. Phase 7 is fully possible locally. |
| Baselines | `npx vitest run` → 184/184 pass. `supabase test db` → 234/234 pass. |

### Phase 5 (offline/concurrency) — what this environment can and cannot reproduce
- CAN: two "devices" = two browser tabs/origins is not possible in one pane (same origin shares IndexedDB), so a second client is simulated with **direct RPC calls carrying a different `client_id`** plus the `FakeServer`/`fake-indexeddb` unit harness; Realtime delivery to the open page; server refusal / stale-write rollback; refetch-merge behaviour; app reload with pending outbox (stop the REST container or block the URL to go "offline"); queued write landing after finalization; token-expiry during a queued `round_player`.
- CANNOT (UNVERIFIED, needs two real phones / iOS): true airplane-mode on iOS, force-quit of an installed PWA, iOS install-then-unlock ordering, `navigator.share` sheet, NTP clock jump on a real device.
- Local PIN for the dev stack is documented in `supabase/functions/.env.example` header (not reproduced in this audit).

### Blocked before starting
- Nothing that blocks Phases 1–4, 6, 7. Phase 5 partially blocked as listed above (device-only items).

## Phase 1 — intended behaviour, and where docs and code disagree

Sources read: brief.md (all), decisions.md (scoring/money/tiebreak/auth/offline sections), schema.md (RPC + validation), CLAUDE.md, scoring engine (`src/lib/scoring/*`), `compute.ts` (round/standings/enter), `money.ts`, the three write RPCs, finalize/abandon/start/clear RPCs, sync engine, Enter/Money/RoundsEditor/Rules screens.

### Intended rules (as implemented — the operative spec)
- **Stableford**: net = gross − strokes on hole; netToPar → {≤−3:5, −2:4, −1:3, 0:2, +1:1, ≥+2:0} from `settings.points_table` (retroactive). Pickup = 0 pts, counts as played. Unentered = null, does not count toward thru or total.
- **Handicap**: CH = index × slope/113 + (rating − par), unrounded; PH = roundHalfAwayFromZero(CH × allowance); strokes = min(PH, cap) with cap_applied only on strict exceed. Index read LIVE from `players.handicap_index` (decision 2026-08-22); allowance/cap taken from the `round_players` snapshot. Manual override replaces own strokes. **Play off the low**: strokes actually allocated = max(0, own − min(own over playing players)). Allocation by course SI ascending with wrap; plus handicaps strip from SI 18 down.
- **Shortened round**: `rounds.holes_counted` typed by admin at finalize; only holes ≤ cutoff count; finalize refuses unless every playing player has gross-or-pickup on every counted hole. DNP excluded from cutoff and holes-won.
- **Abandoned**: excluded from points, money, tiebreaks; scores kept. UI door is "Clear scores" (resets to in_progress), not Abandon.
- **Standings**: total over `final` + `in_progress` rounds; competition ranking; tie chain best-round → holes-won → countback [3,4,2,1] with windows 10–18/13–18/16–18/18 (shortened variants); only an unbreakable tie shares a position.
- **Money**: buy-in × players = 1st + 2nd + 4 × round winner. 1st/2nd off standings positions (ties pool & split evenly, remainder cent to higher standing); round winner = round leaderboard top, tie → countback on that round → split. Derived live; `round_money` freezes only `round_winner_cents` at finalize. Settlement (greedy) only when every non-abandoned round is final, nothing pending, and balanced. No CTP money.
- **Offline**: outbox for scores/CTP/round_players; comparator `(client_updated_at_effective, client_id)` at 4 sites; terminal refusals dead-letter immediately; network failures cost nothing.
- **Auth**: scores/CTP RPCs open to anon; every admin RPC + `rpc_upsert_round_player` session-gated (4-digit PIN → Edge Function → opaque token).

### Divergences found (doc vs code, or code vs code) — to be verified/triaged
1. **Rules page "Handicaps are locked in per round; a later index change doesn't rewrite a round already played."** — FALSE under the live-index decision (2026-08-22): `buildRoundDetail` reads `players.handicap_index`, so an index edit re-derives every round's points, finalized ones included. The arguments-ending page states the opposite of what the app does. (Also the brief's original text — superseded — still says snapshot.)
2. **Rules page + Enter hint: CTP "must make par or better to claim it"** — appears nowhere in brief.md or decisions.md and is not enforced by code (any playing player can be picked). The brief's own CTP rule (tee shot, on the putting surface, hole-in-one wins outright, no ties) is not stated on the Rules page. Open house-rule question.
3. **DNP cannot be set anywhere in the UI** (status picker removed 2026-08-22), yet DNP is a brief requirement and the engine/money/finalize all support it. Worse: `RoundsEditor.entries()` sends `status: 'playing'` and `manual_override: null` for every participant on "Save tees", so a DNP already in the DB (seed R3 Chris) would be flipped back to playing by any tee save. Needs reproduction.
4. **Scores may be written to a `final` round** by the open RPC and by the Enter screen (only `upcoming` and placeholder are blocked). Money is "frozen" only as an amount; the round winner is derived live, so a post-final edit can move who is paid while the page says "Frozen". Brief doesn't forbid post-final edits; flag as decision + labelling issue.
5. **Money page shows provisional money as if awarded**: an in-progress round's current leader appears as "Round winner" and in the ledger's Won/Net columns; 1st/2nd overall are awarded to the current standings before the trip is over. Only "Frozen" distinguishes final rounds. The "what money is confirmed vs projected" question is not answerable.
6. **`rpc_upsert_ctp` does not check round status** (CTP accepted on an `upcoming` round); `rpc_finalize_round` does not require `in_progress` (an `upcoming` round with zero round_players finalizes with no errors). Both session-/boundary-level, low impact.
7. **Position-change arrows** mix ranking semantics: previous positions via `standingsThroughRound` (no tiebreak, shared ranks) vs current with the tiebreak chain.
8. **Dexie merge never deletes** server-deleted score rows (only a live Realtime DELETE does). Admin "Clear scores" therefore leaves ghost rows on any phone that was closed/offline at the time (CLAUDE.md admits it: "clear IndexedDB after deleting rows"). Reproduce in Phase 5.
9. **Brief's countback rationale vs order**: the [3,4,2,1] positional order was confirmed by Kyle 2026-08-27 — no divergence, noted as resolved.
10. **schema.md §validation still says `session_token` is required for scores/CTP** — stale (PIN removed 2026-08-17). Doc-only.
11. **Brief: "Standings is the default landing route"** vs router: `/` is Home. Decided elsewhere? (Home shows the board.) Noting only.
12. **Brief: projection labelled "projected finish"** — `computeProjection` exists; need to check it is rendered anywhere (Standings/Enter don't show it in the code read so far).
13. **Brief: Handicap worksheet toggle on each round's page** — removed 2026-09-06 (Kyle). Noted, not a defect.

## Phase 2 — coverage (see coverage.md)
_(in progress)_

## Phase 4 — lifecycle (fresh state via scratch `fresh.sql`, local DB)
- Fresh: Standings empty-state copy OK; Rounds all UPCOMING; Enter shows both banners (no round_players + round not started); `/rounds/4` placeholder copy; Enter R4 hard-block lists "Par is not set on 1 hole"; Admin Courses shows "1 to fix"; Validate & publish refused (issue stays listed); fixing hole 7 par via the hole editor → "Hole 7 saved." → publish → "Published — this course can now be scored." ✔
- Start round before tees → both the client pre-check and the server refusal show; Save tees (Green ×4) → "13/17/18/18 strokes" ✔ (hand calc); Start → In progress ✔.
- Enter hole 1: tap-par, +/+ (6), PU, blank fourth → Save disabled "All 4 scores needed / still need Chris"; fill → Save → advances to hole 2, back → "Saved" ✔. Server rows carry this client's id and one shared stamp ✔.
- A second client (curl, own client_id) wrote hole 18 for Chris; it appeared on the open Enter screen within a second (Realtime) ✔.
- Correction of a saved hole (Jon 4→5) saves with one dirty cell ✔.
- Bulk R1 via API; totals 35/35/32/26 = independent calc ✔; extreme 12 → 0 pts ✔; ace with no stroke → +4 ✔; PU cells ✔; dots on stroke holes match SI allocation ✔.
- Stale write: Chris 18 (server effective now+5m) edited on-device → silently reverted (F-013).
- Tie Jon/Kyle 35: overall broken by holes won (Kyle 4 v Jon 2) → Standings Kyle 1st ✔ vs calc; round winner by countback → Jon ✔ vs calc; but recap says "pays Jon & Kyle" (F-010) and report says "Jon leads the week" (F-011); Standings shows both LEADER, no tiebreak copy (F-012).
- Finalize R1 (blank holes counted) → final; `round_money` row 5000/0/0/par3=4 ✔. Post-final edit accepted; frozen winner flipped (F-009).
- Ghost rows after server delete (F-014) observed at the fresh-state step.

## Phase 7 — boundaries (local, curl with anon key; admin token minted via the local Edge Function into the scratchpad)
- Direct INSERT scores / PATCH rounds / DELETE players → 401 ✔. SELECT players → 200, 4 rows ✔. SELECT sessions / pin_attempts → 42501 ✔.
- rpc_start_round with null / garbage token → 28000 (HTTP 403) ✔. rpc_create_session, rpc_pin_gate, rpc_record_pin_attempt as anon → 42501 ✔. rpc_revoke_all_sessions bad token → 28000 ✔.
- rpc_upsert_scores: round_upcoming ✔, gross 0/26 → out_of_range ✔, hole 0/19 → hole_not_on_course ✔, pu+gross ✔, unknown player → no_round_player_row ✔, malformed uuid → per-cell db_error 22P02 (batch continues) ✔, missing ts → missing_required_field ✔, non-array → 22023 ✔, far-future raw ts → effective clamped to now+5min ✔.
- rpc_upsert_ctp: non-par-3 ✔, unknown winner ✔, negative distance ✔; **accepted on an upcoming round** (no status check — P3, logged).
- rpc_upsert_settings: unknown key, missing points band, allowance 1.5 all refused ✔.
- rpc_upsert_scores accepts writes to a `final` round (F-009).

## Phase 5 — offline / concurrency (local: API gateway container stopped to simulate no signal)
- With Kong stopped: badge → OFFLINE (probe), Enter R3 opened on hole 15 (first open hole), Kyle par → Save → "Saved on this phone — it'll sync when you have signal. (1 hole waiting)", badge "1 TO SYNC"; hole 16 ×4 → "5 TO SYNC", "(2 holes waiting)". Diagnostics: reachability offline, Outbox 5 waiting with key/seq/time, dead letter 0. Standings/round detail render offline and include the queued cells ✔.
- Admin while the badge said OFFLINE: page fully unlocked, no banner — `useOnlineStatus` is the Phase-1 `navigator.onLine` stub (F-017).
- Scorecard shows no unsynced markers for the 5 queued cells (F-018).
- Kong restarted: outbox drained within ~30 s (Realtime resubscribe/interval), badge ONLINE, server holds all 5 rows with this client's id ✔. No duplicates (unique key). Last sync updated.
- Stale write silently reverted (F-013, earlier). Realtime delivery of a foreign write to the open page ✔ (~1 s).
- Unexplained transient: the first `rpc_upsert_scores` batch for R3 hole 1 (sent ~10 s after "Start round") had 3 of 4 cells `applied:false`; the error text was not captured and a re-send applied all four. Not reproduced since; logged as UNVERIFIED.

## Phase 6 — usability scan at 375×812 (Chrome emulation)
- No horizontal document overflow on /, /standings, /rounds/3, /enter, /money, /info/players, /admin (scrollWidth == 375). Page heights: Home 2078, Standings 1001, round detail 2466, Money 1616, Admin 2259 px.
- Sub-44 px controls: Standings round-column header links (19×22 — intentionally quiet drill-down), scorecard Points/Gross toggle (36 px tall), inline "admin" text links in Enter banners, Info tab links 34–43 px wide (44 tall). Everything else ≥ 44.
- Enter default round when nothing is live: the next upcoming round, with both banners (no tees / not started) — clear.
- Expired-session flush: see F-021. After re-unlock the 4 queued tee changes flushed within seconds (badge back to ONLINE); R4 started from admin.
- R4 entered from the second client (72 cells, 2 pickups, 4 CTPs incl. an explicit no-winner). Independent end-state: Kyle 142 / Adam 140 / Jon 136 / Chris 65; round winners Kyle, Adam, Kyle (R3 on the last counted hole), Kyle (R4 countback over Adam); payouts Kyle $750, Adam $250 → net Kyle +500, Adam 0, Jon −250, Chris −250; greedy settlement Jon→Kyle 250, Chris→Kyle 250.

## Phase 8 — fixes (branch `audit/p1-fixes`, three commits)
- F-021 `outbox:` — auth refusal costs no attempt, locks the local session, defers; `authexpiry.test.ts`.
- F-010 `recap:` — one round-winner resolver (`resolveRoundWinnerIds`), recap says "on countback"; `recap-winner.test.ts`.
- F-001 + F-009 `rounds:` — DNP/override preserved on tee save + status picker; final/abandoned rounds refuse scores/CTP (`round_final`/`round_abandoned`), Enter blocks, `rpc_reopen_round` + Reopen button; pgTAP +7.
- Gates: `npx tsc -b` clean, `vitest run` 192/192, `supabase test db` 241/241, `npm run build` clean.
- Browser verification (local seed after `db reset`, IndexedDB cleared first because of F-014): Enter R1 shows the closed banner; admin R3 "Save tees & status" keeps Chris did_not_play (DB confirmed); admin R2 Reopen → in_progress, round_money gone, score accepted, re-finalized at 15 over the API.
- Stopped before P2/P3 per the brief; recommendations are in REPORT.md.
- Local DB left at the seed state except: R2 Jon hole 1 = 5 (written on the reopened round), R4 tee time 8:40. `supabase db reset` restores everything.
