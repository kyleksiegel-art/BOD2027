# Handoff — 2026-11-19

Branch `finale-weeks` (off `main`), **uncommitted**.

- Trip finale now says how the champion won the week (wire to wire / took the lead for good on
  a course / only on the last day), right after the margin and last-hole lines.
- The other players' "week" lines no longer all read "a high of X, a low of Y": each gets a
  different angle (led and lost it, a trend, last day, slow start, steady, then high/low).
- `tripFinale` in `src/lib/data/radioCall.ts`; finale test in `radioCall.test.ts` updated.
- Checked by eye on two made-up four-round weeks (a one-point finish and a wire-to-wire win).
- Tests: `vitest run --dir src` → 281. `npm run build` clean.
- Not heard on a phone. Each new pool has three takes.
