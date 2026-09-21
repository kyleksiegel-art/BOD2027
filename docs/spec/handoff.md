# Handoff — 2026-09-20 (branch `what-it-takes`, uncommitted)

- Built the "what it takes" line on Standings: `StandingVM.chase` in `compute.ts`, words in
  `formatChaseLine` (`format.ts`), rendered under the live line in `Standings.tsx`.
- Kinds: leads / clinched / level / needs / out_today / out. `by` = gap + 1. "Out of reach" is
  max-points × holes-left arithmetic off the live points table; the week adds 18 per upcoming round.
- Tests: `chase.test.ts` (7). `vitest run` → 227. `npm run build` clean.
- Browser-verified at 375px with the Phase 4 seed's round 3 forced live in Dexie; all six copy
  variants fit on one line.
- Not committed — Kyle to sign off. Then: commit, PR `what-it-takes` → `main`, Netlify preview.
- Design canvas `BOD27 Rebrand Ideas` holds the session's mockups (rebrands, offshoots, Field
  Report, Enter, Standings). Kyle rejected the rebrands, the offshoots, the Week/Today toggle and
  the race line; only this line was picked.
- CLAUDE.md has a new "What it takes" section, including the dead-URL env trick for live checks.
