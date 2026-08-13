# Handoff

**Phase just finished:** 3 — Scoring engine. Pure TS in `src/lib/scoring/` (`types`, `rounding`, `handicap`, `round`, `championship`, `tiebreak`, `money`, `index`). No React/network. Branch `phase-3-scoring` (off `phase-1-scaffold`).

**Built out of order:** Phase 2 (Supabase schema/RLS/seeds) is NOT built — it needs Docker + Supabase CLI to verify, neither installed here. Phase 3 has no DB dependency, so Kyle had me do it first. **Phase 2 still owed.**

**Verified:** `npm run test:scoring` → 67 passed (6 files); `tsc -b` clean; `npm run build` clean. Three hand-verified course-handicap worked examples (Red/Blue/Black Green tees) with manual arithmetic in comments; real card data in `__fixtures__/streamsong.ts`, cited from the resort's 2021 scorecard PDFs Kyle provided. Black uses par 73 and matches the brief's worksheet exactly.

**Open decision left as a note (per Kyle):** overall countback preference order. `DEFAULT_COUNTBACK_ROUND_ORDER = [3,4,2,1]` (brief's literal text). After the tee-sheet swap R3=Blue, R2=Black. Decide positional (keep R3-first=Blue) vs. re-pin to Black — one-line change to that constant in `tiebreak.ts`.

**Not committed** — new files + `package.json` (`test:scoring` script) in the working tree on `phase-3-scoring`, awaiting Kyle's go to commit.

**Kyle still owes (carried from P1):** push `phase-1-scaffold`, confirm Netlify deploy-preview + Lighthouse baseline. Install Docker + Supabase CLI when ready for Phase 2 (`brew install --cask docker && brew install supabase/tap/supabase`).

**Next phase:** 2 (schema/RLS/seeds — needs tooling) OR 4 (read-only UI — can render from the engine + seeded fake scores). Read `CLAUDE.md`, `acceptance-checklist.md`, this file, + the target phase's spec.
