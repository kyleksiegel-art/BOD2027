# Claude Code Build Prompt — "Board of Directors" Streamsong 2027

> Paste everything below the line into Claude Code from an empty directory.
> The `CONFIG — FILL THIS IN` section is the only part you need to edit first, and TODOs are fine — Claude will ask.
> **One open decision is flagged for Kyle in the Offline section ("Open question — day-of tee changes"). Answer it in Phase 0.**

---

Build me a live golf trip tournament web app: an offline-capable PWA, deployed to Netlify from a GitHub repo, backed by Supabase.

## Phase 0 — Plan before you build

Before writing any code, read this entire brief, then come back to me with:

1. A proposed phase plan (I want to sign off after each phase, not receive the whole thing at once)
2. Your proposed file/route structure
3. The exact Supabase schema, RLS policies, and RPC signatures you plan to create
4. **A `docs/spec/decisions.md`** listing every decision you had to make that this brief does not specify, every ambiguity you resolved and how, and every place two requirements appeared to conflict. This is the document I most want to read before you start — not a restatement of the brief.
5. Your answer to the open question flagged in the Offline section

This brief is the authoritative spec. If you split it into `docs/spec/`, do it as a verbatim mechanical split, not a rewrite, and changes go to the brief first.

Develop against a local `supabase start` instance. Push migrations to the hosted project only after I've signed off, and never run a destructive migration against the live project once real scores exist.

### Session discipline — read this carefully

I have six months and a finite token budget. **This gets built one phase per session, and no more.** Treat the following as hard rules, not preferences:

1. **Build exactly one phase per session, then stop.** Do not begin the next phase even if you have context budget left over. End by writing the handoff note described below and nothing else.
2. **Never read the whole repository.** At the start of a session, read only: `CLAUDE.md`, `docs/spec/acceptance-checklist.md`, `docs/spec/handoff.md`, and the one or two spec documents relevant to the phase you're on. Then open only the files you're actually changing.
3. **Don't re-derive what's already decided.** `CLAUDE.md` holds the architecture summary, the data-layering rule, the schema shape, and the conventions. Keep it current and trust it instead of re-reading source to remember how something works.
4. **End every session with `docs/spec/handoff.md`** — 15 lines maximum: what phase just finished, what's next, any half-finished work, any decision I still owe you. This is what the next session reads to restore context cheaply, so it must be short and accurate.
5. **Don't dump test output into context.** Use `npx vitest run --reporter=dot` and report failures only. Never paste a passing suite's full output.
6. **One phase per branch**, merged to `main` when I sign off. Netlify deploy previews per branch.

### Phase plan

Propose adjustments in Phase 0 if you disagree, but this is the intended shape and the ordering is deliberate:

| Phase | Scope | Why here |
|---|---|---|
| **0** | Spec split, `decisions.md`, `CLAUDE.md`, phase plan. **No code.** | Surfaces misunderstandings while they're free |
| **1** | Scaffold: Vite/React/TS/Tailwind, routing, app shell, design tokens, empty pages. Deploy to Netlify. | A live URL on day one; deployment problems found early, not late |
| **2** | Supabase schema, migrations, idempotent seeds, RLS policies, realtime publication. **No UI.** | Foundation; verifiable with SQL alone |
| **3** | **Scoring engine — pure TypeScript, full test suite, no UI whatsoever.** | The thing that must be correct, isolated from everything that could distract from correctness. Also the cheapest phase to get right and the most expensive to get wrong. |
| **4** | Read-only UI: Standings, Rounds, scorecard grid, handicap worksheet — rendering seeded fake scores. | Proves the engine and the display agree before any write path exists |
| **5** | Auth: PIN Edge Function, sessions, RPCs, server-side validation. Score entry, **online only.** | Entry working simply before adding sync |
| **6** | Offline: Dexie, outbox, the comparator in all four places, service worker, diagnostics. | Hardest phase — deserves a session with nothing else in it |
| **7** | Money: CTP, purse weights, snapshots, ledger. | Independent of everything above |
| **8** | Info pages, itinerary, lodging, courses, players, admin editors. | Content-shaped, low risk |
| **9** | Polish: Lighthouse, photos, countdown, full acceptance pass. | |

If a phase turns out too large mid-session, **stop and split it** rather than rushing the back half. Note the split in the handoff.

### Per-phase acceptance checklist

Maintain `docs/spec/acceptance-checklist.md` and update it at the end of every phase with:

- Requirements implemented
- Automated tests covering them
- Manual tests performed
- **How each was verified** — concrete evidence ("airplane-mode test on two devices, screenshots attached"), not an assertion
- Requirements deferred, and to which phase
- **Any deviation from this brief**, with the reason

**A requirement is not complete merely because the UI exists.**

Wait for my sign-off before proceeding past Phase 0.

---

## The trip

- **Group name:** The Board of Directors
- **Trip name:** Board of Directors — Streamsong 2027
- **Venue:** Streamsong Resort, 1000 Streamsong Dr, Bowling Green, Florida (some databases list these courses under "Fort Meade" — use Bowling Green)
- **Dates:** February 4–7, 2027 (Thursday–Sunday)
- **Players:** 4 — Jon Aronson, Kyle Siegel, Adam Hersh, Chris Denove

**Round schedule — one 18-hole round per day:**

| Round | Date | Course | Architect |
|---|---|---|---|
| 1 | Thu Feb 4, 2027 | Streamsong Red | Coore & Crenshaw |
| 2 | Fri Feb 5, 2027 | Streamsong Blue | Tom Doak |
| 3 | Sat Feb 6, 2027 | Streamsong Black | Gil Hanse & Jim Wagner |
| 4 | Sun Feb 7, 2027 | Bone Valley | David McLay Kidd |

### Course data

Research and seed real scorecards for Red, Blue, and Black — par, yardage per tee, stroke index per hole, rating/slope per tee, and year opened. Use WebFetch against a named, citable source (BlueGolf or ProVisualizer detailed scorecards, or the resort's own) and cite it in a comment in the seed migration. If you don't have web access or can't verify a number, **stop and ask me** rather than guessing.

Two things that look like data-entry errors but are not — do not "correct" them:

- **Streamsong Black is par 73**, not 72. Red and Blue are par 72. The `(Course Rating − Par)` term must use 73 at Black.
- **Black has five par 3s**; Red and Blue have four each. This drives the CTP money weighting below.

**Stroke index is modeled once per course, not per tee** — one `stroke_index` column on `holes`. That matches how Streamsong prints its cards and avoids a join plus a class of bugs for no benefit here. Don't relitigate this in Phase 0.

### Bone Valley — incomplete course data

Brand-new David McLay Kidd design, over 7,300 yards from the tips, the longest at the resort. Preview play began October 30, 2026; grand opening January 26, 2027 — nine days before we arrive. On the Courses page describe it as the resort's **fifth course and fourth full-length 18** (The Chain is a 19-hole short course); do not simply call it "the fourth course."

Its scorecard, rating, and slope are **not publicly available yet**. Do not invent them. Build for it concretely:

**Schema must tolerate the gap.** While `courses.data_is_placeholder = true`:

- Seed 18 numbered `holes` rows with `par` and `stroke_index` **nullable and null**
- `tees.rating`, `tees.slope`, and `hole_yardages.yardage` nullable and null

**Scoring is blocked until the card is complete.** Round 4 score entry is hard-blocked — not merely warned — until every hole has a non-null par and stroke index, the stroke indexes form a complete 1–18 permutation, and the selected tees have yardages. Show what's missing and link to the admin editor. This is a genuine block, not a dismissible banner.

**An admin validation RPC** runs those checks and, only if they all pass, atomically sets `data_is_placeholder = false` in the same transaction. Don't let anyone flip the flag by hand.

**Handicap fallback when rating/slope are missing**, with *distinct* banner copy — these are different situations and conflating them is misleading:

- Rating known, slope null → use slope 113. Banner: **"Default slope of 113 in use — Bone Valley slope not yet published."**
- Rating and slope both null → `Course Handicap = Index`. Banner: **"Playing handicaps computed from handicap index only — Bone Valley rating and slope not yet published."**

**The real card has to be typed in on wifi**, because course data is admin-only and admin writes require a connection (see Offline). Blocking admin banner from Feb 5 onward: "Enter the Bone Valley scorecard on wifi before Sunday."

---

## Tech stack

- **Frontend:** Vite + React + TypeScript + Tailwind. React Router. No heavy component library — build the components.
- **Local store:** **Dexie** with `dexie-react-hooks` (`useLiveQuery`). Not the bare `idb` package — it has no change notification, and the UI must re-render reactively on local writes.
- **Server:** Supabase (Postgres + Realtime + RLS + Edge Functions + Storage).
- **Network layer:** TanStack Query.
- **Hosting:** Netlify, continuous deploy from `main`.
- **Testing:** Vitest + `fake-indexeddb`, plus SQL-level tests against a real local Postgres.

**Data layering — state this in the README and follow it exactly:**

> TanStack Query owns network fetch and writes results into Dexie. **Components read only from Dexie via `useLiveQuery`, never from TanStack's cache directly.** Scoring and CTP mutations go through the outbox and nothing else.

Mobile-first — used one-handed in a cart in Florida sun. Minimum 44px tap targets, high contrast, no hover-dependent interactions.

**Viewport:** standard `width=device-width, initial-scale=1`. Do **not** set `user-scalable=no` or `maximum-scale=1` — that fails the Lighthouse accessibility target below. Prevent iOS zoom-on-focus with `font-size: 16px` on inputs instead. Include `mobile-web-app-capable`, `apple-mobile-web-app-capable`, and a webmanifest with icons.

---

## CONFIG — FILL THIS IN

```
Jon Aronson   — index: TODO   tees: TODO
Kyle Siegel   — index: TODO   tees: TODO
Adam Hersh    — index: TODO   tees: TODO
Chris Denove  — index: TODO   tees: TODO
Player titles — TODO (I'll supply; leave null)
Player photos — TODO (I'll upload via admin; leave null)
Tee times per round — TODO (America/New_York)
Lodging (Streamsong Lodge vs The Grange) and rooms — TODO
Dining reservations — TODO
Travel: flights / drive times, arrival and departure — TODO
Purse mode and dollar amounts — TODO (default everything to $0)
```

**Source of truth:** Supabase is authoritative at runtime for everything mutable — players, indexes, tees, tee times, scorecards, itinerary, lodging, point values, purse config. `src/config/trip.ts` holds only static copy and build-time constants. I don't want to redeploy to fix a typo mid-trip, and that includes the itinerary.

Build `/admin`, behind the PIN, to edit all of it.

---

## Scoring engine

Pure, dependency-free TypeScript in `src/lib/scoring/`, no React and no network imports. Every leaderboard reads from this module — never recompute points inline in a component. **Store gross scores only; derive everything else.** Because it's pure, all scoring must work identically offline from cached data — verify that nothing in the standings or scorecard path requires a live query.

Do not hardcode a player count of 4 anywhere in the engine or the holes-won logic; derive it from the data. The scorecard grid may stay visually optimized for four.

### Handicaps

```
Course Handicap  = Index × (Slope ÷ 113) + (Course Rating − Par)
Playing Handicap = round(Course Handicap × allowance%)
Final Strokes    = min(Playing Handicap, cap)          // cap default 18
```

Carry the Course Handicap **unrounded**, apply the allowance, then round exactly once. This is the 2024 WHS behavior — do not round twice.

**Cap the playing handicap at 18 — a house rule for this trip.** Nobody gets more than one stroke on any hole. Apply the cap **last**, after the allowance and after rounding, and store `cap_applied boolean` on `round_players` so it's visible that it bit. Make the cap value a setting (default 18) rather than a constant.

Note that a cap of 18 means the wrap-around allocation below can never fire in practice. Implement it anyway and keep its tests — the cap is configurable, and I don't want the allocation to be silently wrong if I ever raise it.

**Rounding rule:** nearest whole number, with `.5` going **away from zero**. JavaScript's `Math.round` is half-toward-positive-infinity, so `Math.round(-2.5)` returns `-2`, which is wrong here. Implement half-away-from-zero and unit-test a value landing exactly on `.5` and on `−.5`.

**Allowance** defaults to **100%**, configurable. Note on the Rules page that 100% is a deliberate choice for a four-man field — WHS Appendix C recommends 95% for individual stroke-play formats including Stableford. Test at 100% and 95%. (Not 85% — that's the four-ball better-ball allowance and is irrelevant here.)

**Stroke allocation:** distribute the rounded Playing Handicap across 18 holes by stroke index — SI 1 first, SI 2 second, and so on. Above 18, wrap and allocate a second stroke starting again at SI 1 (and a third above 36 — guard the loop so it terminates). For plus handicaps, *remove* strokes starting from the highest-numbered index (SI 18 first, then SI 17); strokes received on those holes is `−1`, so `net = gross + 1`. Test that at the hole level, not just in allocation.

`Net score = gross − strokes received on that hole.`

### Handicap worksheet — make the math auditable

I need to be able to verify these numbers against a printed scorecard, not take them on faith. On each round's page, behind a "Show handicap worksheet" toggle, display the full derivation per player as a table:

| Step | Value |
|---|---|
| Handicap index | 12.4 *(assigned — flagged if so)* |
| Tee played | Black / 7,320 |
| Slope | 135 |
| Course rating | 74.7 |
| Par | 73 |
| Index × (Slope ÷ 113) | 14.82 |
| + (Rating − Par) | +1.7 |
| **Course handicap (unrounded)** | **16.52** |
| × allowance 100% | 16.52 |
| Rounded (half away from zero) | 17 |
| Cap 18 | not applied |
| **Strokes received** | **17** |
| Holes receiving a stroke | SI 1–17 (all but SI 18, hole 7) |

Show the hole list explicitly, and render the strokes-received row on the scorecard so each player's dots are visible per hole. This is the single best defense against a quietly wrong handicap — four people can eyeball it on the first tee in about ten seconds, and any error shows up in the derivation rather than in a leaderboard nobody can check.

Also expose it as part of the admin **"export all scores"** output so the whole trip is reproducible after the fact.

**Players without an established index.** Likely in a group of four. `players.index_is_assigned boolean`. An assigned index renders with a marker on the Players page and is named explicitly on the Rules page ("Adam plays off an agreed index of 14.0, not a GHIN"). This is exactly what the arguments-ending page is for.

### Format: net Stableford

**One format only. Do not build Quota, match play, or anything else.** Points come from each player's **net** result relative to par.

| Net result | Points |
|---|---|
| Albatross or better | +5 |
| Eagle | +4 |
| Birdie | +3 |
| Par | +2 |
| Bogey | +1 |
| Double bogey or worse | 0 |

Higher total wins — a points-accumulation game, not stroke play. Nothing in the UI may imply lower is better. Display points with an explicit `+` prefix (except 0).

**Clamp both ends.** Six discrete values, two open-ended rows: net 3-or-more under par caps at +5; net 2-or-more over is 0. Test a par 5 played in 2, and a hole-in-one on a par 3 by a player receiving a stroke (net −1 → 3 under → +5).

Because Stableford scores relative to par, Black's par 73 does **not** distort the cumulative cross-course total. Say so on the Rules page — it's a real strength of the format here.

Store the six point values in `settings`, editable in admin. There is no format toggle and no `format` column anywhere.

### Handicap snapshotting — and what is retroactive

Handicaps are **frozen per round**. On round setup, write a `round_players` row: `(round_id, player_id, tee_id, index_used, allowance_used, course_handicap, playing_handicap, status)`. Without `allowance_used` a completed round isn't reproducible from its own data.

State this asymmetry plainly in code comments, in admin, and on the Rules page:

- **Point values are retroactive.** They live in `settings` and are applied at compute time, so editing one recalculates every leaderboard instantly.
- **Handicap and allowance changes are not.** They're snapshotted. Changing an index or the allowance affects only future rounds; applying it to an existing round requires an explicit **"Re-snapshot handicaps for this round"** admin action with a confirmation dialog.

`round_players` must be **editable mid-round** — someone plays a different tee than planned, which is very plausible. Changing the tee recomputes course handicap, playing handicap, cap, and stroke allocation, then re-derives all points for that round from the stored gross scores.

**Manual override.** `round_players.manual_override` (nullable integer) lets the group simply agree on a number — "you're getting 12, forget the math." When set, it replaces the computed strokes received entirely. The handicap worksheet must show the computed value alongside the override so it's obvious the math was bypassed, and the round header shows a marker. Null means use the computed value, which is the normal case.

**Create all four rounds' `round_players` rows before the trip**, via an explicit admin screen ("Set tees and confirm handicaps for Round N"). Without that row a device cannot compute strokes received and therefore **cannot score the round offline at all**. Creating them "when a round starts" would be dead on arrival at a first tee with no signal. Loud pre-flight check on the Enter screen if any are missing.

**A player skipping a round** — illness, a flight, a bad back over four straight days. `round_players.status` is `playing` or `did_not_play`. A DNP scores 0 for the round (state on the Rules page), is excluded from that round's holes-won calculation, shows no projection, and is **excluded when computing the common-completed-hole cutoff** for a shortened round. At minimum the app must not crash.

### Shortened and abandoned rounds

February in central Florida is dry season, but fog delays and cold-front squalls happen and lightning horns are non-negotiable at a resort. The hazard isn't the weather — it's that the championship is a raw cumulative sum, so if the horn goes with players thru different numbers of holes, the total is unfair.

`rounds.status` enum: `upcoming | in_progress | final | abandoned`. The two incomplete outcomes are **different**:

**`final` with `holes_counted < 18` — a shortened round that counts.**

- `holes_counted` = the number of holes completed by *every* participating player (DNPs excluded from that calculation)
- Only those holes contribute to championship points
- Scores entered beyond the cutoff are **retained and still visible** on the scorecard, clearly marked as excluded from scoring
- Displays as "R3 — 11 holes" everywhere the round appears

**`abandoned` — excluded entirely.**

- Contributes zero to championship points, round tiebreakers, holes-won, and position-change comparisons
- Not eligible for a round purse unless I manually settle it in admin
- **Scores are still stored and viewable** — we played the holes, we want the card

### Picked-up and unentered holes

Players routinely pick up once they can't score. `gross_strokes = null` must mean "not entered yet," so add an explicit `picked_up` flag: the hole scores 0 and counts toward "thru X." Make it a first-class button in the entry UI.

The two are mutually exclusive and enforced server-side: `picked_up = true` requires `gross_strokes IS NULL`, and a non-null `gross_strokes` requires `picked_up = false`.

**Finalize round** action: lists every null hole and requires the scorer to either enter a score or convert it to picked-up before the round can be marked final. Under Rule 21.1 a no-score-returned is 0 points, but you should have to confirm that rather than discover it on the leaderboard.

### Leaderboards

1. **Overall Championship** — cumulative points across all counting rounds, per-round breakdown, position change vs. the previous round, gap to leader.
2. **Round leaderboard** — one per round, with a leader mark on completed rounds.
3. **Live** — current points, thru how many holes, projected finish.

**Projection:** `points so far ÷ holes played × 18`, one decimal, labeled as a projection. **Suppress it entirely until a player is thru 5**, or one early birdie projects 54 and it looks broken. Never show a projection for a DNP player.

### Tiebreakers — Overall Championship

1. Best single round. If equal, second-best, then third.
2. Most holes won outright — strictly the lowest **net** score on that hole among all players. A shared low score means nobody wins the hole. **A picked-up or unentered hole cannot win** and ranks below any completed score; if fewer than two players completed the hole, nobody wins it. Holes beyond a shortened round's cutoff don't count. Unit-test all of this.
3. **Countback, on the latest counting round in this preference order: Round 3, then 4, 2, 1.** Round 3 (Black) comes first rather than Round 4 because Bone Valley's stroke index may still be placeholder data, which would make countback meaningless. Skip any round that is `abandoned`. **If every round is abandoned, go straight to step 4.**
   - Sum Stableford points for holes 10–18, then 13–18, then 16–18, then hole 18. **Higher points wins at each stage** — this is a points competition, not stroke play, so do not import the lower-is-better convention.
   - **Do not re-apportion handicap** for the partial holes; the per-hole points already include allocated strokes.
   - **If the round is shortened and didn't reach hole 10**, count back from the end of the *counted* holes instead: last 6 counted, then last 3, then the final counted hole. Say which holes were used in the UI.
4. Declared a tie. Co-champions split the championship purse; odd cents to the player with the better single round.

**Round-level tiebreaker** (the chain above is written for the overall, and its first step is meaningless within one round): countback on that round using the same rules, including the shortened-round fallback, then split the round purse.

Always show which tiebreaker was applied, and which holes it used.

### Unit tests — required

- Course handicap across several indexes and slopes, including a plus handicap
- **A worked example verified by hand against a real Streamsong tee** — pick a published rating/slope, compute the expected course handicap manually in a comment, and assert the engine matches. Do this for one tee on each of Red, Blue, and Black, including Black's par 73. If these three pass, the formula is right.
- Allowance at 100% and 95%; rounding happens exactly once, after the allowance
- Half-away-from-zero rounding at `.5` and `−.5`
- **The 18 cap:** an index that computes to 19, 24, and 40 all cap to 18 with `cap_applied = true`; an index computing to exactly 18 caps to 18 with `cap_applied = false`; a plus handicap is unaffected by the cap
- **Cap ordering:** cap applied after the allowance, not before — a course handicap of 24 at 95% allowance rounds to 23 then caps to 18, never 24 → 18 → 17
- Stroke allocation for playing handicaps of 0, 5, 18, 22, 38, and −2 (the last two only reachable with the cap raised)
- Hole-level net for a plus handicap (strokes received `−1`)
- Every row of the points table, including both clamps
- Picked-up holes score 0 and count as played
- Cumulative totals with a mix of complete, shortened, abandoned, and DNP rounds
- Shortened-round cutoff with a DNP player present (DNP must not lower the cutoff)
- Every tiebreaker branch: the round preference order, all rounds abandoned, a shortened round that never reached hole 10, and picked-up holes in holes-won
- Bone Valley fallback: rating known with slope null, and both null

---

## Offline support

Streamsong is forty minutes of orange groves from anything and coverage on the back nine is not something to bet the trip on. **Scoring must work fully offline and reconcile automatically once signal returns.** A round entered in airplane mode has to survive and land correctly.

### What is offline-capable, and what is not

Deliberately split:

- **Offline-capable, through the outbox:** score entry, picked-up flags, CTP results. Nothing else.
- **Online-only, via authenticated RPCs called directly:** everything in `/admin` — players, indexes, tees, scorecards, settings, rounds, itinerary, lodging, purse config, re-snapshotting, round finalization.

Nobody should be editing course definitions from a golf cart, and making admin writes offline-capable would double the sync surface for no benefit. Admin screens must **detect offline and say so plainly** — controls disabled with "Admin changes require a connection," never a silent failure. Score entry stays fully available in the same state.

> **Open question — day-of tee changes. Kyle, answer this in Phase 0.**
> `round_players` edits are admin writes, so under the rule above they're online-only. But a day-of tee change is the one admin write that genuinely happens standing on a first tee with no signal, and without it that player's strokes-received are wrong for the whole round. Options:
> **(a)** Carve tee/handicap changes into the outbox as the single offline-capable admin mutation. More sync surface, but covers the real case.
> **(b)** Keep it online-only and accept that a day-of tee change means waiting for signal.
> Recommend (a) if it's cheap, since the recompute is local anyway — but flag the added complexity and let me decide.

### Local store

Dexie is the local source of truth for the scoring path. The UI reads via `useLiveQuery` and never blocks on the network. Cache on first load and refresh whenever online: all course/tee/hole/yardage data, players, `round_players` snapshots, settings, itinerary, and every score and CTP result for the trip.

### Write queue

Every scoring mutation is:

1. Written to Dexie immediately and reflected in the UI
2. Appended to a durable **outbox** with a client-generated UUID, a local sequence number, and a monotonic timestamp
3. Flushed to Supabase when online, in order

**Timestamps must be monotonic and persisted.** `Date.now()` can move *backwards* on an NTP correction — a real event when a phone reacquires signal after hours in a dead zone. If it jumps back, that device's writes get rejected as stale by its own earlier rows and entries silently revert with no error. Use `ts = max(Date.now(), lastIssuedTs + 1)` persisted in Dexie. `client_id` is a UUID generated once and persisted; note in the README that it resets if site data is cleared.

**Coalesce writes.** The steppers mean a defaulted par-4 taken to 9 generates five writes; four players × 18 holes on a flaky connection is hundreds of round-trips. Debounce ~500ms before enqueuing, and on flush send only the latest entry per `(round_id, player_id, hole_number)`, discarding superseded ones. Safe because payloads are whole-tuple state, not deltas. Provide a batch RPC taking a `jsonb[]` of cells so a round flushes as one request.

**Flush triggers:** `navigator.onLine` going true, successful Realtime reconnect, app foreground/visibility change, and an interval while online.

**Poison items must not block the queue.** Distinguish retryable (network, 5xx, auth-after-reauth) from terminal (4xx validation). After N attempts, move the item to a durable dead-letter store, surface it in the UI, and **continue**. Order per-key, not strictly globally — different holes need not block each other.

**Never permanently delete an unsynced mutation.** A terminal item may be **atomically transferred** from the active outbox to the durable dead-letter store, retaining its full payload, timestamps, attempt count, and last error. Dead-letter items get a **Retry** action and an **Export as JSON** action in Diagnostics. The outbox is the only copy of a round played in a dead zone.

The outbox must survive a hard app kill and a phone restart. Call `navigator.storage.persist()` after a successful unlock so it isn't evicted under storage pressure.

### Conflict resolution — one comparator, four places

Row-level last-write-wins ordered by the tuple `(client_updated_at_effective, client_id)`. Client timestamps, not server clocks, because an offline write may be hours old when it lands.

**Store both timestamps.** `client_updated_at_raw` is exactly what the device sent; `client_updated_at_effective` is `least(raw, now() + interval '5 minutes')`, computed server-side to stop a badly-skewed clock from winning every conflict forever. **The comparator uses `_effective`; `_raw` exists for diagnostics.**

**Whole-tuple replacement only.** The client always sends the complete cell state `(gross_strokes, picked_up)` and the RPC replaces both or neither. **Explicitly forbid `COALESCE`-style partial merges** — with one timestamp per row, a partial merge lets a stale write's non-null column survive beside a newer one and the two devices never converge.

Write the comparator **once** in `src/lib/sync/` and apply the identical tuple ordering in all four places. The spec's whole risk of data loss lives in the three that are easy to forget:

1. **The SQL guard** in the RPC — only overwrite when the incoming tuple wins.
2. **The Realtime handler** — a remote event may only overwrite a local row when it wins the comparator. Never a blind `put`. Without this, an older remote value clobbers a newer local one in the UI.
3. **Hydration and refetch** — on reconnect, **flush the outbox before refetching**, and route the refetch through the comparator. Otherwise a routine refetch on regaining signal wipes 18 holes of unsynced entry, which is exactly the airplane-mode scenario in the Definition of Done.
4. **The pending-write shield** — index outbox entries by `(round_id, player_id, hole_number)`; a remote event never overwrites a row with a pending entry unless it wins outright.

**The RPC must return `{ applied: boolean, row }`.** The natural `INSERT ... ON CONFLICT DO UPDATE ... WHERE <guard> RETURNING *` returns **zero rows** when the guard fails, so the client can't tell "rejected as stale" from "error." Fall back to a `SELECT` of the current winner when the upsert affects no rows.

**When `applied = false`, the loser overwrites its local row with the returned winner** and shows the notice. Without that rollback the two devices never converge.

**Realtime echo:** Supabase has no ignore-self option, so your own writes come back. Use the echo to clear the "unsynced" marker — but **only when the echoed `client_updated_at_effective` is greater than or equal to the newest pending timestamp for that key.** A stale echo from your own device must not clear the marker on a newer pending write; that would show a hole as synced when it isn't. Compare timestamps, not just `client_id`. Apply the echo through the comparator like any other event.

**On DELETE events,** remove the row from Dexie. Nothing in the app deletes scores — corrections set `gross_strokes = null` — but a dashboard edit will emit them.

When a merge overwrites a local value, surface a small dismissible notice on the affected round ("Kyle's hole 7 was updated from another device").

### Unlocking while offline

PIN verification hits the server, so a device that has never unlocked can't score without signal.

- On first successful online unlock, persist the session token **and a local hash of the PIN** in Dexie, so subsequent offline unlocks verify locally. The device already proved knowledge of the PIN, so this adds no meaningful exposure beyond what device access already grants.
- **State the threat model honestly** in the README and in code comments: *local offline PIN verification prevents casual unauthorized access. It does not resist an attacker who obtains the device's local storage, since a six-digit PIN space is brute-forceable offline. That is an accepted tradeoff for a four-person golf trip.* Do not describe it as "secure."
- Session expiry runs through Feb 8, 2027. Use Dexie, **not `sessionStorage`** — that won't survive a force-quit in the cart.
- If a flush fails on auth: **pause the queue, prompt for the PIN, retry.** Stop at the first 401 so you don't half-apply a flush. **Never discard queued writes** — someone mistyping a PIN must not lose 72 cells.
- **iOS ordering matters:** a home-screen PWA can get a storage context separate from Safari, so unlocking in Safari and *then* installing leaves you locked out with no signal. The README and a one-time tip on the Enter screen must say: **install to the home screen first, then unlock inside the installed app**, on hotel wifi, before each round.

### Service worker / PWA

`vite-plugin-pwa` with Workbox, `registerType: 'prompt'`. **Do not set `skipWaiting` or `clientsClaim`** — that combination causes exactly the mid-round auto-reload we're avoiding. Prompt with a "New version available — reload" toast, and gate the accepted update so it can't fire while a flush is in flight.

Precache the app shell, fonts, and hero imagery. Workbox's default `maximumFileSizeToCacheInBytes` is 2 MiB and the default `globPatterns` may miss `woff2`/`avif` — set both explicitly. Add a Netlify `[[headers]]` block serving `/sw.js`, `/index.html`, and the webmanifest as `no-cache`, or a stale shell will pin phones to an old build.

### UI requirements

- Persistent connection indicator: **Online / Offline / Syncing (n)**
- Pending-write count whenever the outbox is non-empty; brief confirmation when it drains
- Unsynced scores marked subtly on the scorecard
- **`navigator.onLine` is unreliable on iOS** — it reports true on a dead cell or a captive portal. Back it with a cheap reachability probe (HEAD against Supabase, short timeout) before declaring Online, and treat consecutive flush failures as offline.
- **Never disable score entry because the device is offline.** Offline is a normal operating mode, not an error. No destructive-sounding copy.

### Diagnostics

"Log to the console" is unactionable on a phone in a cart. A **Diagnostics** screen behind the PIN: client_id, session expiry, last successful sync, outbox contents, dead-letter items with Retry and Export-JSON, and a "copy state as JSON" button. Plus an admin **"export all scores as CSV/JSON."** An hour of work, and the difference between debugging on the 14th at Black and losing a round.

---

## Pages

Fixed bottom tab bar: **Standings · Rounds · Enter · Money · Info**. **Standings is the default landing route.** Home lives at `/` and is reachable by tapping the trip wordmark in the persistent top bar from any page — make that clearly tappable, since it isn't a tab.

### Home

Full-bleed Streamsong hero, group name, dates, and a live countdown to the first tee time on Feb 4, 2027 in `America/New_York`. Until tee times are set, fall back to 8:00 AM ET labeled "tee time TBD."

**Before any scores exist** — which is how it will look for the next six months — Home shows the countdown, the roster with handicap indexes, the four-round schedule, and a link to the itinerary. No empty leaderboard widget, no "no data" placeholder. Once scoring starts it shows current leader, most recent round result, and last-updated timestamp.

### Standings

Overall championship table, per-player round breakdown expandable, cumulative points prominent with gap to leader. **On a tie, every tied player gets the leader treatment** and the position renders as `T1`.

### Rounds

The four rounds with status. Tap in for that round's leaderboard; the full scorecard grid (18 columns × players, gross with net and points, color-coded eagle / birdie / par / bogey / double+); front, back, and total subtotals; and a course header with architect, tees, yardage, rating/slope, and each player's playing handicap.

**A picked-up hole renders as `—` in the gross cell with a distinct muted treatment, `0` in the points cell, and a `PU` legend entry.** It must be visually distinguishable at a glance from both a real score and an unentered hole. Holes excluded by a shortened-round cutoff render with a subtle strikethrough or dimmed column header and an "excluded from scoring" note.

### Enter

Hole-by-hole, all players on one screen:

- Header: hole number, par, yardage, stroke index
- One row per player with large +/− steppers and a big number
- Strokes received on this hole and live points per player
- A "picked up" button per player
- Previous / Next plus a hole picker
- Running "thru X" and current standing in the footer

**The par default is display-only and is never written.** A row is created only on an explicit stepper tap, a picked-up tap, or a confirm. Otherwise paging through 18 holes silently records four pars per hole and poisons every leaderboard. Unentered players render visually muted, and "thru X" counts only written rows.

Writes go to Dexie, then the outbox. Optimistic UI with a sync indicator.

### Money

**Closest to Pin.** State the rule on the Rules page, because this is the money game most likely to be disputed: *closest to the hole with the tee shot; the ball must come to rest on the putting surface; a hole-in-one wins outright.*

- One row per par 3 per course. `distance_feet` with a decimal — name the unit in the column and label the input. No unlabeled "distance" field.
- **No ties.** One winner per hole; re-measure or settle by agreement. Say so on the Rules page. (`ctp_results.player_id` is a single FK, so a tie is structurally unrepresentable — that's deliberate.)
- "No winner" if nobody hits the green, with carry-or-void configurable. **Carries are scoped within a single round and do not cross courses. If a carried pot reaches the last par 3 of a round with no winner, it is returned to contributors.**
- Only a player with `round_players.status = 'playing'` for that round can win a CTP.

**Purse weights — specify these concretely, they are currently the least-defined part of the app.** Defaults, all editable in admin:

| Pot | Weight |
|---|---|
| Overall championship | 40% |
| Round winners | 30% total |
| Closest to pin | 30% total |

- **Round allocation:** the 30% splits evenly across the four *counting* rounds — 7.5% each. An abandoned round's share redistributes evenly across the remaining counting rounds.
- **CTP allocation:** the 30% is allocated **per round in proportion to that round's par-3 count**, so every par 3 across the trip is worth the same. This is what fixes Black's five par 3s versus Red and Blue's four — a flat per-round CTP pot would have made each Black par 3 worth 20% less, and nobody would have noticed until Saturday. Show total CTP money at stake per round on the Money page.
- **Remainder cents** from any division go to the last par 3 of the round (for CTP) or to the player higher in the final standings (for payouts). State the rule in the UI.
- **DNP players still contribute** to that day's pots — they bought in for the trip — but cannot win them. Say this on the Rules page.

**Purse mode is an explicit either/or**, not both: *fixed amounts* (a dollar figure per pot) **or** *buy-in* (each player puts in $X, distributed by the weights above). In buy-in mode total payouts must equal total buy-ins; show a reconciliation line and warn loudly when it doesn't.

**Do not store derived money on `ctp_results`.** Pot values derive from `settings` plus the round's par-3 count so that changing the model doesn't leave historical rows inconsistent. **Snapshot money only when a round is marked `final`** — write the frozen figures to a `round_money` row at that moment. Same principle as handicap snapshotting: derived until finalized, frozen after.

**Ledger arithmetic in integer cents.** Round only at display. Per-payment dollar rounding does not sum back to the net balances — a three-way split of $100 is the obvious case, and it's the bug people notice at dinner.

**Settlement:** greedy net settlement — compute each player's net balance, repeatedly match the largest debtor to the largest creditor. Yields at most n−1 transfers. Greedy isn't provably transaction-minimal in general, so **don't claim "minimum" in the UI** — say "settled down to three payments or fewer."

All values default to $0 so the app works even if we never put money on it.

### Info

**Itinerary** — day by day, Feb 4–7: travel, tee time, course, meals, evening plans. Timeline layout, current day auto-highlighted. Arrival/departure logistics and lodging. **All of this is database-backed and editable in admin** — see the `itinerary_items` and `lodging` tables. Do not put it in `src/config/trip.ts`; that would contradict the source-of-truth rule.

**Courses** — one page each: architect, `year_opened`, yardage by tee, rating/slope, hole-by-hole card, short description.

**Players** — a card per player: name, photo, title, handicap index with `index_updated_at` ("as of Feb 1, 2027") so a stale number is obvious, course handicap for each course, current total, best round, CTP wins.

> **I will supply titles and photos later — do not invent either.** Both nullable, editable in admin. If missing, the card degrades cleanly: no "Title TBD" placeholder, and a monogram initial in place of a photo. It ships empty and gets filled in before the trip, so it must look finished either way.

**Rules** — the net Stableford table, the handicap allowance and rounding rule, the assigned-index note, the CTP rule, the full tiebreaker chain, the shortened-round and DNP rules, the purse weights, and the DNP-contributes-but-can't-win rule. This is the page that ends arguments, so it must be exactly right.

---

## Design direction

**A corporate annual report that happens to be about a golf trip** — sharp and restrained, not a sports app.

- **Palette:** deep navy or near-black ground, warm off-white/cream paper tones, one metallic accent (brass or muted gold) for leaders. Restrained green as a secondary nod to golf — this should not be a green website.
- **Type:** high-contrast serif for headings and figures (Playfair Display, Fraunces, or similar) with a clean grotesque for UI and body. **Tabular numerals wherever numbers appear** — scorecard digits must line up. Self-host and subset the fonts.
- **Layout:** ruled ledger lines, hairline table borders, letter-spaced small-caps section labels. Standings styled like a financial table.
- **Language: plain and functional. No corporate wordplay anywhere in the UI.** Call things what they are — Standings, Rounds, Scorecard, Players, Money, Rules, Itinerary. The visual treatment carries the idea; the copy does not need to wink at it. No "Shareholder Standings," no "Accounts Payable," no "Corporate Bylaws." If a label is ever a choice between clever and unambiguous, pick unambiguous.
- **Motion:** minimal. Subtle count-up on totals, smooth reorder when positions change.
- **Dark mode only.** Push contrast higher than usual — this has to be readable in direct sun.

Reference for structure and mobile feel, not aesthetics: [sawgrassshowdown.com](https://sawgrassshowdown.com), [zpgkiawahgolftrip2026.com](https://zpgkiawahgolftrip2026.com), [bogeystobyrdies.com](https://bogeystobyrdies.com) — note the countdown, bottom tab bar, and dark hero.

---

## Supabase

### Schema

- `players` — id, name, title (nullable), handicap_index, index_is_assigned, index_updated_at, photo_url (nullable), sort_order
- `courses` — id, name, architect, year_opened, description, data_is_placeholder
- `tees` — id, course_id, name, rating (nullable), slope (nullable), par, total_yardage (nullable)
- `holes` — id, course_id, hole_number, par (nullable), stroke_index (nullable) — unique `(course_id, hole_number)`, CHECK `hole_number BETWEEN 1 AND 18`
- `hole_yardages` — hole_id, tee_id, yardage (nullable) — unique `(hole_id, tee_id)`
- `rounds` — id, round_number, date, course_id, tee_time **`timestamptz`**, status enum `upcoming|in_progress|final|abandoned`, holes_counted (nullable)
- `round_players` — round_id, player_id, tee_id, index_used, allowance_used, cap_used, course_handicap (unrounded), playing_handicap, cap_applied, strokes_received, manual_override (nullable), status enum `playing|did_not_play` — unique `(round_id, player_id)`
- `scores` — id, round_id, player_id, hole_number, gross_strokes (nullable), picked_up, client_updated_at_raw, client_updated_at_effective, client_id, updated_at — **unique `(round_id, player_id, hole_number)`**
- `ctp_results` — id, round_id, hole_number, player_id (nullable), distance_feet, client_updated_at_raw, client_updated_at_effective, client_id — **unique `(round_id, hole_number)`** (flows through the same outbox as scores, so replays would otherwise duplicate payouts). **No pot column** — pots derive from settings.
- `round_money` — round_id, frozen purse and CTP figures, written when a round is marked `final`
- `itinerary_items` — id, day (date), sort_order, start_time (`timestamptz`, nullable), category enum `travel|golf|meal|lodging|other`, title, detail, location
- `lodging` — id, property, check_in, check_out, confirmation, notes, and per-player room assignment (either a `player_id` FK or a join table — your call, say which in Phase 0)
- `sessions` — token_hash, created_at, expires_at
- `pin_attempts` — for throttling; see Auth
- `settings` — key/value: point table, allowance, handicap cap (default 18), purse mode, purse weights, purse amounts, CTP carry-or-void

The Info pages require editable lodging, rooms, dining, travel, and daily itinerary. Those tables are why — without them Claude would either put mutable trip data in `src/config/trip.ts`, contradicting the source-of-truth rule, or invent an unreviewed schema mid-implementation.

Use `timestamptz` for tee times and itinerary times — a bare `time` plus a `date` forces manual zone math that will be wrong when devices are in other timezones in transit. Render with an explicit `America/New_York` timeZone, never device locale.

Skip a `trips` table. One trip, four rounds; a 2028 edition would be a fresh deploy. Same for a media table — the hero image is a static asset or a settings key.

### Server-side validation

Enforce all of this in the scoring RPC, not merely in React. A client is not a validator.

- The round exists and is not `upcoming`
- The player has a `round_players` row for that round, with `status = 'playing'`
- The hole exists for that round's course
- `picked_up = true` requires `gross_strokes IS NULL`; a non-null `gross_strokes` requires `picked_up = false`
- `gross_strokes` between 1 and 25 when non-null
- A CTP result may only be entered on a hole whose par is 3
- A CTP winner must be a `playing` participant in that round
- Reject rather than silently coerce, and return a message specific enough for Diagnostics

### Seeds

Seeds go in **idempotent migration files** (`INSERT ... ON CONFLICT DO NOTHING`) with **hard-coded stable UUIDs**, not `supabase/seed.sql` — `seed.sql` runs only on local `db reset` and is **not applied by `db push` to a hosted project**, which produces a production database with schema and zero courses, discovered late. Stable IDs matter twice: phones cache them offline, so a re-seed generating new UUIDs orphans every cached row and every queued write.

### Realtime

Enable on `scores`, `ctp_results`, `rounds`, **and also `settings`, `players`, `round_players`** — a point-value or index edit in admin has to reach four phones, and it won't if those tables aren't published. The client invalidates and recomputes derived views on those events.

In the migration:

- `alter publication supabase_realtime add table ...` — **wrap in a `DO` block checking `pg_publication_tables`**, because adding an already-present table errors and will break a re-run or a partially-applied migration
- `alter table ... replica identity full` so the full old record reaches the WAL for RLS evaluation on UPDATE/DELETE

`postgres_changes` is entirely fine at four concurrent clients. Don't over-engineer toward Broadcast-from-database.

### Auth

Everything is publicly viewable. Score entry and `/admin` sit behind a **shared PIN** — anyone with it can enter and edit scores for **all players**, not just their own. **Use 6 digits, not 4.** Two extra taps, 100× the search space.

**Reads:** RLS on with **explicit permissive SELECT policies for `anon`** on every publicly-readable table (`CREATE POLICY ... FOR SELECT TO anon USING (true)`). Not optional — with RLS enabled and no SELECT policy the tables are readable by nobody, fetches return `[]`, and **Realtime silently delivers zero events** with no error, failing the two-phones requirement invisibly. `sessions` and `pin_attempts` are the exceptions: RLS on, zero policies, `REVOKE ALL FROM anon`.

**Writes:** denied by the *absence* of INSERT/UPDATE/DELETE policies plus `REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon`. All writes route through `SECURITY DEFINER` RPCs taking a session token validated against `sessions`.

- **Pin `SET search_path = ''`** on every `SECURITY DEFINER` function and fully schema-qualify every reference. This is the canonical Supabase privilege-escalation footgun and the database linter flags it.
- `CREATE FUNCTION` grants `EXECUTE TO PUBLIC` by default — `REVOKE EXECUTE ... FROM PUBLIC`, then `GRANT EXECUTE TO anon` on only the intended RPCs.
- **Do not call `supabase.realtime.setAuth(token)`.** That expects a verifiable JWT; handing it an opaque session token fails verification and can knock the socket into a reconnect loop. Under this design the Realtime connection stays on the anon key permanently. (`setAuth` applies only if you instead go the Edge-Function-minted-JWT route — if you propose that in Phase 0, say so explicitly.)

**PIN verification happens in an Edge Function**, not an RPC. A `SECURITY DEFINER` RPC called with the anon key cannot see a trustworthy client IP (`x-forwarded-for` is spoofable), so per-IP limiting inside Postgres is theater. In the Edge Function: real IP, argon2 or bcrypt at a real work factor, and constant error messaging so it isn't a PIN oracle. The PIN hash is an Edge Function secret or lives in a table whose RLS denies `anon` SELECT entirely — never in a publicly-readable `settings` row.

**Throttling must be layered, because a naive global lockout is a denial-of-service against your own group** — one person fat-fingering the PIN could lock all four players out mid-round, which would end the trip's scoring:

- Per-IP throttling as the primary control
- A short global backoff only after a high threshold, never a hard indefinite lockout
- **Failed attempts never invalidate already-issued valid sessions** — a device that unlocked this morning keeps working no matter what anyone else types
- An admin recovery path documented in the README (rotate the Edge Function secret)

**Session hygiene:** tokens ≥128 bits from `gen_random_bytes`, **stored hashed** in `sessions` so a leaked table grants nothing. Admin gets a **"revoke all sessions"** action — otherwise changing the PIN does nothing to already-issued tokens.

### Storage — player photos

Uploads cannot go through a Postgres RPC, and `storage.objects` has its own RLS. Do **not** solve this with an anon INSERT policy on `storage.objects` — that opens the bucket to the entire internet.

Use a **public-read bucket** `player-photos` with **no anon write policy**. Uploads go through an Edge Function that validates the session token and writes with the service-role key, enforcing max 2 MB and `image/*`. A private bucket is incompatible with offline use — signed URLs expire and cached photos would break mid-trip.

If you'd rather avoid the Edge Function: say so, and I'll upload four photos by hand in the Supabase dashboard with `photo_url` editable as text in admin. Either is fine — pick one in Phase 0 and tell me.

Document in the README which key naming the project uses — newer Supabase projects issue `publishable`/`secret` alongside legacy `anon`/`service_role`.

---

## Testing

Every test must be runnable by me with a single documented command. Put them all in the README under "Running tests" and add npm scripts:

```
npm test              # vitest run --reporter=dot   (single pass, quiet)
npm run test:scoring  # vitest run src/lib/scoring  (just the engine)
npm run test:sync     # vitest run src/lib/sync
npm run test:db       # supabase test db            (pgTAP, needs supabase start)
npm run test:all      # everything above in sequence
```

Use `vitest run`, never watch mode, in anything you invoke yourself — a watch process that never exits will hang the session.

**What can and cannot be automated — be honest about this in the checklist.** These four require a human and two real phones, and must be listed as manual tests with dated results, never marked complete on the strength of a unit test:

1. Airplane-mode round entry, force-quit, cold reopen offline, then reconnect
2. Two devices editing the same hole while both offline
3. iOS install-then-unlock ordering
4. Direct API calls with the anon key proving writes are refused and reads are permitted (document the exact `curl` commands in the README so I can re-run them myself)

Beyond the scoring unit tests above:

- `fake-indexeddb` for the Dexie and outbox tests
- Queue survives a simulated app kill and replays in order
- Replaying the same item twice produces one row, not two
- Poison item transfers to dead-letter with payload intact, and the queue continues
- A stale self-echo does not clear the unsynced marker on a newer pending write
- Points and standings compute correctly with the network fully disabled
- Two simulated devices editing the same hole offline converge to the same final state on both
- Every server-side validation rule rejects as specified
- **The LWW guard must be tested against real Postgres** — pgTAP or a plain SQL script against `supabase start` — asserting the stale case returns `applied = false` and leaves the row unchanged. A mocked RPC proves nothing: the comparator exists in both TypeScript and SQL and they must agree exactly, including the `client_id` tie-break.

---

## Deployment

1. Init git, sensible `.gitignore`, real `README.md` — local setup, env vars, Supabase project setup, migrations, the PIN threat model, admin PIN recovery, and the iOS install-then-unlock instruction.
2. Push to a new **private** GitHub repo. Ask me for the name first.
3. Netlify: build command, publish dir, SPA redirect (`/*  /index.html  200`), pinned Node version, the `no-cache` headers block, and env vars. Note that Vite env vars must be `VITE_`-prefixed and are inlined at **build time**, so changing one requires a redeploy — which is exactly why mutable trip data lives in Supabase.
4. Confirm explicitly whether the anon key in the client bundle is safe given the policies you wrote. If it isn't, say so loudly.
5. Note what I'd need to point a custom domain at it.

---

## Definition of done

- All four rounds enterable end to end, hole by hole, from a phone, including picked-up holes
- Round 4 entry is blocked until the Bone Valley card is complete and validated, and unblocks the moment it is
- Changing a **point value** in admin instantly recalculates every leaderboard from stored gross scores; changing an **index or allowance** does not, and requires an explicit re-snapshot
- **Handicaps verify by hand:** for each of Red, Blue, and Black, the worksheet's derivation matches a manual calculation from the published rating and slope, and the strokes-received hole list matches the printed scorecard's stroke index. No playing handicap anywhere in the app exceeds 18.
- Two phones open at once: a score on one appears on the other without a refresh
- **Airplane-mode test:** kill the network, enter 18 holes for all players, force-quit, reopen still offline (standings and scorecard render from cache), then restore the network — everything syncs, no duplicate rows, no lost holes
- Admin screens clearly refuse to write while offline; score entry in the same session stays fully functional
- Stale offline writes never clobber newer data, and the losing device rolls back to the winner
- A refetch on reconnect never wipes unsynced local entry
- Every server-side validation rule is enforced against a direct API call, not just in the UI
- Anon cannot write to any table without a valid PIN session — demonstrate with a direct API call
- Anon **can** read every public table, and Realtime events actually arrive — demonstrate this too
- Failed PIN attempts on one device never lock out a device that already holds a valid session
- Buy-in mode reconciles: total payouts equal total buy-ins, to the cent
- Lighthouse mobile performance and accessibility both above 90 (watch the hero image — responsive AVIF/WebP — and the self-hosted fonts)
- Deployed and reachable at a live Netlify URL
- `docs/spec/acceptance-checklist.md` current, with verification evidence for every line

Build it well. This is going to be up on four phones for four days straight and I'd rather it be over-built than fall over on the 14th at Black.
