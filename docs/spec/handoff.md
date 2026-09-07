# Handoff — 2026-09-07

- **Field Report strip is a rolling cross-hole ticker now** (Kyle: "it's not rotating"). The old
  one cycled only the newest hole's events, so a quiet "No movement" hole (1 event) sat dead, and
  reduced motion froze it entirely. Both fixed. See CLAUDE.md §"Field Report".
- Note: PR #21 (overflow-x clip) was a misread of "scroll" — it fixed a real latent iOS scroll trap
  but was NOT this complaint. Harmless; left merged.

- **iOS scroll fix**: `Layout`'s `<main>` was `overflow-x-hidden`, which computes `overflow-y:auto`
  and made it a nested scroll container with no definite height — iOS swallowed touch scrolling on
  the 4.3-screen Field Report. Now `overflow-x-clip`. See CLAUDE.md §"The shell is the only
  scroller". NOT reproduced on-device (no full Xcode) — needs Kyle's phone to confirm. (branch `player-form`, not yet pushed)

- Built **player form**: `src/lib/data/form.ts` (+ `form.test.ts`), `components/PlayerForm.tsx`,
  expandable rows on the Players page, `form` on `PlayerCardVM`. See CLAUDE.md §"Player form".
- All three canvas mockups are now shipped: round report (PR #15), Field Report (PR #16), form (this).
- `npx vitest run` → 183. `tsc -b` + `npm run build` clean. Verified in the browser preview on the
  local seed (rounds 1–2 final, round 3 live thru 13): tiles align, strip bands distinct, chevron
  rotates, no horizontal overflow.
- Form now shows **one strip per round played**, newest first, all 18 cells wide so rounds line up
  (chosen off a two-option canvas: stacked vs round tabs). `vitest run` → 184.
- Players row reworked after Kyle's "feels weird": whole collapsed row is the tap target (was 73%
  dead), handicaps on one line, row 161px → 106px. `courseShortName` promoted to `format.ts`.
- Corrected the stale `purse_amounts` note in CLAUDE.md (PR #18) — the hosted DB was already fine.
- Still open from earlier PRs: the iPhone check on the live site (round report Share sheet, and
  how the Field Report strip's rotation feels in the cart).
