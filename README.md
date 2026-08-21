# Board of Directors — Streamsong 2027

Live golf trip tournament web app for The Board of Directors' 2027 trip to Streamsong Resort (Feb 4–7, 2027). Offline-capable PWA, deployed to Netlify, backed by Supabase.

**Status: Phase 2 — Supabase schema, RLS, seeds (Red/Blue/Black scorecards + Bone Valley placeholder), realtime, pgTAP.**

## Local setup

Requires Node 22 (pinned in `netlify.toml`; use `nvm use 22`).

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # tsc -b + vite build → dist/
npm run preview    # serve the production build locally
npm run typecheck  # tsc project-references, no emit
npm test           # vitest (no tests until Phase 3)
```

The app itself has no environment variables yet; the two it will ever need
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are wired in a later phase. Everything
else mutable lives in Supabase, not in config (see `decisions.md`).

## Supabase (local database)

Requires Docker running and the Supabase CLI (`brew install supabase/tap/supabase`).
Migrations and idempotent seeds live in `supabase/migrations/`; there is no
`supabase/seed.sql` (seeds are in the migrations, with stable hard-coded UUIDs).

```bash
supabase start          # first run pulls ~hundreds of MB of images (slow, once)
supabase db reset       # recreate the DB and apply every migration + seed
supabase test db        # run the pgTAP suite in supabase/tests/
supabase status         # print local API URL + anon key
supabase stop           # tear the local stack down
```

`db reset` on a clean instance produces all 16 tables, RLS policies, the realtime
publication, and the seeded scorecards (4 courses, 4 players, 4 rounds, 72 holes, 13
tees, 234 hole-yardage rows, 8 settings). The pgTAP suite (232 tests across
`rls_smoke.sql`, `seed_integrity.sql`, `write_path.sql` and `admin_path.sql`) proves the
security posture, guards the seeded scorecard numbers against transcription error, and
enforces every server-side validation and comparator rule on the write and admin paths.

### Edge Functions

PIN verification runs in an Edge Function, not an RPC — an RPC called with the anon key
cannot see a trustworthy client IP, so per-IP throttling inside Postgres would be theater.

```bash
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve --env-file supabase/functions/.env --no-verify-jwt
```

The committed `.env.example` carries the hashes of the **trip PIN `1922`** (argon2 for the
online check, bcrypt for the offline check). The repo is private and the PIN is a weak,
deliberately-recoverable gate, so committing the hash is an accepted tradeoff. To rotate the
PIN — or to keep it out of git and set it only as a production secret — regenerate both hashes:

```bash
npx tsx scripts/hash-pin.ts 1922
supabase secrets set APP_PIN_ARGON2_HASH='$argon2id$v=19$...'
supabase secrets set APP_PIN_BCRYPT_HASH='$2b$10$...'
```

Changing the PIN does **not** invalidate tokens already issued — call
`rpc_revoke_all_sessions` (any valid session may) to do that.

### Verifying the security posture with `curl`

Reads are public; **all writes are refused for anon** (they go through
`SECURITY DEFINER` RPCs added in a later phase). With the local API URL + anon key
from `supabase status`:

```bash
API=http://127.0.0.1:54321
ANON=<anon key from `supabase status`>

# anon CAN read public tables → HTTP 200 with rows
curl -s -w '\n%{http_code}\n' "$API/rest/v1/courses?select=name,architect" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"

# anon CANNOT write → HTTP 401, code 42501 "permission denied for table scores"
curl -s -w '\n%{http_code}\n' -X POST "$API/rest/v1/scores" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d '{"round_id":"e0000000-0000-4000-8000-000000000001","player_id":"d0000000-0000-4000-8000-000000000001","hole_number":1,"gross_strokes":4,"picked_up":false,"client_updated_at_raw":"2027-02-04T18:00:00Z","client_updated_at_effective":"2027-02-04T18:00:00Z","client_id":"11111111-1111-4111-8111-111111111111"}'

# anon CANNOT even read the locked tables → HTTP 401, 42501 permission denied
curl -s -w '\n%{http_code}\n' "$API/rest/v1/sessions?select=id" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

### Verifying the write path end to end

```bash
./scripts/verify-write-path.sh
```

Demonstrates, against the live API: anon cannot write to a table or mint a session; the
RPC refuses a forged token; a wrong PIN and a malformed PIN get identical answers; the
correct PIN mints a session; **a score write is accepted with no session token at all**
while the gated RPCs still refuse a forged one; each validation rule refuses its own cell
while the rest of the batch still applies; a stale write loses the comparator and is handed
the current winner; and six wrong PINs throttle further unlocking while a device that
already holds a session keeps working.

### Verifying the admin path end to end

```bash
./scripts/verify-admin-path.sh
```

Demonstrates, against the live API: all 18 admin RPCs refuse a forged token (403) while
carrying their real argument lists; anon still cannot write to a table; Bone Valley refuses
to publish and names each thing that is missing, so Round 4 refuses to start; a complete
card publishes, un-publishes the moment a hole is edited, and re-publishes on validation;
field validation refuses a mistyped slope, a hole 19, and a tee from another course; the
settings whitelist refuses an unknown key, a malformed points table and a 150% allowance;
finalizing names who is short of holes and skips the DNP player; and a finalized round
freezes its money row.

**It mutates the database** — run `supabase db reset` afterwards.

## Score entry is open; `/admin` is not

**There is no PIN on score entry.** Scores and closest-to-pin are written by anyone with
the URL; the Enter screen has an explicit per-hole **Save** button instead of a lock. This
supersedes the brief — the amendment and the reasoning are in
[`docs/spec/decisions.md`](docs/spec/decisions.md) §"PIN removed from score entry".

The line falls exactly where the brief's own offline/online split already falls:

| Write | Gate |
|---|---|
| `rpc_upsert_scores`, `rpc_upsert_ctp` | none — the in-the-cart writes |
| `rpc_upsert_round_player` | PIN — it rewrites handicaps, and a wrong stroke allocation silently corrupts every leaderboard |
| every admin RPC | PIN |

**What that costs, stated plainly.** Anyone with the URL can write scores. There is no rate
limit on score writes and no audit beyond `client_id`. What still protects the data is the
server-side validation (a score must be a legal score, on a real hole, for a player
actually playing that round), the fact that nothing in the app deletes scores, and the URL
not being linked from anywhere. That is a deliberate trade, not an oversight: the realistic
threat to a four-person golf trip is a mistyped PIN at the first tee, not vandalism.
Re-gating is a one-line change if that judgement turns out wrong.

## The `/admin` PIN, stated honestly

`/admin` sits behind a single **shared four-digit PIN**. Anyone with it can edit every
mutable thing in the trip; that is the intent, not a weakness. (The brief specified six;
Kyle chose four on 2026-08-18 — `docs/spec/decisions.md` §"PIN length is 4, not 6" carries
the arithmetic behind that call.)

- Verification happens server-side in the `pin-verify` Edge Function using **argon2id** at
  OWASP's recommended parameters (m = 19 MiB, t = 3, p = 1). The browser never sees the
  hash, and the hash is an Edge Function secret — never a row in publicly-readable
  `settings`.
- Throttling is **layered on purpose**. Per-IP is the primary control (five free attempts,
  then an exponential backoff capped at five minutes); a short global brake engages only
  above 25 failures across all IPs in ten minutes and lasts at most 60 seconds. There is
  no indefinite lockout anywhere: one person fat-fingering the PIN at the first tee must
  not lock the other three out of scoring, and **failed attempts never invalidate a
  session that has already been issued.**
- Sessions are 256 bits of CSPRNG output. The server stores only a SHA-256 digest, so a
  leaked `sessions` table grants nothing. They expire at the end of the trip.
- **This is not high security, and should not be described as such.** Four digits is a
  10,000-wide space, and the throttling is the whole of what makes online guessing
  impractical: the global brake caps guessing at roughly 1,400 attempts a day, so the
  space is ~3–4 days of continuous automated attack. That is accepted because everything
  behind the PIN is an *input* — leaderboards re-derive from stored gross scores, so a
  malicious edit is corrected, not recovered from a backup. When offline PIN verification
  lands in Phase 6, a hash of the PIN will also be stored on the device: *local offline PIN
  verification prevents casual unauthorized access. It does not resist an attacker who
  obtains the device's local storage, since a four-digit PIN space is brute-forceable
  offline. That is an accepted tradeoff for a four-person golf trip.*
- **Recovery:** there is no reset flow, by design. Regenerate the hash with
  `scripts/hash-pin.ts`, set the secret, and call `rpc_revoke_all_sessions`.

### Why the anon key being public is fine

The anon key authenticates *anonymous reads only*. RLS grants `anon` SELECT on the public
tables and nothing else, a blanket `REVOKE INSERT, UPDATE, DELETE` removes the rest, and
`sessions` / `pin_attempts` have RLS on with zero policies. Every write — gated or not —
goes through a `SECURITY DEFINER` RPC, so the validation rules can never be bypassed by
posting at a table; opening score entry unlocked that door rather than removing it. The
functions that could mint a session are granted to `service_role` only.
`scripts/verify-write-path.sh` is the proof.

Course scorecard data (par, stroke index, rating/slope, per-hole yardage) is
transcribed from the resort's official 2021 printed scorecards and cited in the seed
migration headers. `python3 scripts/verify-card-data.py` re-checks every one of those
numbers against the printed cards — 54 hole pars, 54 stroke indexes, 12 tee
rating/slope/par/total rows and 216 hole yardages — and validates its own transcription
against each card's printed Out/In/Total first. It currently reports 0 discrepancies. (It
is also what settled the brief's claim that Black has five par 3s: it has **four** par 3s
and five par 5s, and the brief now carries a correction.) In addition, each course's
stroke index is asserted to be a complete 1–18
permutation and each tee's hole yardages are asserted to sum to the printed total.

## Deployment (Netlify)

`main` serves the live static countdown at `bod2027.netlify.app` and has **no
`netlify.toml`**, so it keeps its dashboard static-publish settings. Every other
branch carries `netlify.toml` (build `npm run build`, publish `dist`, SPA
fallback, Node 22, cache headers) and gets its own deploy preview. The SPA
replaces the countdown only when a phase branch is merged to `main` after
sign-off.

## Where to start

- The authoritative spec lives in [`docs/spec/brief.md`](docs/spec/brief.md). It is the source of truth. If it disagrees with any other document in this repo, the brief wins.
- Architecture, data-layering rule, and conventions live in [`CLAUDE.md`](CLAUDE.md). Kept current so future sessions don't re-derive them from source.
- Every decision made outside the brief is logged in [`docs/spec/decisions.md`](docs/spec/decisions.md), including places where two requirements appeared to conflict and how they were resolved.
- Phase-by-phase acceptance evidence: [`docs/spec/acceptance-checklist.md`](docs/spec/acceptance-checklist.md).
- Session handoff (short): [`docs/spec/handoff.md`](docs/spec/handoff.md). This is what the next session reads first.

## iOS: install first, then unlock

A home-screen PWA can get a storage context separate from Safari, so unlocking in Safari
and *then* installing leaves you locked out with no signal. **Add the app to the home
screen first, then unlock inside the installed app** — on hotel wifi, before you need it.
This applies to `/admin`; score entry needs no unlock at all.

## The rest of this file will fill in as the build progresses

- Offline behaviour, the outbox, and diagnostics (Phase 6)
- Deployment notes and custom-domain instructions (Phase 9)
