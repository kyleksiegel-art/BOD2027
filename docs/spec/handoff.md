# Handoff — 2026-09-06 (branch `shareholder-letter`, not yet pushed/merged)

- Built the **round report** (was "Letter to Shareholders"; Kyle: drop the business jargon) as an
  addition under the recap card on `/rounds/:n` (final rounds only). See CLAUDE.md §"Round report".
- New: `src/lib/data/report.ts` (+ `report.test.ts`), `src/components/round/RoundReport.tsx`,
  `useRoundReport` in `selectors.ts`; `RoundDetail.tsx` renders it under `<RoundRecap>`.
- Report is collapsible (open only for the latest counting round). Handicap Worksheet removed
  from the round page (component deleted; the data + tests remain).
- Report names every player (a "rest of the field" paragraph + "sat out" for DNP).
- `npx vitest run` → 172 passed. `npx tsc -b` and `npm run build` clean.
- Verified in the browser preview on rounds 1 and 2 with the local Supabase seed; Share button
  only appears where `navigator.share` exists — check on an iPhone before trusting the PNG share.
- Design canvas "BOD27 Wild Ideas" (Artifact) holds mockups for two unbuilt ideas: the Field
  Report wire on Standings and Form stats on the player card. Kyle liked the report; the other
  two are undecided.
- Nothing committed yet — Kyle to review the live demo, then commit/PR from this branch.
