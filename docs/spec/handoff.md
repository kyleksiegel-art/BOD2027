# Handoff — 2026-11-19

Branch `finale-last-hole` (off `main`), **uncommitted**.

- Trip finale: a finish decided by one to three points now always gets a last-hole call (where
  the two stood for the week on the last tee, what each made), right after the margin line.
  Before, an uneventful last hole was skipped even on a one-point finish.
- `tripFinale` in `src/lib/data/radioCall.ts`; test "a close finish" in `radioCall.test.ts`.
- Tests: `vitest run --dir src` → 281. `npm run build` clean.
- Noted, not done: the three per-player "week" lines drag on four rounds, and the champion's
  own week is never described.
