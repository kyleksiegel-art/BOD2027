# Handoff — 2026-09-10 (Annual Report)

- New feature on branch `annual-report` (off `main`): the trip's **Annual Report**, at the top of
  Standings once the season is complete. **No schema/scoring change** — it composes the existing
  builders (`buildStandings`, `buildMoney`, `resolveRoundWinnerIds`, `buildPlayerForm`,
  `buildOverallTiebreak`). See CLAUDE.md §"Annual Report".
- `src/lib/data/annualReport.ts` `buildAnnualReport(db)` → null until no round is `upcoming` and
  every counting round's recap `act === 'final'`; then champion, final standings, per-round winners,
  six superlatives (low round, streak, holes-won, net-birdies, roughest hole, CTP), settled money,
  and a 4-paragraph letter that names every player once (no pronouns, `report.ts` voice).
- `src/components/AnnualReport.tsx` — collapsible, shares as PNG (`renderRecapImage`); rendered at the
  top of `Standings.tsx` (absent during the trip). Selector `useAnnualReport()`.
- Tests: `annualReport.test.ts` (6, hand-asserted). Full `vitest run` → **207**. `tsc -b` +
  `npm run build` clean. `supabase test db` unchanged (**241** — no migration).
- **Verified live** at 375px against a complete-season state (champion/numbers/round-winners/money/
  letter all correct). Live-check gotcha recorded in CLAUDE.md: break `VITE_SUPABASE_URL` + restart so
  hydrate can't revert the seeded Dexie state.
- Reconciliation tripwire correctly flags a non-balancing purse (e.g. an abandoned round); the letter
  only claims "every dollar accounted for" when `reconciliation.balanced`.
- **Still owed:** commit + PR `annual-report` → `main`; on-device look at trip's end (the report only
  appears once all four rounds are done). The published design-canvas mock is the visual reference.