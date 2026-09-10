# Coverage checklist

Status values: `not-started` · `in-progress` · `covered` · `blocked`. Built from `src/router.tsx`, `Admin.tsx` TABS, and the components each route mounts. "State" rows are tournament states the page must be seen in.

## Public routes

| Item | Status | Notes |
|---|---|---|
| `/` Home — countdown state (no scores) | covered | needs `?now=` dev clock or DB reset with all rounds upcoming |
| `/` Home — playing state (in_progress round, board, saved-progress line) | covered (via ?now= dev clock) | |
| `/` Home — between rounds (final + upcoming) | covered | |
| `/` Home — all final (Complete) | covered | |
| `/` Home — hero, wordmark tap → home, field list, pending-sync line | covered | |
| `/standings` — table, T-positions, live status line, round breakdown columns, position arrows | covered | |
| `/standings` — FieldReportStrip ticker + tap → `/standings/wire` | covered | |
| `/standings` — empty (no counting round) | covered | |
| `/standings/wire` Field Report — hole groups, events, empty state | covered | |
| `/rounds` list — status badges, leader, rail colours | covered | |
| `/rounds/:n` — upcoming (not started copy) | covered | |
| `/rounds/:n` — in progress (recap live, scorecard, unsynced markers) | covered | |
| `/rounds/:n` — final full / final shortened (excluded columns, "R2 — 15 holes") | covered | |
| `/rounds/:n` — placeholder course copy | covered | requires re-opening Bone Valley locally |
| `/rounds/:n` — RoundRecap (leaderboard, facts, CTP fact, Share button hidden on desktop) | covered | |
| `/rounds/:n` — RoundReport collapsible (final only) | covered | |
| `/rounds/:n` — Scorecard PU cell, blank cell, colour bands, legend, horizontal scroll | covered | |
| `/rounds/:n` — bad id (`/rounds/9`) | covered | |
| `/enter` — round picker default, opening hole = first open hole | covered | |
| `/enter` — steppers, tap-par, PU toggle, Save gating (all N scores), advance on save, "Saved" | covered | |
| `/enter` — drafts survive paging + reload; picker highlights dirty holes | covered (dirty hole 17 highlighted after navigating away and back) | |
| `/enter` — CTP picker on par 3, saved with hole | covered | |
| `/enter` — blocked: round upcoming; blocked: card placeholder; missing round_players banner | covered | |
| `/enter` — final round selected (editable?) | covered | |
| `/enter` — offline save → queued copy, pending holes count | covered | |
| `/money` — pots, per-round winners, ledger, settlement states (not settleable / unbalanced / even / transfers), no-money state | covered | |
| `/info` → redirects to itinerary | covered | |
| `/info/itinerary` — timeline, current-day highlight | covered | |
| `/info/courses` + `/info/courses/:id` — index, detail card, bad id | covered | |
| `/info/players` — rows, expand Form panel, handicap strip | covered | |
| `/info/rules` — copy vs implementation | covered | divergences 1, 2 logged |
| `/info/side-games` | covered | |
| `/admin` — locked (PinGate: wrong PIN, throttle copy), offline banner | covered | |
| `/admin` Rounds tab — save tees, tee time, start, finalize (full / shortened / refused), clear scores confirm | covered (shortened finalize exercised via SQL RPC; clear-scores confirm → Cancel only; Reopen added and exercised) | |
| `/admin` Players tab — edit index, assigned flag, add player | covered (index edit + revert; export → Copy JSON/CSV buttons appear) | |
| `/admin` Courses tab — edit hole (un-publishes), tee edit, validate & publish, issues list | covered | |
| `/admin` Itinerary tab — add/edit row | not-started (rendered and read; no write exercised — Phase 8 content editors, low risk) | |
| `/admin` Lodging tab — add lodging, assignment | not-started (rendered and read; no write exercised — Phase 8 content editors, low risk) | |
| `/admin` Settings tab — points table, allowance, cap, money card; retroactive effect | not-started (rendered and read; no write exercised — Phase 8 content editors, low risk) | |
| `/admin` Export panel — JSON + CSV copy | covered (index edit + revert; export → Copy JSON/CSV buttons appear) | |
| `/diagnostics` — locked, unlocked, outbox, dead-letter retry/export, copy state, last crash | covered | |
| `*` NotFound | covered | |
| Shell — BottomTabBar, TopBar, ConnectionBadge states, PwaUpdatePrompt (n/a in dev), HydrationGate | covered (badge ONLINE / OFFLINE / N TO SYNC) | |
| Error boundary — `?crash=route`, `?crash=shell` | covered (route; shell not exercised) | |

## Lifecycle sequence (Phase 4)
| Step | Status |
|---|---|
| Fresh tournament, no scores, all upcoming | covered |
| Incomplete course data (placeholder) + missing round_players | covered |
| Start round (refusals + success) | covered |
| Enter all four players hole by hole | covered |
| Correct a previous hole | covered |
| Pickup + CTP | covered |
| Uneven progress | covered (R3: Kyle thru 14, others 15) |
| Ties, lead changes, extreme scores | covered |
| Shorten (holes_counted) / abandon | covered (R3 finalized at 14; refusal listed missing counts; excluded columns render; abandon has no UI door — Clear scores replaces it) |
| Finalize then edit | covered |
| Next round; all four final; settlement | covered (R4 final; Home Complete state; settlement 2 transfers = hand calc) |

## Independent calculation (Phase 3)
| Check | Status |
|---|---|
| Course handicaps per player/tee vs hand calc | covered |
| Play-off-low + SI allocation | covered |
| Stableford totals for seeded R1/R2/R3 | covered |
| Pickup vs missing | covered (seed R2 PU cells) |
| Tiebreak stages (best round, holes won, countback) | covered (holes-won, round countback, unbreakable shared 1st all match hand calc; shortened-round stages pending R3) |
| Partial rounds / uneven thru | covered (seed R3) |
| CTP eligibility + later correction | covered (par-3-only picker, winner corrected Kyle→Adam, explicit No winner; recap shows 'carry' for no-winner — F-005) |
| Money: 1st/2nd/round winner, ties, remainder cents, reconciliation | covered (pooled tie $400 each ✔; F-016 label) |
| Finalize / reopen / historical consistency | covered (F-009: post-final edits move frozen winner) |
| Single score traced end-to-end | covered (Kyle R1 h17 5→4: Enter → server row → standings 36 → round page → Money winner flip → report) |

## Offline / concurrency (Phase 5)
| Scenario | Status |
|---|---|
| Lose connection before/after save | covered (API container stopped) |
| Reload with pending outbox | covered (navigation between routes with 5 pending; Diagnostics lists them) |
| Reconnect drains queue | covered (~30 s after API restore) |
| Rejected write (terminal) → dead letter + UI | covered at RPC level (terminal vocabulary); UI dead-letter path not exercised (no terminal refusal reachable from the UI once a round is live) |
| Two clients same cell (stale rollback) | covered (F-013) |
| Offline edit lands after finalization | covered (accepted — F-009 addendum) |
| Expired admin token during queued round_player | covered (F-021) |
| Server-side delete (clear scores) vs cached rows | covered (F-014) |
| Duplicate submission | covered (re-sent batches upsert on the unique key; counts unchanged) |

## Boundaries (Phase 7, local only)
| Check | Status |
|---|---|
| Anon direct table writes refused; reads allowed | covered |
| Score RPC validation rules (each) | covered |
| CTP RPC validation rules | covered (round status not checked — logged) |
| Admin RPCs without/with bad token | covered |
| Finalization restrictions bypass | not-started |
| service_role-only functions not callable by anon | covered |
