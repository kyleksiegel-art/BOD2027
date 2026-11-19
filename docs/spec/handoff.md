# Handoff — 2026-11-19

Branch `play-of-the-trip` (off `main`), **uncommitted**.

- Trip finale's play of the trip no longer takes the first of equal shots. Like shots are split
  by what they did: +10 if the rest of the group took zeros on the hole, +5 if the maker won
  that round (same rule as the round wrap's play of the day). `tripFinale` in `radioCall.ts`.
- Test updated: Chris's eagle on the 7th beats Jon's on the 18th in the two-round fixture.
- Gross shots are now "true" (true eagle, true birdies), not "real", in the radio call, Field
  Report and round report (Kyle 2026-11-19). 105 replacements incl. tests.
- Tests: `vitest run --dir src` → 280. `npm run build` clean.
- Still open: the finale has only been run on two rounds of fixture data, not four.
