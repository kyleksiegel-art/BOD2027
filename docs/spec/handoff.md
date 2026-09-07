# Handoff — 2026-09-07 (branch `player-form`, not yet pushed)

- Built **player form**: `src/lib/data/form.ts` (+ `form.test.ts`), `components/PlayerForm.tsx`,
  expandable rows on the Players page, `form` on `PlayerCardVM`. See CLAUDE.md §"Player form".
- All three canvas mockups are now shipped: round report (PR #15), Field Report (PR #16), form (this).
- `npx vitest run` → 183. `tsc -b` + `npm run build` clean. Verified in the browser preview on the
  local seed (rounds 1–2 final, round 3 live thru 13): tiles align, strip bands distinct, chevron
  rotates, no horizontal overflow.
- Still open from earlier PRs: the iPhone check on the live site (round report Share sheet, and
  how the Field Report strip's rotation feels in the cart).
