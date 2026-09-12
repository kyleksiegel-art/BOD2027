# Handoff — 2026-09-11 (Annual Report: finalize gate)

- Follow-up to the Annual Report (now on `main`, PR #27). Kyle: "show up automatically after round 4
  is finalized." Branch `annual-report-finalize-gate` off `main`.
- **Gate tightened to the finalize, not "all scores in":** `buildAnnualReport` now returns null while
  any round is `upcoming` or `in_progress` (even one with all 18 scores in) and renders only once every
  round is `final`/`abandoned` with ≥1 `final`. It already surfaces automatically — finalize flips
  `rounds.status`, the hydrate refetch + Realtime `rounds` event update Dexie, the board re-renders.
- Dropped the `buildRoundRecap` act-based check (and its import); the gate is pure status now.
- Tests: `annualReport.test.ts` 6 → **7** (added: all-scores-in-but-in-progress stays hidden; appears
  the moment the last round is finalized). Full `vitest run` → **208**. `tsc -b` + `npm run build`
  clean. `supabase test db` unchanged (**241** — no migration).
- CLAUDE.md §"Annual Report" updated to describe the finalize gate.
- **Still owed:** commit + PR `annual-report-finalize-gate` → `main`; on-device confirm at trip's end
  that finalizing Round 4 pops the report on the other phones (Realtime path).