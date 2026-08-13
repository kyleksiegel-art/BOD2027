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
tees, 234 hole-yardage rows, 8 settings). The pgTAP suite (55 tests across
`rls_smoke.sql` and `seed_integrity.sql`) proves the security posture and guards the
seeded scorecard numbers against transcription error.

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

Course scorecard data (par, stroke index, rating/slope, per-hole yardage) is
transcribed from the resort's official 2021 printed scorecards and cited in the seed
migration headers; each course's stroke index is asserted to be a complete 1–18
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

## The rest of this file will fill in as the build progresses

- PIN threat model, admin PIN recovery (Phase 5)
- **iOS install-then-unlock instruction** (Phase 6) — install to the home screen before unlocking, on hotel wifi, before each round
- Deployment notes and custom-domain instructions (Phase 1 / Phase 9)
- Anon-key safety analysis (Phase 5)
