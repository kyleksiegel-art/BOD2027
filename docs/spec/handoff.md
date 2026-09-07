# Handoff — 2026-09-07 (branch `field-report`, not yet pushed)

- Built the **Field Report** wire: `src/lib/data/wire.ts` (+ `wire.test.ts`), `FieldReportStrip`
  on Standings, `/standings/wire` page (`routes/FieldReport.tsx`), `useFieldReport` selector.
  See CLAUDE.md §"Field Report".
- Round report (PR #15) is merged to `main`; the iPhone Share-sheet check on the live site is still open.
- `npx vitest run` → 177. `tsc -b` + `npm run build` clean. Verified in the browser preview on the
  local seed (round 3 live thru 13).
- Remaining mockup from the canvas: player Form stats (best run / worst 3 / front-back). Undecided.
