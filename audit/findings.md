# Findings

One entry per finding. Format: ID · severity · classification · route/state · repro · expected vs actual · root cause · fix · verification. Nothing is CONFIRMED without an exercised flow; code-reading candidates stay in `log.md` until reproduced.

---

## F-001 · P1 · CONFIRMED BUG — "Save tees" silently converts a did-not-play player back to playing (and DNP cannot be set anywhere)
- **Route / state:** `/admin` → Rounds → Round 3 (in progress, Chris `did_not_play` in seed).
- **Repro:** Unlock admin. On Round 3, without changing any dropdown, tap **Save tees**. Query `round_players` for round 3 → Chris `status = playing`, `manual_override = null`, comparator columns stamped by this client. `/standings` now shows Chris "Not started" instead of "Did not play"; `/rounds/3` shows an empty row for Chris instead of "Did not play".
- **Expected:** Saving tees changes tees (and re-derives strokes) and nothing else. A player who sat the round out stays out. There should be a way to mark a player DNP (brief §"A player skipping a round" — the engine, finalize RPC, cutoff and money logic all support it).
- **Actual:** `RoundsEditor.entries()` hard-codes `status: 'playing'` and `manualOverride: null` for every participant, and the queued RPC upserts the whole row. The status picker was removed 2026-08-22 with no replacement, so DNP is now unreachable from the UI and any existing DNP is destroyed on the next tee save. Consequences: finalize demands 18 holes from the absent player, the shortened-round cutoff and holes-won include them, the Enter screen Save gate waits for their score.
- **Root cause:** `src/components/admin/RoundsEditor.tsx` `entries()`; `saveRoundPlayersQueued` → `rpc_upsert_round_player` (whole-row upsert).
- **Fix (commit `rounds:` on `audit/p1-fixes`):** `src/lib/data/roundSetup.ts` builds the payload from the saved row; `RoundsEditor.tsx` gains a Playing / Did not play select per player and shows DNP in the round-status list. Test `roundSetup.test.ts`.
- **Verification:** local seed, admin → R3 → "Save tees & status" with Chris shown as did not play → DB `round_players` Chris still `did_not_play` (this client's stamp); Enter R3 still shows "Did not play". vitest 192/192.

## F-002 · P2 · CONFIRMED BUG — Round recap dispatch line claims the round winner "left with the week" when they did not take the week lead
- **Route / state:** `/rounds/2` (final). Kyle won R2; Jon still leads the week by 3 (shown two lines lower on the same card).
- **Actual copy:** "Kyle came for the round and left with the week." Contradicts "Jon holds the week lead by 3." on the same card.
- **Root cause:** `compute.ts` `pickDispatch` line ~1428: `if (final && !multi && biggestMove && firstName(biggestMove.name) === leadLabel)` — `biggestMove` is the biggest *position mover* in the week standings, not the new week leader. Any round winner who moved up a place gets this line.
- **Fix:** require the round winner to actually be the week leader after the round (or change the copy to "…and moved up to Nth").

## F-003 · P2 · CONFIRMED BUG (docs vs implementation) — Rules page states handicaps are locked per round; the app reads the index live
- **Route:** `/info/rules` §Handicaps: "Handicaps are locked in per round; a later index change doesn't rewrite a round already played."
- **Actual behaviour:** `buildRoundDetail` reads `players.handicap_index` live (decision 2026-08-22). Editing an index on Admin → Players re-derives points in every round, including finalized ones (only money is frozen). The admin Players tab says exactly this ("applies live to every round in play"). The page whose job is to end arguments states the opposite.
- **Also:** Admin → Settings copy "Handicaps already snapshotted into a round do not move until that round is re-snapshotted" — there is no re-snapshot control any more.
- **Fix:** rewrite the Rules sentence (and the Settings hint) to the live-index rule; or restore snapshotting. Kyle decision on which; the copy fix is P2 regardless.

## F-004 · P2 · USABILITY ISSUE — Money page does not separate confirmed from projected money
- **Route / state:** `/money` with R1/R2 final, R3 in progress, R4 upcoming.
- **Actual:** "1st place overall Jon Aronson $600.00", "2nd place overall Adam Hersh $200.00" and "Round 3 · Round winner Jon Aronson $50.00" are shown identically to the frozen rounds; the per-player ledger's Won/Net columns include all of it (Jon +$450 with a round still live and the championship undecided). The only marker is a small "FROZEN" tag on final rounds. The question "what money is confirmed vs projected?" cannot be answered from the page.
- **Expected:** provisional amounts labelled (e.g. "leading · $50 if it holds" / "projected"), ledger split into confirmed vs projected, or championship lines suppressed until settleable.

## F-005 · P3 · CONFIRMED BUG — Recap "Closest to Pin" reads "carry" for holes with no CTP recorded
- **Route:** `/rounds/1` recap facts: "6 carry · 8 carry · 14 carry · 16 carry" although no CTP row exists for any hole and `ctp_carry_mode` is `return` (carries don't exist in this model). `/rounds/2` shows "17 open" for the par 3 past the cutoff.
- **Root cause:** `RoundRecap.tsx:329` renders `c.name ?? (c.open ? 'open' : 'carry')`; `buildRoundRecap` sets `name: null` both for "no winner recorded" and "not entered".
- **Fix:** distinguish not-entered ("—") from an explicit no-winner ("no winner").

## F-006 · P3 · USABILITY ISSUE — Live recap headline says "share the lead" and "leads by 7" in the same line
- **Route:** `/rounds/3` live: "Jon & Adam share the lead. 17 pts · leads by 7 · proj 23.5". The margin is to third place; with a shared lead the verb should be plural/"7 clear of third".

## F-007 · P3 · USABILITY ISSUE — Rounds list names one "LEADER" for a tied live round
- **Route:** `/rounds` R3 shows "LEADER Jon Aronson" while Jon and Adam are tied on 17. `buildRoundsList` takes `leaderboard[0]` (sort-order tiebreak).

## F-008 · P3 · doc nit — `supabase/functions/.env.example` header names one dev PIN; `scripts/verify-*.sh` default to another, and the working local `.env` accepts the scripts' value
- Not a product defect; it cost one failed unlock during the audit. Align the comment with the committed hash.

## F-009 · P1 · CONFIRMED BUG — A finalized round is still editable and its "frozen" round winner moves with the edit
- **Route / state:** Round 1 `final` (finalized from admin; `round_money` row written, admin says "Final. Money is frozen.", Money page tags the round "FROZEN").
- **Repro:** `/enter` → R1 (selectable, no warning) → hole 17 → Kyle − (5→4) → Save. Server accepts (`rpc_upsert_scores` only refuses `upcoming`). `/money`: Round 1 "FROZEN · Round winner" flips from Jon to Kyle; ledger moves $50 between them; standings 36/35.
- **Expected:** Either a final round is read-only for scoring (with an explicit admin reopen), or "frozen" means the *winner* is frozen too. Today `round_money` freezes only the dollar amount; the payee is re-derived live, so the word "frozen" is false on every surface that uses it.
- **Root cause:** `rpc_upsert_scores` status check (`upcoming` only); `Enter.tsx` blocks only `upcoming`/placeholder; `money.ts` derives the winner live and `RoundMoneyVM.frozen = status === 'final'` is a label only.
- **Decision needed (Kyle):** lock scores after finalize (recommended; corrections go through "Clear scores"/an explicit reopen) vs. keep editable and drop the "frozen" wording.
- **Fix (implemented on the recommended option, reversible — commit `rounds:`):** migration `20260910120000_lock_final_rounds.sql` — `rpc_upsert_scores`/`rpc_upsert_ctp` refuse `final`/`abandoned` (`round_final`/`round_abandoned`, terminal in the outbox); `buildEnterHole` blocks with `round_closed` and Enter points to admin; new `rpc_reopen_round` + "Reopen round" (confirm) in the Rounds editor. Not fixed: the live handicap index still re-derives final rounds (addendum 2) — that is the 2026-08-22 decision and stays Kyle's.
- **Verification:** curl score/CTP on final R1 → `round_final`; Enter R1 shows the closed banner; admin R2 Reopen → `in_progress`, `round_money` row gone → score accepted → re-finalized at 15. pgTAP 241/241 (5 new assertions), `recap-winner.test.ts` covers the client block.

## F-010 · P1 · CONFIRMED BUG — Round recap "WINNER · PAYS" names both tied players while the Money page pays one (countback)
- **Route / state:** R1 with Jon and Kyle tied on 35 (before the F-009 edit). `/rounds/1` recap fact: "WINNER · PAYS Jon & Kyle · $50.00". `/money` Round 1: "Round winner Jon Aronson $50.00" (countback holes 10–18: Jon 18 v Kyle 17 — matches the independent calc).
- **Root cause:** `buildRoundRecap` (`compute.ts` ~1641) defines `winners` as everyone tied on top points and never runs the round countback; `money.ts` `resolveRoundWinner` does. Two surfaces, two payees.
- **Fix (commit `recap:`):** `compute.ts resolveRoundWinnerIds()` is the one resolver; `money.ts resolveRoundWinner` and the recap both read it; `RecapVM.onCountback` → "takes the Red on countback" / ", on countback".
- **Verification:** `recap-winner.test.ts` — level players, decided on the 18th: recap winners = [B], onCountback true, Money pays B; live tie still shares the lead. vitest 192/192.

## F-011 · P2 · CONFIRMED BUG — Round report names the wrong week leader on a points tie
- **Route:** `/rounds/1` report: "Jon leads the week." / "Jon Aronson leads the week at 35, 3 clear of Hersh." while `/standings` ranks Kyle 1st (tiebreak: holes won 4 v 2, matching the independent calc) and `/money` pays Kyle 1st.
- **Root cause:** `report.ts:93` uses `standingsThroughRound(champs, n)` — raw competition ranking with no `breakTie` — then takes the first row (sort order). `buildStandings` applies `compareOverall`.
- **Fix:** derive the week leader from `buildStandings` (or pass `compareOverall` into `standingsThroughRound`).

## F-012 · P2 · FEATURE GAP / USABILITY — Standings never says a tiebreak decided the order; both tied players read "LEADER"
- **Route:** `/standings` with Jon/Kyle both on 35: rows show "1 Kyle … 35 LEADER" and "2 Jon … 35 LEADER" (gap 0 renders LEADER regardless of position). No "T1" (brief: "position renders as T1" for a genuinely shared place) and no "decided by holes won / countback R1 10–18" copy (brief: "Always show which tiebreaker was applied, and which holes it used"). `compareOverall` returns only a sign, so the UI has nothing to show.
- **Fix:** surface `decidedBy` (stage + holes) from the standings builder; render "T1" only for unbreakable ties; gap label should key off position, not points.

## F-013 · P2 · CONFIRMED BUG — A stale write is rolled back silently; the button says "Saved"
- **Route / state:** R1 hole 18, Chris's cell already held by another client with `client_updated_at_effective` = now+5 min (the server clamp). On this phone: Chris + (5→6) → Save.
- **Actual:** server answers `stale`; Dexie adopts the winner (5); the number on screen snaps back to 5; the button reads "Saved"; no message anywhere. The scorer believes 6 was recorded.
- **Expected (brief):** "When applied = false, the loser overwrites its local row with the returned winner *and shows the notice*"; also "surface a small dismissible notice on the affected round ('Kyle's hole 7 was updated from another device')". Neither exists.
- **Root cause:** `outbox.ts settle()` treats `stale` as settled with no signal to the UI; `mutations.ts` publishes `idle`; no merge-notice component.

## F-014 · P2 · CONFIRMED BUG — Cached scores survive a server-side delete; a phone that misses the Realtime DELETE keeps ghost rows forever
- **Repro:** with the app open, delete all `scores` server-side (as admin "Clear scores" does per round). Realtime removed the 12 `round_players` rows but the local `scores` table still held 170 rows after the hydrate refetch (`mergeStampedRows` only ever `put`s). `rounds` refreshed to upcoming so the ghosts were invisible — until a round is started, when they would render as that round's scores and block Enter's Save gate ("No changes").
- **Also observed:** with 170 deletes in one transaction the open page received none of the `scores` DELETE events (all 12 `round_players` deletes arrived) — Realtime's per-client event rate limit is the likely cause, so even an online phone can miss a bulk clear.
- **Fix:** on hydrate, reconcile deletions for rounds/tables the server returned (delete local stamped rows for a round that has no pending outbox entry and is absent from the fetch), or have "Clear scores" bump a `rounds` marker the client uses to purge.

## F-015 · P3 · USABILITY — Admin "Start round" refusal text stays on screen after the tees are saved
- The server refusal "· no tees or handicaps are set for this round" remained under the fresh "· Tees saved." until the next lifecycle action. Cosmetic.

## F-016 · P3 · USABILITY — Money pot summary mislabels a pooled 1st/2nd tie
- **State:** Jon & Kyle genuinely tied 1st on 71 (unbreakable: identical round points, holes won 4–4, every countback stage level — matches the independent calc). `/money` PotSummary: "1st place overall Jon Aronson & Kyle Siegel $600.00" and "2nd place overall (no name) $200.00", while the ledger correctly gives each $400. The summary should say the two share $800 ($400 each) and drop or mark the 2nd line.

## F-011 (addendum, R2 evidence)
- `/rounds/2` recap "THE WEEK" block: "Jon seizes the week lead — 2nd to the overall lead." (garbled and false — the lead is shared); report: "Jon takes the week lead." / "Jon Aronson leads the week at 71, 1 clear of Hersh." while Standings, Home and Money all show a shared lead. Same root cause (raw `standingsThroughRound`, first row by sort order).

## F-012 (addendum)
- A genuinely shared 1st on `/standings` and Home renders as "1 … LEADER" twice — no "T1" as the brief specifies.

## F-017 · P2 · CONFIRMED BUG — Admin's offline gate uses the Phase-1 `navigator.onLine` stub, not the reachability probe
- **Repro:** stop the local API gateway (link stays up). Badge reads OFFLINE (probe), Enter queues writes, Diagnostics says reachability offline — but `/admin` renders fully unlocked with every control enabled and no "Admin changes require a connection" banner.
- **Root cause:** `src/hooks/useOnlineStatus.ts` — the file's own comment says "STUB for Phase 1 … Phase 6 replaces this with a reachability probe"; it never was. `src/lib/sync/reachability.ts` already exposes `getReachability`/`subscribeReachability`.
- **Impact:** on a dead cell (`onLine === true`) admin controls look live; a tap fails with the generic "No connection" error instead of the designed disabled state. Brief: "Admin screens must detect offline and say so plainly — controls disabled".

## F-018 · P2 · FEATURE GAP — No unsynced marker on the scorecard / round page
- With 5 cells queued (badge "5 TO SYNC"), `/rounds/3`'s scorecard and recap show nothing per cell or per player; only the badge and Enter's "(N holes waiting)" say anything. Brief §UI requirements: "Unsynced scores marked subtly on the scorecard".

## F-019 · P3 · CONFIRMED BUG — Round report compares against a DNP round as if it were 0 points played
- `/rounds/3` report: "Chris Denove posted 19, 19 better than at Black, the biggest jump of the day." Chris sat out Black (DNP). `report.ts` "biggest jump on the previous counting round" should skip DNP rounds.

## F-020 · P3 · USABILITY — Finalize refusal lists a count of missing holes, not which holes
- "Jon Aronson is missing 2 hole(s)" ×4. Brief: "lists every null hole". On a shortened round the scorer needs the hole numbers to know whether to enter or set the cutoff.

## F-009 (addendum) — queued-offline write lands on a finalized round
- Hole 17 queued with the API down, round finalized server-side at 14 holes, API restored: the 4 cells landed on the `final` round without refusal. Here they fell past the cutoff (excluded "–"), but a queued correction to a counted hole would have moved the frozen winner exactly as in the main F-009 repro.

## F-021 · P1 · CONFIRMED BUG — An expired admin session turns queued tee changes into a silent retry-until-dead-letter, while the editor says "Tees saved."
- **Repro:** expire the device's session server-side (the same thing happens at the natural expiry or after "revoke all sessions"). `/admin` → Round 4 → Save tees. Editor: "· Tees saved." (green). Badge: "4 TO SYNC". `/diagnostics`: SESSION "Server token held"; Outbox 4 × `round_player`, "2 attempts · invalid or expired session"; attempts climb on every flush trigger (interval 60 s, visibility, Realtime resubscribe) and at 8 they transfer to dead letter. No PIN prompt is raised by the flush path; only an admin `call()` (e.g. Start round) notices 28000 and locks.
- **Expected (brief):** "If a flush fails on auth: pause the queue, prompt for the PIN, retry. Stop at the first 401 … Never discard queued writes." And the editor must not report success for a change the server refused.
- **Root cause:** `outbox.ts` treats the 28000 refusal as a generic retryable `TransportError` (`penalise`); `saveRoundPlayersQueued` reports ok whenever nothing dead-lettered *this pass*; `readToken()` only checks the local expiry date; Diagnostics reads the same local flag.
- **Fix (commit `outbox:`):** `isAuthRefusal()`; a `round_player` batch refused with 28000 costs no attempt, `lock()`s the local session, sets `FlushReport.authExpired`, later batches with the dead token are skipped; `saveRoundPlayersQueued` reports it instead of "Tees saved."
- **Verification:** `authexpiry.test.ts` (3): zero attempts after 9 flushes, session cleared, no dead letter; the same entry sends after the next unlock. vitest 192/192.

## F-009 (addendum 2) — an index edit after the trip re-derives every finalized round and moves the frozen money
- Admin → Players: Jon 9.2 → 10.0 → Save. All four `final` rounds re-derived (Standings 139/138/137/63), R1's "FROZEN" winner became "Jon & Kyle", R3's became Jon, settlement changed. Reverted to 9.2 (state restored). This is the live-index decision (2026-08-22) meeting the "frozen" label: the only thing frozen is the $50 figure. The Rules page still claims the opposite (F-003).
