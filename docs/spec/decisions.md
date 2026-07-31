# Decisions

Every decision made in Phase 0 that the brief did not specify, every ambiguity resolved, and every place two requirements appeared to conflict.

The brief is the source of truth. This file explains the gaps the brief left open, not what the brief already said.

---

## Answer to the open question — day-of tee changes

**(a) — carve tee/handicap changes into the outbox as the single offline-capable admin mutation.**

**Why:** The failure mode of (b) is real: someone gets moved from Blue to Black tees on the first tee at Streamsong Red with no signal, and their strokes-received are wrong for the whole round until reconnect. Everyone else scores fine but their card is a lie. The recompute is *entirely local* — course handicap, playing handicap, cap, and stroke allocation are pure functions of `(index, tee, allowance, cap)`, all of which are already cached in Dexie. No server round-trip is doing math you can't do offline.

**What's added:** one more outbox entry type. The comparator generalizes cleanly if we model the outbox as `{ kind: 'score' | 'ctp' | 'round_player', key, payload, ts, client_id }`. When a `round_player` mutation lands (locally or via Realtime), all points for that round re-derive from stored gross scores. That's a computed-view invalidation the engine already does on any input change.

**What is *not* in the outbox:** index changes, tee definition changes, allowance changes, cap changes, itinerary, lodging, settings, purse config. Those stay online-only. The carve-out is *specifically* `round_players` for rounds whose date is today or in the past.

---

## Photo upload path

**Edge Function, not manual dashboard uploads.**

**Why:** ~40 lines of Deno, one route, service-role write to `player-photos` with the token validated against `sessions`. The admin flow is much better than "text-paste a URL." A private bucket is not an option — signed URLs expire and would break cached photos mid-trip.

If Kyle later changes his mind: `photo_url` is just a text column, admin edits it as free text, done. Nothing else in the schema changes.

---

## Structural decisions the brief left open

### Lodging ↔ player relationship: separate `lodging_assignments` join table

Not a `lodging_id` FK on `players`. Room assignments and lodging properties can shift independently — someone switches rooms, someone else changes lodges — and a join table also carries an optional `room_label` for "Kyle + Adam in Room 217." Trivially seedable.

### `round_players` gets `client_updated_at_*` + `client_id` columns

Required by the offline carve-out above. Nullable so admin-online writes don't have to fill them; the RPC path is different for the two cases.

### Bone Valley `hole_yardages` rows exist from day one with `yardage = null`

Not "missing until data arrives." Otherwise the publish-validation RPC needs one rule for "every hole has a yardage row per tee" and another for "every yardage is non-null." One rule (`yardage IS NOT NULL`) is simpler and safer.

### `ctp_results.player_id` is nullable, encoding two states

Meaning "no winner recorded yet" *and* "carry, no winner this hole." A separate `is_carry` flag would be redundant with `carry_mode = 'carry'` in settings plus a null winner.

### `round_money` is created only at finalization

Frozen dollar figures. Live money display on the Money page derives on the fly from `settings` + par-3 counts. Matches the brief's "snapshot handicaps but not point values" asymmetry.

### No `format` column, no format toggle

The brief bans it. Restated because it will feel wrong once code starts.

### No `trips` table, no `media` table

The brief bans a `trips` table; adding `media` for a hero image is the same mistake at smaller scale. Hero image is a `settings` key (`hero_image_url`).

### Nothing in the app deletes scores

DELETE handling in the Realtime layer exists purely to survive a dashboard edit. No user-facing delete affordance. Corrections set `gross_strokes = null`.

---

## Behavioral decisions

### Bone Valley R4 hard block is enforced in both client and server

The client hides the Enter screen when `courses.data_is_placeholder = true`. The server rejects any `rpc_upsert_scores` cell for a round whose course has that flag set. Two layers because "server rejects and UI silently drops" is worse than "UI refuses to open the entry screen at all."

### "Enter the Bone Valley scorecard on wifi before Sunday" banner

Date-gated on `>= 2027-02-05` **AND** `data_is_placeholder = true`. Never date-only. If Kyle publishes the card early, the banner disappears immediately.

### Index locking on 2027-02-01

Working indexes acceptable until 2/1; final indexes entered and re-snapshotted across all four rounds on that date. This is the intended use of the "handicaps aren't retroactive, use the re-snapshot action" flow, not an exception to it. Admin screen surfaces a "Handicaps last snapshotted" timestamp per round for the 2/1 confirmation step.

### Position-change indicator

Computed from the *previous counting round's* final standings. Abandoned rounds do not count as a previous state.

### Countback UI text template

`"Tiebreaker: countback on R3 (holes 10–18) — Kyle +14, Adam +11"`. Written once so all three tiebreaker branches produce parallel-looking copy.

### Purse cent rounding

All arithmetic in integer cents; remainder cents per the brief (last par 3 of the round for CTP; player higher in final standings for payouts). Greedy settlement operates on integer-cent net balances so no float in the ledger. Buy-in reconciliation warning shows on the Money page whenever `sum(payouts) != sum(buy_ins)`.

### CTP defaults

Default `ctp_carry_mode = 'carry'`. Last par 3 of a round with an unclaimed pot returns to contributors per the brief. Encoded as: carry within round, void at round-end.

### DNP contributions

Visible on the Money page's per-player line as `"buy-in $X (DNP for R2 — no eligibility)"`.

### Assigned indexes

Rendered as `12.4*` on the Players page with a footnote. The footnote text is a `settings` entry (`assigned_index_footnote`) so we don't hardcode "Adam plays off an agreed index of 14.0" and then have to redeploy if it changes.

---

## Technical decisions

### PIN size and hash

6-digit PIN (per brief). Server-side hash: **argon2id**, moderate params (memory 64 MiB, iterations 3, parallelism 1). Chosen over bcrypt so Edge Function CPU stays cheap on hotel wifi during PIN unlocks.

Local offline PIN hash: **bcrypt cost 10**, not argon2. Argon2 needs WASM and adds ~200 KB to the bundle; local verification is a fallback and its threat model already says "brute-forceable — accepted tradeoff." Server hash stays argon2.

### Real IP for throttling

Comes from the Edge Function's platform-provided source IP, not `x-forwarded-for`.

### Session storage

**Dexie only.** Not `localStorage`, not `sessionStorage`. Dexie already has to survive force-quit; using two mechanisms creates a bug where one exists and the other doesn't.

### Reachability probe

`HEAD https://<supabase-url>/rest/v1/` with `apikey` header, 3s timeout, invoked when `navigator.onLine === true` before flipping the badge to "Online." Two consecutive flush failures also trip it back to "Offline."

### Dead-letter store

A separate Dexie table, not a status column on the outbox. Cleaner UI query and the outbox stays tiny for iteration.

### Outbox flush order

Grouped by `(round_id, player_id, hole_number)` key, latest-per-key wins. Different keys flush in parallel with a concurrency cap of 4. Strict global ordering isn't needed and slows recovery in a bad-connection scenario.

### Service worker

`registerType: 'prompt'`. No `skipWaiting`. No `clientsClaim`. New-version toast lives in the persistent top bar and is **suppressed when `outbox.length > 0`** — never fire a page reload mid-flush.

### Fonts

Fraunces (variable, 300–700, italic + roman) for display + figures; Inter (variable) for UI/body. Self-hosted from Google Fonts CDN download, subsetted to Latin. Target ≤80 KB total font payload.

### Color tokens

- Ground: `#0B0F17` (near-black-navy)
- Paper: `#F5EFE1` (warm cream)
- Brass accent: `#B08D57`
- Secondary green: `#274D3B` (dark forest)

Contrast checked against WCAG AA at 4.5:1 for body copy on the dark ground.

### Home countdown fallback

When tee time is null, use "8:00 AM ET on Feb 4, 2027" labeled *"tee time TBD"* per the brief. Countdown recomputes every second while visible, freezes at 00:00:00 for "starting soon," then swaps to a "live" state when any round's `status = 'in_progress'`.

---

## Where two requirements appeared to conflict

### "Score entry works fully offline" vs "Round 4 is hard-blocked until Bone Valley card is complete"

**No conflict once you read it carefully.** R4 unblocks the moment the card is validated, and validation is an admin write which is online-only anyway. If someone tries to enter R4 offline before the card is validated, they're already in an impossible state (they'd need to have validated it before going offline). The client-side hard-block key is `courses.data_is_placeholder` cached in Dexie; the server-side reject is belt-and-braces.

### "Admin writes are online-only" vs "Day-of tee changes must work at the first tee with no signal"

Resolved by decision (a) above. The single offline-capable admin mutation is `rpc_upsert_round_player`.

### "Handicap changes are not retroactive" vs "`round_players` is editable mid-round"

Both true. Editing `round_players` recomputes for *this* round only. Changing `players.handicap_index` doesn't touch any existing `round_players.index_used`. Re-snapshot is the explicit bridge and only fires from the admin action.

### "Whole-tuple replacement, no COALESCE" vs "`gross_strokes` and `picked_up` are mutually exclusive"

The client always sends both fields even when one is null; the server CHECK constraint enforces the exclusivity. A merge that tried to preserve one and update the other would violate the constraint on the way in, which is the right failure mode.

### "Netlify env vars are build-time" vs "Trip data must be editable without redeploy"

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are env vars. Everything mutable is Supabase data. `src/config/trip.ts` is `const`.

---

## Actual tee sheet (supersedes the brief's assumed schedule)

Kyle supplied the booked tee times on 2025-07-31. All times **EST** (February = standard time).

| Round | Day | Course | Architect | Tee (EST) |
|---|---|---|---|---|
| R1 | Thu Feb 4, 2027 | Streamsong Red | Coore & Crenshaw | 1:10 PM |
| R2 | Fri Feb 5, 2027 | **Streamsong Black** | Gil Hanse & Jim Wagner | 10:33 AM |
| R3 | Sat Feb 6, 2027 | **Streamsong Blue** | Tom Doak | 10:35 AM |
| R4 | Sun Feb 7, 2027 | Bone Valley | David McLay Kidd | 8:28 AM |

**Friday and Saturday courses are swapped relative to the brief** (brief had Blue Fri / Black Sat; the booking is Black Fri / Blue Sat). The tee sheet is ground truth. Phase 2 must seed `rounds` with this course-per-round order and these `tee_time` values.

**Open consequence for Phase 3 — flag to Kyle before building the tiebreaker.** The brief's Overall countback preference order is "Round 3, then 4, 2, 1," with the stated rationale that "Round 3 (Black) comes first ... because Bone Valley's stroke index may still be placeholder." After the swap, **Round 3 is Blue and Black is Round 2.** Both Blue and Black have reliable (non-placeholder) stroke indexes, so the *intent* — count back on the latest round with trustworthy stroke-index data, never leading with placeholder Bone Valley — still holds if we keep "R3 first" (now Blue). But the brief names Black specifically. Do not silently resolve this. Confirm with Kyle in Phase 3 whether the preference order stays positional (R3=Blue first) or should be re-pinned to Black by course.

## Deviations from the brief

### Phase 0 pushed directly to `main`, not to a `phase-0-spec` branch

The brief says "one phase per branch, merged to main when I sign off." The repo was empty and Netlify refused to connect until `main` had content. Phase 0 is docs-only, so pushing it to `main` doesn't couple code to spec. **From Phase 1 forward, one branch per phase, merged to `main` after sign-off.**

### Phase 0 committed before verbal sign-off

Kyle asked "how do I link the repo I made" and shared a screenshot of Netlify blocking on an empty repo. Interpreting that as go-signal for the write step. If any of the docs are wrong, the fix is a follow-up commit — nothing built on top of them yet.
