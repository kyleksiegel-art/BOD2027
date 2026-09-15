# Handoff — 2026-09-14 (Player card)

- Kyle: the opened Players row "doesn't add much" → proposed a restructure, mocked it on the
  `Player Card` canvas (https://claude.ai/artifact/GKqw2mGz2tAnJK16Kz8bn6), Kyle: "build it".
  Branch `player-card` off `main` (post-#29).
- **New:** `src/lib/data/playerWeek.ts` (`buildPlayerWeek` — place/total/gap-by-name/`wonCents`
  from FINAL rounds only). **Rewritten:** `form.ts` (`vsIndex`, `zeros`, `netBirdies`, `holesWon`
  off the standings tally, `FormStrip.result`; `worstStretch` + front/back gone, `bestRun` kept for
  the Annual Report), `PlayerForm.tsx` (+ exported `FormLegend`). **Changed:** `selectors.ts`
  (`PlayerCardVM.week`), `Players.tsx` (`WeekLine`, legend once at page bottom), `format.ts`
  (`ordinalOf` consolidated from compute/annualReport).
- Order in an opened row: week line → strokes card (unchanged) → form tiles + verdict → strips.
- `vitest run` → **220**. `tsc -b` + `npm run build` clean. Verified at 375px on the local seed;
  no console errors. CLAUDE.md §"Player card" added.
- Kyle dropped the explanatory footnote under the list. **PR #30 merged to `main` 2026-09-14 and live** on
  bod2027.netlify.app — verified on production at 375px after accepting the SW update prompt (Jon: 3rd, 96 pts,
  27 back of Kyle, 4 over the index, 3 · 8, 1 of 54 holes won). The reachability HEAD probe's 401s are expected.
