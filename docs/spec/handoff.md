# Handoff — 2026-11-11

Branch `radio-call-sportscast` (off `main`), **uncommitted**.

- Radio call is commentary now, not a Field Report readout (Kyle 2026-11-11).
- Round wrap = highlights show: `wrapShow` in `src/lib/data/radioCall.ts` (result, money, how it
  was won, play of the day, a line per player, one blooper), then week / next up / sign-off.
- Live calls: `recentAction` now calls each of the last two holes via `holeCall`; quiet holes are
  skipped. A fresh real eagle is no longer said twice (hole call + color note).
- Trip finale and the first-tee preview are unchanged.
- Tests: `radioCall.test.ts` 17; `vitest run --dir src` → 264. `npm run build` clean.
- Next: Kyle listens to a few takes on the phone (Admin → Radio call) and says what to tune.
