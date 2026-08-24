# Decisions

Every decision made in Phase 0 that the brief did not specify, every ambiguity resolved, and every place two requirements appeared to conflict.

The brief is the source of truth. This file explains the gaps the brief left open, not what the brief already said.

---

## Play off the low handicap (amends the brief's full-handicap Stableford)

**Kyle 2026-08-22.** Strokes are allocated **relative to the round field's lowest playing
handicap**: the low player is scratch and everyone else receives only the difference (Adam 8 /
Kyle 12 → Adam 0, Kyle 4, on stroke index 1–4). This **overrides** the brief's full-handicap
net Stableford (brief §Handicaps, "100% allowance", and §"Do not build … match play") — the
brief allocated each player's full playing handicap.

- Still net **Stableford** and still cumulative; only the per-round stroke allocation changed.
- Computed **per round** over **playing** players only — a DNP player neither sets the floor nor
  receives strokes. The cap (18) and any manual override apply to a player's OWN strokes first,
  then the field low is subtracted; the low is never negative in effect (max(0, own − low)).
- Implemented once, in `buildRoundDetail` (`compute.ts`), which is the single round-level
  allocation feeding the round screen, the Enter screen, round winners, the champion chain, and
  the money page. `buildChampionships` now reads its points from `buildRoundDetail` (was a
  separate `roundPointsFor` allocation) so the cumulative board uses the same numbers.
- The worksheet shows the subtraction ("− Low handicap in field"); the Rules page states it.
- Purely a compute change — no migration, no re-entry of scores; points re-derive from stored
  gross. Covered by `relative-strokes.test.ts`.

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

Default `ctp_carry_mode = 'return'` (Kyle 2026-08-22, "you either get it or you don't"). Every par 3 is decided on its own hole: won by the closest player, or, with no winner, its pot returns to the buy-in contributors — never carried forward. **Amended from the original `'carry'` default** (which rolled an unclaimed pot to the round's next par 3 and only returned it at the round's last par 3). Migration `20260822090100_ctp_no_carry_default.sql` flips already-seeded databases; the code defaults (`money.ts`, `compute.ts`) match. `buildMoney` treats any mode other than `'carry'` as return-to-contributors.

### DNP contributions

Visible on the Money page's per-player line as `"buy-in $X (DNP for R2 — no eligibility)"`.

### Assigned indexes

Rendered as `12.4*` on the Players page with a footnote. The footnote text is a `settings` entry (`assigned_index_footnote`) so we don't hardcode "Adam plays off an agreed index of 14.0" and then have to redeploy if it changes.

---

## Technical decisions

### PIN removed from score entry (2026-08-17, supersedes the brief)

**Decision.** Score entry and CTP entry are open — no PIN, no session. The Enter screen
gets an explicit **Save** button per hole in place of the lock. `/admin` keeps the PIN, and
so does `rpc_upsert_round_player`.

**Kyle's reasoning, in his words:** *"I dont want a pin - just a hole by hole save button."*
Asked whether it should come off `/admin` too, he chose entry only.

**Why the line falls where it does.** It is not an arbitrary carve-out — it is the same
line the brief already draws between offline-capable and online-only writes:

| Write | Gate | Why |
|---|---|---|
| `rpc_upsert_scores` | none | The hot path, four people in a cart. |
| `rpc_upsert_ctp` | none | Entered at the same moment, in the same cart. |
| `rpc_upsert_round_player` | PIN | It rewrites handicaps; a wrong stroke allocation silently corrupts every leaderboard. Offline day-of changes still need it, so Phase 6's local PIN hash is still required. |
| every admin RPC | PIN | Course cards, points table, purse, finalize, abandon, re-snapshot. |

**Accepted exposure, stated plainly.** Anyone who has the URL can write scores. There is
no rate limit on score writes and no audit of who wrote what beyond `client_id`. The
mitigations that remain are: the server-side validation rules (a score still has to be a
legal score, on a real hole, for a player actually playing that round); nothing in the app
deletes scores; and the URL is not linked from anywhere. **This is not protection against
a determined stranger — it is the absence of protection, chosen deliberately** because the
realistic threat to a four-person golf trip is a mistyped PIN at the first tee, not
vandalism.

**What was kept rather than deleted.** The `pin-verify` Edge Function, `sessions`,
`pin_attempts`, the throttle functions and `fn_require_session` all stay — `/admin` uses
them from Phase 5B. Re-gating score entry later is a one-line change: restore the
`session_token` parameter and the `perform public.fn_require_session(...)` call.

### Starting a round (`rpc_start_round`, added in Phase 5B)

`schema.md`'s RPC list had no way to move a round from `upcoming` to `in_progress` —
`rpc_upsert_round` deliberately cannot touch `status`, and only finalize and abandon moved
it. But the Enter screen refuses an `upcoming` round and tells the scorer to "start it from
admin," so the app described a door that did not exist. Added `rpc_start_round(session_token,
round_id)`, session-gated like every other admin RPC. It enforces the same two preconditions
the Enter screen checks — the course card must be published, and the round must have
`round_players` rows — so starting a round is also the moment those get caught.

### Publishing a course also requires a rating and slope on every tee

The brief's four publish checks are about the hole card (par, stroke index, the 1–18
permutation, yardages). They say nothing about `tees.rating` / `tees.slope`, both nullable
for Bone Valley. But publishing is precisely what unblocks scoring, and `fn_compute_handicap`
falls back to slope 113 when slope is null — so a card could pass all four checks, publish,
and hand every player a quietly wrong stroke allocation with nothing on screen looking odd.
`rpc_validate_and_publish_course` therefore adds a fifth check, and `courseCardIssues()` in
`compute.ts` mirrors it so the Enter screen and the admin editor say the same thing.

### A new course starts as a placeholder; editing a hole un-publishes the card

Two consequences of the same idea — `data_is_placeholder = false` should mean "this card was
validated," not "nobody has said otherwise."

* `rpc_upsert_course` creates new courses with `data_is_placeholder = true`. A course with no
  holes yet is exactly the state the flag describes, and it means a new course cannot be
  scored by accident.
* `rpc_upsert_hole` sets the flag back to `true` on any edit to a published card. A card
  whose par just changed is no longer a validated card. This *does* stop scoring mid-round
  until someone re-runs Validate & publish — one extra tap, loudly, versus a silent typo
  re-deriving four leaderboards. The course editor says so above the fold.

Only `rpc_validate_and_publish_course` may clear the flag, as the brief requires.

### `round_money.championship_share_cents` is this round's share, not the whole pot

The column names are ambiguous: `round_money` is per round, but the championship pot is not.
Read as "the whole championship pot, snapshotted at this round's finalization," summing the
four rows would quadruple-count it. It is therefore **this round's even share of the
championship pot** — `allocateEvenCents(championshipTotal, countingRounds)`, remainder to the
earliest round. All three money columns are then per-round and additive, and the four rows sum
back to the trip's pots exactly. `round_purse_cents` and `ctp_pot_cents` were already
per-round in the brief's model.

`fn_allocate_even_cents` and `fn_allocate_proportional_cents` are line-for-line mirrors of
`allocateEvenCents` / `allocateProportionalCents` in `src/lib/scoring/money.ts`, including
where the remainder cents land. Same cases are asserted in both languages, because a
one-cent disagreement between the frozen figure and the Money page's derivation is an
argument at the end of the trip.

### Admin `round_players` writes stamp the comparator columns

`rpc_upsert_round_player_admin` has no comparator — it is the online-only pre-flight path. But
it writes the same rows the offline outbox variant writes, so leaving
`client_updated_at_*` / `client_id` null would make a deliberate admin write **lose** to any
older cart write that happened to arrive afterwards. It stamps `now()` and a sentinel
`client_id` of `ffffffff-ffff-4fff-8fff-ffffffffffff` — deliberately high-sorting, so an exact
timestamp tie goes to admin, and admin writes are identifiable in an export.

### `rpc_upsert_settings` is a whitelist with a shape check per key

Settings are read by the scoring engine at compute time and are retroactive, so a malformed
value silently rewrites every leaderboard on the trip, and a typo'd key writes a row nothing
reads. The RPC therefore rejects unknown keys outright and validates the shape of each known
one (all six `points_table` bands present and numeric; `allowance` in (0, 1]; a whole-number
`handicap_cap`; the `purse_mode` and `ctp_carry_mode` enums). Note the `jsonb_typeof(...) IS
DISTINCT FROM 'number'` form — a plain `<>` returns NULL for a *missing* key and would let it
through.

### Offline costs no retry attempts (Phase 6a)

A flush that fails because the request never reached the server does **not** count an
attempt against any queued item, and stops the pass rather than penalising the rest of the
batch. Without this, the brief's own scenario destroys itself: four hours in a dead zone
with a 60-second flush interval burns an eight-attempt budget in eight minutes and
dead-letters an entire round that no server ever refused. Only an answer *from* the server
— a 5xx, or a refusal on the merits — is allowed to cost anything.

The classification is `OfflineError` (never landed) vs `TransportError` (landed, went
wrong) in `src/lib/sync/outbox.ts`, and offline is recognised by message shape because
supabase-js hands fetch failures back as a returned error object rather than throwing.

### The server's row replaces our optimistic row, clamp and all

`enqueueScores()` writes the local row with `client_updated_at_effective = raw`, because the
client cannot compute the server's `least(raw, now() + 5 min)` clamp. That guess must be
corrected, or a phone whose clock is an hour fast keeps a local row that out-ranks every
later write from every other phone forever.

So an acknowledged row is written back **unconditionally when it is our own optimistic copy**
(same `client_id`, same `client_updated_at_raw`), and through the comparator otherwise — a
Realtime event from another device can land between the request leaving and the response
arriving, and the response is then a snapshot of an older moment. Both cases are asserted in
`src/lib/sync/outbox.test.ts`.

### Retry budget: 8 attempts; terminal refusals skip it entirely

The RPCs answer with a closed vocabulary of refusals (`round_upcoming`,
`player_not_playing`, `gross_strokes_out_of_range`, …). Those are verdicts, not outages:
retrying cannot change the answer, so the item transfers to `dead_letter` on the first one
and the queue continues. Everything else gets 8 attempts. `'stale'` is neither — it is a
**settled** outcome: the server's row is newer, it comes back in the same response, and the
loser adopts it. A stale write is not a failed write.

### `ctp_results` mirrored into Dexie in 6a, ahead of its UI

The CTP entry screen is Phase 7, but `ctp_results` is now a Dexie table, is fetched by the
hydrate, is merged through the comparator, and flows through the outbox as `kind: 'ctp'`.
The brief requires the local store to cache "every score and CTP result for the trip", and
building the second outbox kind while the first is being designed is what keeps the queue
genuinely general instead of a scores queue with a `kind` column. It is covered by tests;
what Phase 7 adds is the screen.

### The pending-write shield is applied at hydration too, not just at Realtime

The brief names the shield as its own site (4) alongside hydration (3). In practice hydrate
needs both checks — beat the local row **and** beat anything still queued for that cell —
because the local row and the queued entry can disagree after a rollback. `mergeStampedRows()`
in `src/lib/sync/merge.ts` applies them together, and lives outside `hydrate.ts` so it can be
tested with no network in the loop.

### `28000` answers 403, not 401

Recorded in the Phase 5A checklist and repeated here because two source comments claimed 401:
this PostgREST maps `28000` (what `fn_require_session` raises) to **HTTP 403**, and `42501`
(a table-level permission denial) to 401. Both are refusals. The comments have been corrected.

### RESOLVED — the brief's "Black has five par 3s" is wrong; the seed was right

**Raised** during Phase 5B: the brief (§"Two things that look like data-entry errors but are
not — do not 'correct' them") says *"Black has five par 3s; Red and Blue have four each,"*
and uses that to motivate weighting the CTP pot by par-3 count. The Phase 2 seed said four.

**Settled 2026-08-17** against the resort's official 2021 scorecards, which Kyle supplied.
**The brief is wrong and the seed is right.** Black has **four par 3s** (holes 5, 7, 15, 17)
and **five par 5s** (holes 1, 4, 10, 12, 18). 4×3 + 9×4 + 5×5 = 73, so par 73 is correct —
the extra stroke is the fifth par 5, not a fifth par 3. The brief almost certainly
transposed the two.

Rather than settle it by eye, all three cards were transcribed and diffed against the
database: **0 discrepancies across 54 hole pars, 54 stroke indexes, 12 tee rating/slope/par/
total rows and 216 hole yardages.** The check is kept as `scripts/verify-card-data.py`, and
it validates its own transcription against each card's printed Out/In/Total first, so a typo
in the transcription fails as a transcription error rather than being blamed on the seed.

**Nothing in the code changed.** The CTP rule reads the par-3 count from the data, so it was
always going to do the right thing. What did change: the brief carries a marked correction,
and the `money.test.ts` fixture comment — which had copied "Red 4, Black 5, Blue 4" out of
the brief — now says plainly that its uneven 4/5/4/4 counts are synthetic. Keeping them
uneven is deliberate: with the real 4/4/4/4 a proportional split and a flat split are
indistinguishable, and the test would pass on a broken implementation.

**The rule still earns its place.** All three published courses being equal means it has
nothing to correct for *today*, but Bone Valley's par-3 count is still unknown, and an
abandoned round redistributes. Both cases need it.

**Worth noting for next time:** the brief pre-emptively told the builder not to correct this
line. That is what kept it alive through three phases — a "don't touch this" is exactly where
an error is most expensive, because it disables the normal check.

### PIN size and hash

4-digit PIN (Kyle's call — see "PIN length is 4, not 6" below; the brief said 6). Server-side hash: **argon2id**, moderate params (memory 64 MiB, iterations 3, parallelism 1). Chosen over bcrypt so Edge Function CPU stays cheap on hotel wifi during PIN unlocks.

Local offline PIN hash: **bcrypt cost 10**, not argon2. Argon2 needs WASM and adds ~200 KB to the bundle; local verification is a fallback and its threat model already says "brute-forceable — accepted tradeoff." Server hash stays argon2.

### Real IP for throttling

Comes from the Edge Function's platform-provided source IP, not `x-forwarded-for`.

### Session storage

**Dexie only.** Not `localStorage`, not `sessionStorage`. Dexie already has to survive force-quit; using two mechanisms creates a bug where one exists and the other doesn't.

### PIN length is 4, not 6

**Kyle's decision, 2026-08-18**, overriding the brief's explicit *"Use 6 digits, not 4. Two
extra taps, 100× the search space."* He was shown the cost before deciding.

The number that matters is not the search space on its own but the space divided by the
rate the throttle permits. The global brake (25 failures in 10 minutes → 60-second pause)
is the hard ceiling regardless of how many IPs an attacker spreads across: **~1,400
attempts a day.** So 10,000 combinations is ~3–4 days of *continuous* automated attack to
expect a hit; 1,000,000 is ~a year.

Accepted because of what is behind the PIN. Score entry is open by design (§"PIN removed
from score entry"), so a successful guess reaches `/admin` — the points table, handicap
snapshots, course cards, round lifecycle. Every one of those is an *input*: leaderboards
re-derive from stored gross scores, so correcting a malicious edit restores the standings
exactly. Nothing is destroyed, and the site is unlisted and used by four people.

**Implementation note:** `PIN_LENGTH` in `src/components/PinGate.tsx` is the only
client-side constant, and the Edge Function checks `/^\d{4,8}$/` — a well-formedness gate
so a garbage body never costs an argon2 verify, deliberately a range rather than a fixed
length. The stored hash is what actually decides. Changing PIN length later is a new hash
plus that one constant, with no Edge Function redeploy.

### Reachability probe

`HEAD https://<supabase-url>/rest/v1/` with `apikey` header, 3s timeout, invoked when `navigator.onLine === true` before flipping the badge to "Online." Two consecutive flush failures also trip it back to "Offline."

### Dead-letter store

A separate Dexie table, not a status column on the outbox. Cleaner UI query and the outbox stays tiny for iteration.

### Outbox flush order

Grouped by `(round_id, player_id, hole_number)` key, latest-per-key wins. Different keys flush in parallel with a concurrency cap of 4. Strict global ordering isn't needed and slows recovery in a bad-connection scenario.

### Service worker

`registerType: 'prompt'`. No `skipWaiting`. No `clientsClaim`. New-version toast lives in the persistent top bar and is **suppressed when `outbox.length > 0`** — never fire a page reload mid-flush.

**Implemented in Phase 6b (`vite-plugin-pwa` v1, Workbox `generateSW`):**
`globPatterns` and `maximumFileSizeToCacheInBytes` are set **explicitly** (the brief), not left
to Workbox defaults: the hero photo is ~360 KB and the default 2 MiB cap would drop anything
larger silently, so we precache `**/*.{js,css,html,woff2,svg,png,jpg,ico,webmanifest}` with a
4 MiB ceiling (22 entries, ~1.2 MiB total — the shell, JS/CSS, both fonts, the icons, and the
hero). `injectRegister: false` because registration and the prompt are driven from React
(`useRegisterSW` in `PwaUpdatePrompt.tsx`); the prompt renders `null` while `pending > 0`, so
the waiting worker stays waiting until the queue drains. `navigateFallback: '/index.html'` so a
deep link opened offline still boots the SPA. **PWA install itself cannot be verified without a
real HTTPS origin** (a SW needs a secure context), so install/update is a pre-trip manual check;
what Phase 6b verifies is that the build emits `sw.js` + `manifest.webmanifest` and precaches the
right set.

### App icons (Phase 6b)

Generated from `public/icon.svg` (a serif "BOD·27" monogram in the brand palette) with macOS
`sips` — the only rasteriser on the build host, and it handles SVG→PNG. Committed PNGs:
`pwa-192x192`, `pwa-512x512`, `pwa-maskable-512x512` (extra safe-area padding, no frame),
`apple-touch-icon` (180, iOS reads it from `index.html`, not the manifest), `favicon-32`. Regenerate
by re-running `sips` against the SVG if the mark changes.

### Offline PIN: hash delivered on unlock, not shipped in the bundle (Phase 6b)

The local bcrypt hash (cost 10) is **returned by the `pin-verify` Edge Function on a successful
unlock** and cached in Dexie `sync_meta`, rather than baked into the JS bundle. It is disclosed
only to a caller who just proved they know the PIN, so it never sits in a public artifact — while
still giving a device that has unlocked online once the ability to re-unlock with no signal (the
iOS install-then-unlock case). `unlockOffline` verifies against it with `bcryptjs`. The cached hash
**survives `lock()`** on purpose: locking a device must not disable its offline re-unlock. Set both
hashes with `scripts/hash-pin.ts` (it now prints `APP_PIN_ARGON2_HASH` and `APP_PIN_BCRYPT_HASH`).

**An offline unlock grants a session with an EMPTY server token** (`SessionRow.offline = true`). It
unlocks the UI and lets a tee change queue, but `readToken()` returns null for it, so every
token-gated write (admin RPCs, the round_player flush) waits for the next online unlock. The PIN
gate falls back to the local check only on a genuine *connection* failure (`UnlockError.networkFailed`),
never on a server "Incorrect PIN" or a throttle — those are real answers and must stand.

### `round_player` is the third outbox kind; the editor's tee-save always queues (Phase 6b)

Per §"Answer to the open question", a day-of tee/handicap change rides the outbox. In Phase 6b the
Rounds editor's **"Save tees & handicaps" button always goes through the outbox**
(`saveRoundPlayersQueued` → `enqueueRoundPlayer` → `rpc_upsert_round_player`), online and offline
alike, so it works standing on the first tee with no signal and stays enabled while the rest of
`/admin` is disabled offline. The optimistic local `round_players` row is **computed on enqueue**
by the same `computeHandicap` the server mirrors, so strokes-received are right immediately offline;
the server's authoritative row replaces it on flush. `round_players` therefore joins `scores`/`ctp`
at all four comparator sites (SQL guard already existed; added: the merge, a dedicated Realtime
handler, and the shield). The flush **defers** round_player batches (no attempt, no error) when
there is no session token, and sends them after the next online unlock.

Two smaller calls: the online admin variant `rpc_upsert_round_player_admin` (sentinel client_id) is
**retained** for its SQL test surface and as a hard-reset path, but the editor no longer uses it; and
the queued path **carries the existing `manual_override`** so a tee change no longer silently clears
an override the way the online variant did (it never sent the field).

### CSV export shape (Phase 6b)

The brief's "export all scores as CSV/JSON". JSON stays the faithful dump; the CSV
(`src/lib/data/csv.ts`) is the human one: one row per entered score, names resolved, sorted
round → player → hole, RFC-4180 quoting, derived entirely from the same `rpc_export_all_scores`
payload so the two can't disagree. Both are copy-to-clipboard in the admin Export panel.

### Diagnostics is PIN-gated but not connection-gated (Phase 6b)

`/diagnostics` (linked from `/admin`) shows client_id, session expiry/kind, reachability, last sync,
the outbox, and the dead-letter siding (Retry / Export-JSON per item, plus "Copy state as JSON").
It requires the PIN (it exposes sync internals) but **not** a connection — the whole point is to read
the local queue in a dead zone, which the offline PIN makes reachable. The "Copy state as JSON"
snapshot **omits the session token** deliberately: it gets pasted into chats.

### Fonts

Fraunces (variable, 300–700, italic + roman) for display + figures; Inter (variable) for UI/body. Self-hosted from Google Fonts CDN download, subsetted to Latin. Target ≤80 KB total font payload.

### Color tokens

Superseded by the Streamsong-branded palette Kyle refined on the interim
countdown page (commits `0c1013…`/`467ce68`). Phase 1 adopted that palette as the
canonical token set — accents are lifted from the resort's own logo — and it now
lives in `src/index.css` `:root`:

- Ground: `#0c1013` (near-black); raised surfaces `#12171c`
- Paper: `#f5efe1` (warm cream); dim `#bcb6a9`; faint `#726d64`
- Gold / brass accent: `#d18316`; bright `#e6a442`
- Steel blue: `#3b6e8f`; olive: `#9fa617`
- Hairlines: `rgba(245,239,225,0.12)` / `0.22`

The earlier draft (`#0B0F17` ground, `#B08D57` brass, `#274D3B` green) predated the
Streamsong branding and is retired. Contrast still checked against WCAG AA 4.5:1
for body copy on the dark ground; full Lighthouse a11y pass is Phase 9.

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

---

## Phase 7 — Money

### The Money page derives live; `round_money` is a verification mirror, not the source

`src/lib/data/money.ts` `buildMoney()` derives every figure on the fly from `settings` +
each round's par-3 count (brief §Money, and the §"`round_money` is created only at
finalization" decision above). The frozen `round_money` row written by `rpc_finalize_round`
must agree to the cent — the SQL mirrors `computePurse`/`fn_allocate_*` — but the page never
reads it, so the app shows correct money offline before any round is finalized. A one-cent
disagreement is a bug, asserted in both languages (`admin_path.sql` and `money.test.ts`).

### A cut-off par 3's CTP slice folds into the last played par 3

A shortened round can leave a par 3 past its counted cutoff — Black finalized at 15 holes
leaves hole 17 unplayable. Its CTP slice (every par 3 is worth the same, so it is a real
slice of the round's pot) can never be won. Rather than let those cents vanish, `buildMoney`
adds them to the **last played** par 3's pot, where the carry/return rule resolves them.
Keeps every played par 3 worth the same and keeps the ledger whole (reconciles to the cent).
`money.test.ts` §"shortened round" locks it.

### CTP entry lives inside the round detail, offline, with no PIN

Closest-to-pin is entered on `/rounds/:n` (`CtpEntry.tsx`), not a separate screen — it is
recorded in the same cart, at the same moment, as scores. It flows through the **same
outbox** as scores (`kind: 'ctp'`, built in Phase 6a) and takes no session token, matching
the score-entry amendment (decisions.md §"PIN removed from score entry"). A `null` winner
records the explicit "no winner / carry" row the Money page's carry logic reads; only a
`playing` participant is offered as a winner.

### Champion and round-winner payouts run the real tiebreak chain

The championship pot goes to the overall leader; on a points tie `resolveChampion` walks the
brief's chain (best single round → most holes won → countback preference order → declared
tie) reusing the engine's `tallyHolesWon`/`compareCountback`, and a genuine unbreakable tie
splits with the remainder cent to the better single round. A round purse goes to the round
winner; on a tie it is broken by a countback on that round, else split. This is the same
resolution the standings page will eventually surface, kept in one place.

### Settlement is shown only once every round is final

Greedy `settle()` needs the net balances to sum to zero. Mid-trip, money is still reserved
for undecided rounds/holes (the "pending" bucket), so the balances don't sum to zero and a
settlement would be misleading. The Money page shows transfers only when every non-abandoned
round is `final` and nothing is pending; until then it says settlement isn't available yet.
Voided/returned CTP pots are refunded evenly to all contributors (everyone who bought in).

### Handicap index is live, not snapshotted; Players/Rounds simplified (2026-08-22, Kyle)

Kyle: "simplify players and rounds — I want to mark their handicap and rounds just let me
choose the tee boxes; when I start the round I want to choose what tee we are playing and
just go." The per-round handicap snapshot was the source of the overbuilt feel — it forced a
per-round index field, an allowance/cap display, a manual override, a re-snapshot button, and
two "not retroactive" warnings.

Decision: the handicap index is a **live property of the player**. `buildRoundDetail` pass 1
reads `players.handicap_index` (falling back to `round_players.index_used` only if the player
row is missing); the tee still converts it to strokes via `computeHandicap`, unchanged. The
`round_players` row keeps snapshotting `index_used`/`allowance_used`/`cap_used` so the server
RPC can still compute and store `strokes_received`, but the client no longer scores off it.

Consequences: editing an index on the Players tab now moves points on every **non-finalized**
round immediately — no re-snapshot. Finalized-round **money** is still frozen in `round_money`,
so payouts never move; only the (already provisional) points display of a finalized round
would shift, which is acceptable and unlikely to be edited post-finalize. The Rounds editor is
now one tee dropdown per player + Save/Start/Finalize/Abandon; the index field, allowance/cap
line, manual override and the DNP status picker were removed from the UI. The Players editor
lost the "not retroactive" note and the index-change badge. `resnapshotRound` and
`setManualOverride` remain in `admin.ts`/the RPC layer (still exercised by the SQL tests) but
are no longer wired to any screen. No schema change, no migration.

### Money model: buy-in funds 1st/2nd + round winners, no CTP money (2026-08-23, Kyle)

Kyle supplied the trip's actual money sheet: **$250/man buy-in**, paying **1st overall $600,
2nd overall $200, and a daily round winner $50** (× 4 rounds). $600 + $200 + $50×4 = $1,000 =
4 × $250, so it reconciles exactly. **No closest-to-pin money** — CTP is still entered on the
round screen for bragging rights but pays nothing and is absent from the Money page. Amounts are
**editable in the admin Settings "Money" card**.

This replaced the earlier weighted 40/30/30 championship/round-winner/CTP model. Structural
changes: the championship now pays **two places**, not a single winner-take-all pot; ties pool
the tied positions' purses and split evenly (two tied for 1st split 1st+2nd; the remainder cent
goes to the higher standing). Reconciliation became a genuine check — because the awards are
fixed dollars rather than fractions of the pot, a misconfigured amount or an abandoned round can
fail to reconcile, and the Money page flags it; settlement runs only when balanced.

Implementation: `src/lib/data/money.ts` rewritten (`resolveChampionPlaces` for 1st/2nd,
`resolveRoundWinner` unchanged); `Money.tsx` and the Settings "Money" card rewritten;
`settings.purse_amounts` shape is now `{ buy_in_per_player_cents, champ_first_cents,
champ_second_cents, round_winner_cents }`. `rpc_finalize_round` freezes `round_purse_cents =
round_winner_cents` and 0 for championship_share/ctp (migration
`20260823120000_money_model_revision.sql`); the `round_money` table shape is unchanged. The
weighted `computePurse` in `src/lib/scoring/money.ts` is retained (still unit-tested) but no
longer used by the app. `purse_mode`/`purse_weights`/`ctp_carry_mode` are now legacy settings.

## Phase 8 — Info + admin editors

### No delete for the Info editors (2026-08-24, Kyle)

The itinerary/lodging admin RPCs only insert/upsert — there is no delete path anywhere, and no
seed data for either table. Asked whether to add delete RPCs (a migration + pgTAP) or ship
edit-only editors, Kyle: *"It's just two rooms and dinners and pool time — nothing crazy."* So
Phase 8 ships **add/edit only**. A mistaken row is edited in place, not removed; the data is a
small fixed set. If removal is ever needed, it's a later phase (session-gated
`rpc_delete_itinerary_item` / `_lodging` / `_lodging_assignment` + asserts).

### Rules "money" copy rewritten to the buy-in model

The Rules Info page still described the retired 40/30/30 championship/round/CTP split. Rewritten
to the current model — buy-in funds 1st overall, 2nd overall, and a per-round winner; CTP is for
bragging rights with no money — and it now reads the live dollar figures from
`settings.purse_amounts` rather than hardcoding them. This is a correctness fix, not a new
decision; it just aligns the public copy with `decisions.md §"Money model…"`.

### Info tables wired into the read model (Dexie v6)

`itinerary_items`, `lodging`, `lodging_assignments` are hydrated into Dexie (v6) and read via the
same `useDbData → compute → useLiveQuery` path as every other screen. They are **plain reference
tables** — online-only admin writes, no comparator columns, no outbox — matching the offline
boundary (itinerary/lodging edits are online-only in the brief). `Db`'s three new fields are
optional so the pre-existing scoring-only test fixtures still satisfy the type; the build
functions treat an absent table as empty.

### Course handicap per course is computed live, not snapshotted

The Players Info page shows each player's playing handicap at each course. It is derived live
from the player's **current** index (via `computeHandicap`, mirroring `buildRoundDetail` pass 1),
not from `round_players` snapshots — consistent with the live-index decision (2026-08-22). It is
the player's own handicap (post allowance/cap/override), **not** the play-off-the-low relative
figure the scorecard uses. A player with no `round_players` row for a round reads "—"; a
did-not-play row reads "DNP".
