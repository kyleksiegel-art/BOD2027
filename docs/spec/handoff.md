# Handoff

**Phase just finished:** 2 — Supabase schema + RLS + realtime + seeds + pgTAP. Six migrations in `supabase/migrations/` (enums, tables, RLS, realtime, core seed, tees seed); two pgTAP files in `supabase/tests/`.

**Verified:** `supabase db reset` applies all six clean → 16 tables + seeds (4 courses, 4 players, 4 rounds, 72 holes, 13 tees, 234 hole_yardages, 8 settings). `supabase test db` → **55/55 pass**. `curl` anon: read `courses` 200; POST `scores` 401/42501; read `sessions` 401/42501. Course data transcribed from the resort's **official 2021 scorecards** and hand-verified against the PDFs.

**⚠ Bug found in Phase 3 data:** Streamsong **Black holes 17/18 stroke index are swapped** in `src/lib/scoring/__fixtures__/streamsong.ts` (fixtures 17→5/18→13; printed card **17→13/18→5**). The **seed is correct**; the fixtures + Phase 3 "matches printed card" test are wrong. A task chip was spawned to fix the fixtures. Red/Blue re-verified, correct.

**Working placeholders (Kyle owes real values):** player indexes 9.2/12.4/14.0/16.8 all `index_is_assigned=false`; each player's tee; who plays an assigned index; Bone Valley `year_opened`+placeholder-tee `par`. Combo tees not seeded (no per-hole yardages on the card).

**Doc fix:** `schema.md` was missing the anon `grant select` (RLS policy alone left anon denied on Supabase local) — corrected in migration + schema.md.

**Not committed / branch question:** Phase 2 files are uncommitted in the working tree **on `phase-3-scoring`** (`supabase/` untracked; README/schema/acceptance modified). Recommend a `phase-2-schema` branch — but the acceptance-checklist/handoff edits sit on Phase 3 history, so Kyle should decide how to slice it. Awaiting go to commit.

**Local stack is running** (12 containers up). `supabase stop` to tear down.

**Kyle still owes (carried):** push `phase-1-scaffold`; confirm Netlify deploy-preview + Lighthouse baseline.

**Next phase:** 4 (read-only UI — can render from the engine + a Phase 4 fake-scores seed) or 5 (auth + RPCs + write path). Read `CLAUDE.md`, `acceptance-checklist.md`, this file, + the target phase's spec.
