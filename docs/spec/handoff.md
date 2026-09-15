# Handoff — 2026-09-14 (Strokes card)

- Kyle: "build it" — the strokes card, mocked on the `BOD27 Strokes Card` canvas after a Wallet-pass
  conversation (no Apple developer account → a picture instead). Branch `strokes-card` off `main`.
- **New:** `src/lib/data/strokesCard.ts` (`buildStrokesCards`, `nextRoundNumber`, `strokesCardFilename`),
  `src/components/StrokesCard.tsx` (`NextRoundBlock`, `StrokesCardImage`), `strokesCard.test.ts` (7).
- **Changed:** `selectors.ts` (`PlayerCardVM.strokesCard`, `useHasStrokesCards`), `routes/info/Players.tsx`
  (the card rendered LIVE at the top of an opened row, share buttons under it; rows expandable when
  form OR card exists), `routes/Home.tsx` (`StrokesCardsLink` → `/info/players`), CLAUDE.md §"Strokes card".
- Kyle's second-pass feedback ("can't look at it without creating an image; can't go anywhere") →
  the card is on screen, not just a file, and Home links to it.
- Follows the next round (in_progress first, else upcoming); one card per playing player; strokes and
  holes off `buildRoundDetail`'s worksheet + `allocateStrokes`. Two PNGs: Photos (1080 wide) and a
  390×844 lock-screen frame with the clock area left as ground.
- `vitest run` → **215**. `tsc -b` + `npm run build` clean. Verified at 375px in the preview with a
  polyfilled `navigator.share`: both files produced (187 KB / 178 KB), lock-screen PNG inspected.
- Committed + pushed; **PR #29** `strokes-card` → `main`, Netlify preview `deploy-preview-29--bod2027.netlify.app`.
- **Pre-trip phone check owed:** tap Card on a real iPhone once tees are set (share sheet → Save Image),
  and set the lock-screen PNG as wallpaper once to see the clock clears the card.
